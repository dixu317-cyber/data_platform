/**
 * P12 Phase 1 T1b-2：逐行 SQL 读查询（绞杀式，逐函数从"readDb 整库读"迁到"针对性 SQL 查"）。
 *
 * 约束：只做**读**（无写冲突，安全）。写路径仍走 T1b-1 的整库覆盖写（writeDb），
 * 因此这里查询的表**不能**被从整库覆盖写路径摘除——读查询只是绕过"加载全部 12 表"的开销、
 * 拿到 SQL 级过滤/排序/分页，结果与原内存实现逐字等价。
 * 保真：只 SELECT data JSONB 还原元素（与 loadDbFromPg 同约定）；热点列/JSONB 运算仅用于 WHERE/ORDER。
 */
import { getPlatformPool } from './db';

type AnyRecord = Record<string, unknown>;

// 表名闭集：把"表名是内部常量、非用户输入"这一安全不变量编码进类型（codex NIT）。
type PlatformTable = 'audit_events' | 'chat_traces' | 'global_chat_sessions' | 'scenario_chat_sessions' | 'scenarios';

/** listAdminAuditEvents：全部审计事件，按 createdAt 降序（等价 [...auditEvents].sort(b.createdAt.localeCompare)）。 */
export async function queryAuditEventsDesc(): Promise<AnyRecord[]> {
  const pool = getPlatformPool();
  const res = await pool.query(`SELECT data FROM audit_events ORDER BY data->>'createdAt' DESC`);
  return res.rows.map((r) => r.data as AnyRecord);
}

/**
 * 按 id 查单元素（等价 db.<coll>.find(x => x.id === id) ?? null）。
 * 注意 normalizeDb 对以下集合无元素级变换，故直接查 data JSONB 保真；
 * ORDER BY ord + LIMIT 1 使重复 id 时取"数组首个"，与 Array.find 一致。
 */
async function queryById(table: PlatformTable, id: string): Promise<AnyRecord | null> {
  const pool = getPlatformPool();
  const res = await pool.query(`SELECT data FROM ${table} WHERE data->>'id' = $1 ORDER BY ord ASC LIMIT 1`, [id]);
  return res.rowCount ? (res.rows[0].data as AnyRecord) : null;
}

/** 按 ord 取全集合（等价 db.<coll>，无元素变换的集合专用）。 */
async function queryAll(table: PlatformTable): Promise<AnyRecord[]> {
  const pool = getPlatformPool();
  const res = await pool.query(`SELECT data FROM ${table} ORDER BY ord ASC`);
  return res.rows.map((r) => r.data as AnyRecord);
}

// traces（normalizeDb 仅 `db.traces ?? []`，无元素变换）
export const queryTraceById = (id: string) => queryById('chat_traces', id);
export const queryAllTraces = () => queryAll('chat_traces');

// 全域会话（normalizeDb 仅 spread，无元素变换；权限/清洗仍在调用方 JS）
export const queryGlobalSessionById = (id: string) => queryById('global_chat_sessions', id);
export const queryAllGlobalSessions = () => queryAll('global_chat_sessions');

// 场景 + 场景会话（均无元素变换；权限/清洗在调用方 JS）
export const queryScenarioById = (id: string) => queryById('scenarios', id);

export async function queryScenarioChatSession(scenarioId: string, sessionId: string): Promise<AnyRecord | null> {
  const pool = getPlatformPool();
  const res = await pool.query(
    `SELECT data FROM scenario_chat_sessions WHERE data->>'id' = $1 AND data->>'scenarioId' = $2 ORDER BY ord ASC LIMIT 1`,
    [sessionId, scenarioId],
  );
  return res.rowCount ? (res.rows[0].data as AnyRecord) : null;
}

export async function queryScenarioChatSessionsByScenario(scenarioId: string): Promise<AnyRecord[]> {
  const pool = getPlatformPool();
  const res = await pool.query(
    `SELECT data FROM scenario_chat_sessions WHERE data->>'scenarioId' = $1 ORDER BY ord ASC`,
    [scenarioId],
  );
  return res.rows.map((r) => r.data as AnyRecord);
}
