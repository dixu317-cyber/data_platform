import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | undefined;

export function getPlatformDatabaseUrl(): string {
  const url = process.env.PLATFORM_DATABASE_URL;
  if (!url) {
    throw new Error('PLATFORM_DATABASE_URL is required');
  }
  return url;
}

export function getPlatformPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getPlatformDatabaseUrl() });
  }
  return pool;
}

export async function closePlatformPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
