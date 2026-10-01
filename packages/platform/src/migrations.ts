import type pg from 'pg';
import { getPlatformPool } from './db';

/**
 * P12 Phase 1 T1b：平台业务库关系 schema。
 *
 * 表结构直接对应 platform-store.ts 的 PlatformDb 真实集合（12 集合表 + 1 配置表 = 13 物理表；
 * 022b 新增 ingest_queue 为第 13 张，即第 12 张集合表）。
 * 模式：关系信封 + JSONB 载荷 —— 每行 = id + 热点查询列（可 SQL 过滤/索引）+ data JSONB（完整元素，往返无损）。
 * 嵌套数组（会话内 messages、trace 内 spans、知识对象内 moduleReferences）留在元素 JSONB 内，
 * 与业务逻辑"按嵌套读"一致；T1b-1 靠 readDb 重组/writeDb 拆解实现行为等价，逐行 SQL 化留 T1b-2。
 */
export async function migratePlatformDatabase(pool: pg.Pool = getPlatformPool()): Promise<void> {

  // 1. scenarios（StoredScenario）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scenarios (
      pk BIGSERIAL PRIMARY KEY,
      id TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0,
      owner_user_id TEXT,
      organization_id TEXT,
      visibility TEXT,
      status TEXT,
      template_id TEXT,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ,
      data JSONB NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_scenarios_owner ON scenarios(owner_user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_scenarios_org ON scenarios(organization_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_scenarios_status ON scenarios(status);`);

  // 2. tasks（StoreTask = ProcessingTask + ownerUserId/createdAt/...）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      pk BIGSERIAL PRIMARY KEY,
      id TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0,
      scenario_id TEXT,
      owner_user_id TEXT,
      status TEXT,
      kind TEXT,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ,
      data JSONB NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_scenario ON tasks(scenario_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);`);

  // 3. files（StoredFileRecord）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS files (
      pk BIGSERIAL PRIMARY KEY,
      id TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0,
      scenario_id TEXT,
      deleted_at TIMESTAMPTZ,
      uploaded_at TIMESTAMPTZ,
      data JSONB NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_files_scenario ON files(scenario_id);`);

  // 4. parsed_artifacts（StoredParsedArtifact）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS parsed_artifacts (
      pk BIGSERIAL PRIMARY KEY,
      id TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0,
      scenario_id TEXT,
      source_file_id TEXT,
      rag_engine TEXT,
      created_at TIMESTAMPTZ,
      data JSONB NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_parsed_artifacts_scenario ON parsed_artifacts(scenario_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_parsed_artifacts_file ON parsed_artifacts(source_file_id);`);

  // 5. knowledge_objects（StoredKnowledgeObject；内含 moduleReferences 嵌套）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_objects (
      pk BIGSERIAL PRIMARY KEY,
      id TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0,
      scenario_id TEXT,
      source_file_id TEXT,
      rag_engine TEXT,
      kind TEXT,
      created_at TIMESTAMPTZ,
      data JSONB NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_objects_scenario ON knowledge_objects(scenario_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_knowledge_objects_engine ON knowledge_objects(rag_engine);`);

  // 6. module_references（StoredModuleReference，顶层集合）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS module_references (
      pk BIGSERIAL PRIMARY KEY,
      id TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0,
      scenario_id TEXT,
      source_file_id TEXT,
      engine TEXT,
      object_id TEXT,
      status TEXT,
      created_at TIMESTAMPTZ,
      data JSONB NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_module_references_scenario ON module_references(scenario_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_module_references_object ON module_references(object_id);`);

  // 7. global_chat_sessions（StoredGlobalChatSession；messages 嵌套）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS global_chat_sessions (
      pk BIGSERIAL PRIMARY KEY,
      id TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0,
      owner_user_id TEXT,
      scope TEXT,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ,
      thread_id TEXT,
      data JSONB NOT NULL
    );
  `);
  // P36a: 全域会话 ↔ agent thread 映射。旧库补列 + thread_id 唯一（部分索引允许历史行 NULL）。
  await pool.query(`ALTER TABLE global_chat_sessions ADD COLUMN IF NOT EXISTS thread_id TEXT;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_global_chat_thread ON global_chat_sessions(thread_id) WHERE thread_id IS NOT NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_global_chat_owner ON global_chat_sessions(owner_user_id);`);

  // 8. scenario_chat_sessions（StoredScenarioChatSession；messages 嵌套）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scenario_chat_sessions (
      pk BIGSERIAL PRIMARY KEY,
      id TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0,
      scenario_id TEXT,
      owner_user_id TEXT,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ,
      data JSONB NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_scenario_chat_scenario ON scenario_chat_sessions(scenario_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_scenario_chat_owner ON scenario_chat_sessions(owner_user_id);`);

  // 9. admin_templates（StoredAdminTemplate）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_templates (
      pk BIGSERIAL PRIMARY KEY,
      id TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0,
      state TEXT,
      source TEXT,
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ,
      data JSONB NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_templates_state ON admin_templates(state);`);

  // 10. audit_events（StoredAdminAuditEvent）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_events (
      pk BIGSERIAL PRIMARY KEY,
      id TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0,
      actor TEXT,
      created_at TIMESTAMPTZ,
      data JSONB NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);`);

  // 11. chat_traces（StoredChatTrace；spans 嵌套）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_traces (
      pk BIGSERIAL PRIMARY KEY,
      id TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0,
      kind TEXT,
      scenario_id TEXT,
      user_id TEXT,
      success BOOLEAN,
      created_at TIMESTAMPTZ,
      data JSONB NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_traces_user ON chat_traces(user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_traces_scenario ON chat_traces(scenario_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_traces_created ON chat_traces(created_at);`);

  // 12. platform_config（单例：runtimeConfig / engineRetrievalConfig）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_config (
      key TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // 13. ingest_queue（022b · P46：IngestQueueJob，持久摄取队列）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ingest_queue (
      pk BIGSERIAL PRIMARY KEY,
      id TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0,
      task_id TEXT,
      scenario_id TEXT,
      status TEXT,
      enqueued_at TIMESTAMPTZ,
      data JSONB NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ingest_queue_status ON ingest_queue(status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ingest_queue_enqueued ON ingest_queue(enqueued_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ingest_queue_task ON ingest_queue(task_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ingest_queue_scenario ON ingest_queue(scenario_id);`);

  // 14. notifications（024 · P48：StoredNotification，站内通知）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      pk BIGSERIAL PRIMARY KEY,
      id TEXT NOT NULL,
      ord INTEGER NOT NULL DEFAULT 0,
      user_id TEXT,
      read BOOLEAN,
      created_at TIMESTAMPTZ,
      data JSONB NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);`);
}
