import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | undefined;

export function getIdentityDatabaseUrl(): string {
  const url = process.env.IDENTITY_DATABASE_URL;
  if (!url) {
    throw new Error('IDENTITY_DATABASE_URL is required');
  }
  return url;
}

export function getIdentityPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getIdentityDatabaseUrl() });
  }
  return pool;
}

export async function closeIdentityPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
