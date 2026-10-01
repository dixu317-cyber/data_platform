import pg from 'pg';
import { DATABASES, LIGHTRAG_SCHEMA, MIGRATOR_ROLE, databaseUrl, requiredEnv } from './topology';

const { Client } = pg;

function sameSet(actual: string[], expected: string[]): boolean {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

export async function runPostcheck(): Promise<void> {
  const adminUrl = requiredEnv('POSTGRES_ADMIN_URL');
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const databases = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname = ANY($1::text[])`,
      [DATABASES.map(({ name }) => name)],
    );
    if (!sameSet(databases.rows.map(({ datname }) => datname), DATABASES.map(({ name }) => name))) {
      throw new Error('postcheck failed: six business databases are incomplete');
    }
    const roles = await admin.query<{
      rolname: string; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean;
    }>(
      `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = ANY($1::text[])`,
      [[MIGRATOR_ROLE, ...DATABASES.map(({ runtimeRole }) => runtimeRole)]],
    );
    if (roles.rowCount !== 7 || roles.rows.some((role) => role.rolsuper || role.rolcreatedb || role.rolcreaterole)) {
      throw new Error('postcheck failed: database role flags are unsafe or incomplete');
    }
  } finally {
    await admin.end();
  }

  for (const database of DATABASES) {
    const client = new Client({ connectionString: databaseUrl(adminUrl, database.name) });
    await client.connect();
    try {
      const extensions = await client.query<{ extname: string }>(
        `SELECT extname FROM pg_extension WHERE extname = ANY($1::text[])`,
        [['vector', 'pg_trgm']],
      );
      if (!sameSet(extensions.rows.map(({ extname }) => extname), database.extensions)) {
        throw new Error(`postcheck failed: extension matrix mismatch in ${database.name}`);
      }
      const tables = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [database.coreTables],
      );
      if (!sameSet(tables.rows.map(({ table_name }) => table_name), database.coreTables)) {
        throw new Error(`postcheck failed: core tables missing in ${database.name}`);
      }
      const runtimePrivileges = await client.query<{
        schema_usage: boolean;
        table_dml_count: number;
      }>(
        `
          SELECT
            has_schema_privilege($1, 'public', 'USAGE') AS schema_usage,
            count(*) FILTER (
              WHERE has_table_privilege($1, format('%I.%I', table_schema, table_name), 'SELECT')
                AND has_table_privilege($1, format('%I.%I', table_schema, table_name), 'INSERT')
                AND has_table_privilege($1, format('%I.%I', table_schema, table_name), 'UPDATE')
                AND has_table_privilege($1, format('%I.%I', table_schema, table_name), 'DELETE')
            )::int AS table_dml_count
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ANY($2::text[])
        `,
        [database.runtimeRole, database.coreTables],
      );
      if (
        !runtimePrivileges.rows[0]?.schema_usage
        || runtimePrivileges.rows[0].table_dml_count !== database.coreTables.length
      ) {
        throw new Error(`postcheck failed: runtime role lacks public core-table privileges in ${database.name}`);
      }
      if (database.name === 'agent_gateway_db') {
        const checkpoints = await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'langgraph'`,
        );
        const checkpointTables = ['checkpoint_migrations', 'checkpoints', 'checkpoint_blobs', 'checkpoint_writes'];
        for (const name of checkpointTables) {
          if (!checkpoints.rows.some(({ table_name }) => table_name === name)) {
            throw new Error(`postcheck failed: LangGraph table ${name} is missing`);
          }
        }
        const runtimePrivileges = await client.query<{
          schema_usage: boolean;
          table_dml_count: number;
        }>(
          `
            SELECT
              has_schema_privilege($1, 'langgraph', 'USAGE') AS schema_usage,
              count(*) FILTER (
                WHERE has_table_privilege($1, format('%I.%I', table_schema, table_name), 'SELECT')
                  AND has_table_privilege($1, format('%I.%I', table_schema, table_name), 'INSERT')
                  AND has_table_privilege($1, format('%I.%I', table_schema, table_name), 'UPDATE')
                  AND has_table_privilege($1, format('%I.%I', table_schema, table_name), 'DELETE')
              )::int AS table_dml_count
            FROM information_schema.tables
            WHERE table_schema = 'langgraph' AND table_name = ANY($2::text[])
          `,
          [database.runtimeRole, checkpointTables],
        );
        if (!runtimePrivileges.rows[0]?.schema_usage || runtimePrivileges.rows[0].table_dml_count !== checkpointTables.length) {
          throw new Error('postcheck failed: agent runtime role lacks LangGraph checkpoint privileges');
        }
      }
      if (database.name === 'graph_rag_db') {
        const lightrag = await client.query(
          `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'lightrag\_%' ESCAPE '\\' LIMIT 1`,
          [LIGHTRAG_SCHEMA],
        );
        if (!lightrag.rowCount) throw new Error('postcheck failed: LightRAG schema has no initialized tables');
      }
    } finally {
      await client.end();
    }
  }

  const identity = new Client({ connectionString: databaseUrl(adminUrl, 'platform_identity_db') });
  const nano = new Client({ connectionString: databaseUrl(adminUrl, 'nano_brain_db') });
  await identity.connect();
  await nano.connect();
  try {
    const organization = await identity.query<{ id: string; name: string; active: boolean }>(
      `
        SELECT id, name, active
        FROM organizations
        WHERE id = 'org_companybrain'
      `,
    );
    if (
      organization.rowCount !== 1
      || organization.rows[0]?.name !== 'CompanyBrain'
      || organization.rows[0]?.active !== true
    ) {
      throw new Error('postcheck failed: identity organization seed mismatch');
    }

    const teams = await identity.query<{
      id: string;
      organization_id: string;
      active: boolean;
      registration_enabled: boolean;
      is_default: boolean;
      sort_order: number;
    }>(
      `
        SELECT id, organization_id, active, registration_enabled, is_default, sort_order
        FROM teams
        WHERE id = ANY($1::text[])
        ORDER BY id
      `,
      [['default-team', 'platform-admin', 'product', 'sales']],
    );
    const expectedTeams = [
      {
        id: 'default-team', organization_id: 'org_companybrain', active: true,
        registration_enabled: true, is_default: true, sort_order: 0,
      },
      {
        id: 'platform-admin', organization_id: 'org_companybrain', active: true,
        registration_enabled: false, is_default: false, sort_order: 1000,
      },
      {
        id: 'product', organization_id: 'org_companybrain', active: true,
        registration_enabled: true, is_default: false, sort_order: 20,
      },
      {
        id: 'sales', organization_id: 'org_companybrain', active: true,
        registration_enabled: true, is_default: false, sort_order: 10,
      },
    ];
    if (JSON.stringify(teams.rows) !== JSON.stringify(expectedTeams)) {
      throw new Error('postcheck failed: identity team seeds mismatch');
    }

    const adminUser = await identity.query<{
      id: string;
      organization_count: number;
      has_platform_admin: boolean;
    }>(
      `
        SELECT
          u.id,
          count(DISTINCT t.organization_id)::int AS organization_count,
          bool_or(m.team_id = 'platform-admin') AS has_platform_admin
        FROM users u
        LEFT JOIN user_team_memberships m ON m.user_id = u.id
        LEFT JOIN teams t ON t.id = m.team_id
        WHERE u.username = $1 AND u.is_admin = true
        GROUP BY u.id
      `,
      [requiredEnv('ADMIN_USERNAME').trim().toLowerCase()],
    );
    if (adminUser.rowCount !== 1) throw new Error('postcheck failed: default administrator is not unique');
    if (
      adminUser.rows[0]?.organization_count !== 1
      || adminUser.rows[0]?.has_platform_admin !== true
    ) {
      throw new Error('postcheck failed: default administrator lacks the platform-admin membership');
    }
    const source = await nano.query(
      `SELECT 1 FROM sources WHERE owner_user_id = $1 AND kind = 'private'`,
      [adminUser.rows[0]!.id],
    );
    if (source.rowCount !== 1) throw new Error('postcheck failed: administrator private source is not unique');
  } finally {
    await identity.end();
    await nano.end();
  }
}
