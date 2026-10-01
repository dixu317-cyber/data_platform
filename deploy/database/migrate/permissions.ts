import pg from 'pg';
import { DATABASES, LIGHTRAG_SCHEMA, MIGRATOR_ROLE, databaseUrl, quoteIdentifier, requiredEnv } from './topology';

const { Client } = pg;

async function grantSchemaObjects(client: pg.Client, schema: string, runtimeRole: string): Promise<void> {
  const qSchema = quoteIdentifier(schema);
  const qRole = quoteIdentifier(runtimeRole);
  await client.query(`GRANT USAGE ON SCHEMA ${qSchema} TO ${qRole}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${qSchema} TO ${qRole}`);
  await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${qSchema} TO ${qRole}`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdentifier(MIGRATOR_ROLE)} IN SCHEMA ${qSchema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${qRole}`,
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdentifier(MIGRATOR_ROLE)} IN SCHEMA ${qSchema} GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${qRole}`,
  );
}

export async function applyRuntimeGrants(): Promise<void> {
  const adminUrl = requiredEnv('POSTGRES_ADMIN_URL');
  for (const database of DATABASES) {
    const client = new Client({ connectionString: databaseUrl(adminUrl, database.name) });
    await client.connect();
    try {
      await client.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
      await grantSchemaObjects(client, 'public', database.runtimeRole);
      if (database.name === 'agent_gateway_db') {
        await grantSchemaObjects(client, 'langgraph', database.runtimeRole);
      }
      if (database.name === 'graph_rag_db') {
        await client.query(
          `GRANT USAGE, CREATE ON SCHEMA ${quoteIdentifier(LIGHTRAG_SCHEMA)} TO ${quoteIdentifier(database.runtimeRole)}`,
        );
        await grantSchemaObjects(client, LIGHTRAG_SCHEMA, database.runtimeRole);
        await client.query(
          `ALTER ROLE ${quoteIdentifier(database.runtimeRole)} IN DATABASE ${quoteIdentifier(database.name)} SET search_path TO ${quoteIdentifier(LIGHTRAG_SCHEMA)}, public`,
        );
        await client.query(
          `ALTER ROLE ${quoteIdentifier(MIGRATOR_ROLE)} IN DATABASE ${quoteIdentifier(database.name)} SET search_path TO ${quoteIdentifier(LIGHTRAG_SCHEMA)}, public`,
        );
      } else {
        await client.query(
          `ALTER ROLE ${quoteIdentifier(database.runtimeRole)} IN DATABASE ${quoteIdentifier(database.name)} SET search_path TO public`,
        );
      }
    } finally {
      await client.end();
    }
  }
}
