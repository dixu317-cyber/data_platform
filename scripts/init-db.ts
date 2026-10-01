import pg from 'pg';
import { migrateIdentityDatabase } from '@ff/identity';
import { migratePlatformDatabase } from '@ff/platform';
import { migrateNanoBrainDatabase } from '@ff/nano-brain';
import { setupAgentCheckpointSchema } from '../apps/agent-gateway/src/agent/checkpointer';
import { migrateAgentGatewayDatabase } from '../apps/agent-gateway/src/migrations';
import { bootstrapDatabases } from '../deploy/database/migrate/bootstrap';
import { applyRuntimeGrants } from '../deploy/database/migrate/permissions';
import { runPostcheck } from '../deploy/database/migrate/postcheck';
import { assertFrozenUrls, requiredEnv } from '../deploy/database/migrate/topology';
import { ensureDefaultAdmin } from './create-admin';

const { Pool } = pg;

async function phase(name: string, action: () => Promise<void>): Promise<void> {
  console.log(`[migrate] start ${name}`);
  await action();
  console.log(`[migrate] done ${name}`);
}

async function run(command: string[], env: Record<string, string>): Promise<void> {
  const child = Bun.spawn(command, {
    env: { ...process.env, ...env },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${command.join(' ')} failed with exit code ${code}`);
}

async function migrateTypescriptDatabases(): Promise<void> {
  const targets = [
    [requiredEnv('IDENTITY_MIGRATION_DATABASE_URL'), migrateIdentityDatabase],
    [requiredEnv('PLATFORM_MIGRATION_DATABASE_URL'), migratePlatformDatabase],
    [requiredEnv('NANO_BRAIN_MIGRATION_DATABASE_URL'), migrateNanoBrainDatabase],
    [requiredEnv('AGENT_MIGRATION_DATABASE_URL'), migrateAgentGatewayDatabase],
  ] as const;
  for (const [connectionString, migrate] of targets) {
    const pool = new Pool({ connectionString });
    try {
      await migrate(pool);
    } finally {
      await pool.end();
    }
  }
  await setupAgentCheckpointSchema(requiredEnv('AGENT_MIGRATION_DATABASE_URL'));
}

async function migratePythonDatabases(): Promise<void> {
  await run(
    ['modules/traditional-rag/.venv/bin/python', '-m', 'traditional_rag.db.migrations'],
    { TRADITIONAL_RAG_DATABASE_URL: requiredEnv('TRADITIONAL_RAG_MIGRATION_DATABASE_URL') },
  );
  await run(
    ['modules/graph-rag/.venv/bin/python', '-m', 'graph_rag.db.migrations'],
    { GRAPH_RAG_DATABASE_URL: requiredEnv('GRAPH_RAG_MIGRATION_DATABASE_URL') },
  );
  await run(
    ['modules/graph-rag/.venv/bin/python', 'deploy/database/migrate/graph_setup.py'],
    { GRAPH_RAG_DATABASE_URL: requiredEnv('GRAPH_RAG_MIGRATION_DATABASE_URL') },
  );
}

export async function initializeDatabases(): Promise<void> {
  assertFrozenUrls();
  await phase('bootstrap roles, databases and extensions', bootstrapDatabases);
  await phase('application migrations and migrate-only setup', async () => {
    await migrateTypescriptDatabases();
    await migratePythonDatabases();
  });
  await phase('runtime grants', applyRuntimeGrants);
  await phase('default administrator', async () => { await ensureDefaultAdmin(); });
  await phase('postcheck', runPostcheck);
}

if (import.meta.main) {
  initializeDatabases().catch((error) => {
    console.error('[migrate] failed', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
