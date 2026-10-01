import { Pool } from 'pg';

let pool: Pool | null = null;

function getAgentDatabaseUrl(): string {
  const url = process.env.AGENT_DATABASE_URL;
  if (!url) {
    throw new Error('未配置 AGENT_DATABASE_URL，无法连接 Agent Gateway 数据库');
  }
  return url;
}

export function getAgentGatewayPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getAgentDatabaseUrl() });
  }
  return pool;
}

export async function closeAgentGatewayPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
