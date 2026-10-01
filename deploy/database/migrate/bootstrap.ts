import pg from 'pg';
import {
  DATABASES, LIGHTRAG_SCHEMA, MIGRATOR_ROLE, databaseUrl, quoteIdentifier, requiredEnv,
} from './topology';

const { Client } = pg;

async function sqlLiteral(client: pg.Client, value: string): Promise<string> {
  const result = await client.query<{ value: string }>(`SELECT format('%L', $1::text) AS value`, [value]);
  return result.rows[0]!.value;
}

async function ensureLoginRole(client: pg.Client, role: string, password: string, noInherit: boolean): Promise<void> {
  const exists = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role]);
  if (!exists.rowCount) await client.query(`CREATE ROLE ${quoteIdentifier(role)} LOGIN`);
  const passwordLiteral = await sqlLiteral(client, password);
  await client.query(
    `ALTER ROLE ${quoteIdentifier(role)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE ${noInherit ? 'NOINHERIT' : 'INHERIT'} PASSWORD ${passwordLiteral}`,
  );
}

export async function bootstrapDatabases(): Promise<void> {
  const adminUrl = requiredEnv('POSTGRES_ADMIN_URL');
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await ensureLoginRole(admin, MIGRATOR_ROLE, requiredEnv('POSTGRES_MIGRATOR_PASSWORD'), false);
    for (const database of DATABASES) {
      await ensureLoginRole(admin, database.runtimeRole, requiredEnv(database.passwordEnv), true);
    }

    for (const database of DATABASES) {
      const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [database.name]);
      if (!exists.rowCount) {
        await admin.query(`CREATE DATABASE ${quoteIdentifier(database.name)} OWNER ${quoteIdentifier(MIGRATOR_ROLE)}`);
      } else {
        await admin.query(`ALTER DATABASE ${quoteIdentifier(database.name)} OWNER TO ${quoteIdentifier(MIGRATOR_ROLE)}`);
      }
      await admin.query(`REVOKE CONNECT ON DATABASE ${quoteIdentifier(database.name)} FROM PUBLIC`);
      await admin.query(
        `GRANT CONNECT ON DATABASE ${quoteIdentifier(database.name)} TO ${quoteIdentifier(MIGRATOR_ROLE)}, ${quoteIdentifier(database.runtimeRole)}`,
      );
    }
  } finally {
    await admin.end();
  }

  for (const database of DATABASES) {
    const target = new Client({ connectionString: databaseUrl(adminUrl, database.name) });
    await target.connect();
    try {
      for (const extension of database.extensions) {
        await target.query(`CREATE EXTENSION IF NOT EXISTS ${quoteIdentifier(extension)}`);
      }
      await target.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
      if (database.name === 'graph_rag_db') {
        await target.query(
          `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(LIGHTRAG_SCHEMA)} AUTHORIZATION ${quoteIdentifier(MIGRATOR_ROLE)}`,
        );
      }
    } finally {
      await target.end();
    }
  }
}
