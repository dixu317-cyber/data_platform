/**
 * P12 Phase 1 T1b-1：PlatformDb ↔ PG 关系表 的拆解/重组存储层。
 *
 * - saveDbToPg：把内存 PlatformDb 的 12 集合拆解成行写入 12 张表（+ platform_config 单例表，
 *   共 13 张物理表；事务、整库覆盖，语义等同旧 writeDb 的"整个 JSON 覆盖写"，配合
 *   platform-store 的 withDbLock 串行）。
 * - loadDbFromPg：从表重组回 PlatformDb（ORDER BY ord 保数组序）。
 *
 * 保真约定：每行 data JSONB 存**完整元素**，重组只读 data → 往返无损（行为等价的基石）；
 * 热点列（owner/scenario/status/created_at…）仅供 SQL 过滤/索引，重组时不参与还原。
 * 嵌套数组（会话内 messages、trace 内 spans、知识对象内 moduleReferences）留在元素 data 内。
 *
 * T1b-1 是"整库读改写 + 进程内锁"的过渡形态（拿到关系表 + 可查询 + 行为可证等价）；
 * 逐行 SQL 化 + 跨进程并发留 T1b-2 逐表绞杀。
 */
import { getPlatformPool } from './db';

type AnyRecord = Record<string, unknown>;
type Element = AnyRecord & { id: string };

type CollectionSpec = {
  key: string;                 // PlatformDb 集合字段名
  table: string;               // 表名
  cols: string[];              // 热点列名（不含 id/ord/data）
  extract: (e: AnyRecord) => Array<unknown>; // 按 cols 顺序提取热点列值
};

/**
 * 时间列守卫：热点 TIMESTAMPTZ 列仅供 SQL 查询/索引，真实值始终在 data JSONB（往返无损靠 data）。
 * 部分字段是人类可读的显示串（如 ProcessingTask.updatedAt = "刚刚"），非 ISO 一律存 NULL，
 * 避免入库时 TIMESTAMPTZ 解析报错，且不丢任何数据。
 */
function toTs(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}[T ]/.test(v) ? v : null;
}

const COLLECTIONS: CollectionSpec[] = [
  {
    key: 'scenarios', table: 'scenarios',
    cols: ['owner_user_id', 'organization_id', 'visibility', 'status', 'template_id', 'created_at', 'updated_at'],
    extract: (e) => [e.ownerUserId ?? null, e.organizationId ?? null, e.visibility ?? null, e.status ?? null, e.templateId ?? null, toTs(e.createdAt), toTs(e.updatedAt)],
  },
  {
    key: 'tasks', table: 'tasks',
    cols: ['scenario_id', 'owner_user_id', 'status', 'kind', 'created_at', 'updated_at'],
    extract: (e) => [e.scenarioId ?? null, e.ownerUserId ?? null, e.status ?? null, e.kind ?? null, toTs(e.createdAt), toTs(e.updatedAtIso ?? e.updatedAt)],
  },
  {
    key: 'files', table: 'files',
    cols: ['scenario_id', 'deleted_at', 'uploaded_at'],
    extract: (e) => [e.scenarioId ?? null, toTs(e.deletedAt), toTs(e.uploadedAt)],
  },
  {
    key: 'parsedArtifacts', table: 'parsed_artifacts',
    cols: ['scenario_id', 'source_file_id', 'rag_engine', 'created_at'],
    extract: (e) => [e.scenarioId ?? null, e.sourceFileId ?? null, e.ragEngine ?? null, toTs(e.createdAt)],
  },
  {
    key: 'knowledgeObjects', table: 'knowledge_objects',
    cols: ['scenario_id', 'source_file_id', 'rag_engine', 'kind', 'created_at'],
    extract: (e) => [e.scenarioId ?? null, e.sourceFileId ?? null, e.ragEngine ?? null, e.kind ?? null, toTs(e.createdAt)],
  },
  {
    key: 'moduleReferences', table: 'module_references',
    cols: ['scenario_id', 'source_file_id', 'engine', 'object_id', 'status', 'created_at'],
    extract: (e) => [e.scenarioId ?? null, e.sourceFileId ?? null, e.engine ?? null, e.objectId ?? null, e.status ?? null, toTs(e.createdAt)],
  },
  {
    key: 'chatSessions', table: 'global_chat_sessions',
    cols: ['owner_user_id', 'scope', 'thread_id', 'created_at', 'updated_at'],
    extract: (e) => [e.ownerUserId ?? null, e.scope ?? null, e.threadId ?? null, toTs(e.createdAt), toTs(e.updatedAt)],
  },
  {
    key: 'scenarioChatSessions', table: 'scenario_chat_sessions',
    cols: ['scenario_id', 'owner_user_id', 'created_at', 'updated_at'],
    extract: (e) => [e.scenarioId ?? null, e.ownerUserId ?? null, toTs(e.createdAt), toTs(e.updatedAt)],
  },
  {
    key: 'templates', table: 'admin_templates',
    cols: ['state', 'source', 'created_at', 'updated_at'],
    extract: (e) => [e.state ?? null, e.source ?? null, toTs(e.createdAt), toTs(e.updatedAt)],
  },
  {
    key: 'auditEvents', table: 'audit_events',
    cols: ['actor', 'created_at'],
    extract: (e) => [e.actor ?? null, toTs(e.createdAt)],
  },
  {
    key: 'traces', table: 'chat_traces',
    cols: ['kind', 'scenario_id', 'user_id', 'success', 'created_at'],
    extract: (e) => [e.kind ?? null, e.scenarioId ?? null, e.userId ?? null, e.success ?? null, toTs(e.createdAt)],
  },
  {
    // 022b · P46:ingestQueue 新增集合（第 13 表）——登记即接线，saveDbToPg/loadDbFromPg/truncateAllPg 自动覆盖。
    key: 'ingestQueue', table: 'ingest_queue',
    cols: ['task_id', 'scenario_id', 'status', 'enqueued_at'],
    extract: (e) => [e.taskId ?? null, e.scenarioId ?? null, e.status ?? null, toTs(e.enqueuedAt)],
  },
  {
    // 024 · P48:notifications 新增集合（第 14 表）——登记即接线，saveDbToPg/loadDbFromPg/truncateAllPg 自动覆盖。
    key: 'notifications', table: 'notifications',
    cols: ['user_id', 'read', 'created_at'],
    extract: (e) => [e.userId ?? null, e.read ?? null, toTs(e.createdAt)],
  },
];

// 单例配置：PlatformDb 字段 ↔ platform_config.key
const CONFIG_SINGLETONS: Array<{ key: string; configKey: string }> = [
  { key: 'runtimeConfig', configKey: 'runtime' },
  { key: 'engineRetrievalConfig', configKey: 'engineRetrieval' },
];

/** 整库拆解写入（事务 + 整表覆盖）。语义等同旧 writeDb 的整 JSON 覆盖写。 */
export async function saveDbToPg(db: AnyRecord): Promise<void> {
  const pool = getPlatformPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const spec of COLLECTIONS) {
      await client.query(`DELETE FROM ${spec.table}`);
      const items = Array.isArray(db[spec.key]) ? (db[spec.key] as Element[]) : [];
      const colNames = ['id', 'ord', ...spec.cols, 'data'];
      for (let i = 0; i < items.length; i++) {
        const e = items[i];
        const values = [e.id, i, ...spec.extract(e), JSON.stringify(e)];
        const placeholders = colNames.map((_, idx) => `$${idx + 1}`).join(', ');
        await client.query(`INSERT INTO ${spec.table} (${colNames.join(', ')}) VALUES (${placeholders})`, values);
      }
    }
    for (const { key, configKey } of CONFIG_SINGLETONS) {
      const value = db[key];
      if (value === undefined || value === null) {
        await client.query(`DELETE FROM platform_config WHERE key = $1`, [configKey]);
      } else {
        await client.query(
          `INSERT INTO platform_config (key, data, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [configKey, JSON.stringify(value)],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** 清空全部平台表（resetPlatformStore 用；新 schema 无外键，TRUNCATE 一句原子清空）。 */
export async function truncateAllPg(): Promise<void> {
  const pool = getPlatformPool();
  const tables = [...COLLECTIONS.map((c) => c.table), 'platform_config'];
  await pool.query(`TRUNCATE ${tables.join(', ')}`);
}

/** 从 PG 重组回 PlatformDb 的集合部分（ORDER BY ord 保序；只读 data JSONB → 往返无损）。 */
export async function loadDbFromPg(): Promise<AnyRecord> {
  const pool = getPlatformPool();
  const result: AnyRecord = {};
  for (const spec of COLLECTIONS) {
    const res = await pool.query(`SELECT data FROM ${spec.table} ORDER BY ord ASC`);
    result[spec.key] = res.rows.map((r) => r.data);
  }
  const cfg = await pool.query(`SELECT key, data FROM platform_config`);
  for (const { key, configKey } of CONFIG_SINGLETONS) {
    const row = cfg.rows.find((r) => r.key === configKey);
    if (row) result[key] = row.data;
  }
  return result;
}
