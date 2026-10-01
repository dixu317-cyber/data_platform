import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | undefined;

export function getNanoBrainDatabaseUrl(): string {
  const url = process.env.NANO_BRAIN_DATABASE_URL;
  if (!url) {
    throw new Error('NANO_BRAIN_DATABASE_URL is required');
  }
  return url;
}

export function getNanoBrainPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getNanoBrainDatabaseUrl() });
  }
  return pool;
}

export async function closeNanoBrainPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
