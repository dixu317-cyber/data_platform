import type pg from 'pg';
import { getNanoBrainPool } from './db';

export async function migrateNanoBrainDatabase(pool: pg.Pool = getNanoBrainPool()): Promise<void> {

  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('private', 'public')),
      owner_user_id TEXT,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (
        (kind = 'private' AND owner_user_id IS NOT NULL)
        OR
        (kind = 'public' AND owner_user_id IS NULL)
      )
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_private_owner_name
    ON sources (owner_user_id, name)
    WHERE kind = 'private';
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_public_name
    ON sources (name)
    WHERE kind = 'public';
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sources_kind ON sources (kind);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sources_owner_user_id ON sources (owner_user_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (source_id, slug)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pages_source_id ON pages (source_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pages_content_hash ON pages (content_hash);
  `);

  await pool.query(`
    ALTER TABLE pages
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
  `);

  await pool.query(`
    ALTER TABLE pages
    ADD COLUMN IF NOT EXISTS archived_by TEXT;
  `);

  await pool.query(`
    ALTER TABLE pages
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);

  // 014 · FR-362 · §5.2:pages 升级为编译条目载体(增量列,可独立回滚)。
  // back-compat 存量直通:ADD COLUMN ... DEFAULT 把存量逐字页填为 entry_kind='raw_passthrough' + compile_status='uncompiled'
  //   —— 编译前照常可读(body=原文),008 NanoPage{slug,title,body} 契约不破。
  // CHECK 用 DROP+ADD 命名约束(幂等,可放开值域;照现有 dream_locks/dream_runs 风格)。
  await pool.query(`
    ALTER TABLE pages
    ADD COLUMN IF NOT EXISTS entry_kind TEXT NOT NULL DEFAULT 'raw_passthrough';
  `);
  await pool.query(`
    ALTER TABLE pages
    ADD COLUMN IF NOT EXISTS compile_status TEXT NOT NULL DEFAULT 'uncompiled';
  `);
  await pool.query(`
    ALTER TABLE pages
    ADD COLUMN IF NOT EXISTS compile_version TEXT;
  `);
  await pool.query(`
    ALTER TABLE pages
    ADD COLUMN IF NOT EXISTS granularity TEXT;
  `);

  await pool.query(`
    ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_entry_kind_check;
  `);
  await pool.query(`
    ALTER TABLE pages
    ADD CONSTRAINT pages_entry_kind_check
    CHECK (entry_kind IN ('raw_passthrough', 'source_entry', 'theme_entry'));
  `);
  await pool.query(`
    ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_compile_status_check;
  `);
  await pool.query(`
    ALTER TABLE pages
    ADD CONSTRAINT pages_compile_status_check
    CHECK (compile_status IN ('uncompiled', 'compiling', 'compiled', 'stale', 'failed'));
  `);
  await pool.query(`
    ALTER TABLE pages DROP CONSTRAINT IF EXISTS pages_granularity_check;
  `);
  await pool.query(`
    ALTER TABLE pages
    ADD CONSTRAINT pages_granularity_check
    CHECK (granularity IS NULL OR granularity IN ('document', 'theme', 'paragraph'));
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pages_entry_kind ON pages (entry_kind);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pages_compile_status ON pages (compile_status);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pages_archived_at ON pages (archived_at);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pages_metadata_gin ON pages USING GIN (metadata);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      embedding vector NOT NULL,
      embedding_model TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (page_id, chunk_index)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chunks_page_id ON chunks (page_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chunks_source_slug ON chunks (source_id, slug);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_chunks_content_hash ON chunks (content_hash);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      from_page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      from_slug TEXT NOT NULL,
      to_source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
      to_slug TEXT NOT NULL,
      link_type TEXT NOT NULL DEFAULT 'mentions',
      context TEXT,
      confidence REAL NOT NULL DEFAULT 1.0,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (source_id, from_slug, to_slug, link_type)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_links_source_from ON links (source_id, from_slug);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_links_to_slug ON links (to_slug);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_links_link_type ON links (link_type);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fact_submissions (
      id TEXT PRIMARY KEY,
      target_source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
      submitted_by TEXT NOT NULL,
      raw_claim TEXT NOT NULL,
      raw_evidence_text TEXT,
      raw_evidence_url TEXT,
      raw_context TEXT,
      warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'needs_changes', 'approved', 'rejected')),
      normalized_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fact_submissions_submitted_by
    ON fact_submissions (submitted_by, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fact_submissions_status
    ON fact_submissions (status, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fact_submissions_target_source
    ON fact_submissions (target_source_id, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS facts (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
      submission_id TEXT NOT NULL UNIQUE REFERENCES fact_submissions(id) ON DELETE RESTRICT,
      entity_slug TEXT,
      fact TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('fact', 'event', 'preference', 'commitment', 'belief')),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      notability TEXT NOT NULL CHECK (notability IN ('high', 'medium', 'low')),
      context TEXT,
      valid_from DATE,
      valid_until DATE,
      claim_metric TEXT,
      claim_value DOUBLE PRECISION,
      claim_unit TEXT,
      claim_period TEXT,
      evidence_url TEXT,
      evidence_quote TEXT,
      approved_by TEXT NOT NULL,
      approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      embedding vector,
      embedding_model TEXT,
      retrievable BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // 004 · FR-160:审核通过 fact 接检索面。既有 DB 增量补列(可独立拆分/回滚)。
  // embedding/embedding_model 可空:嵌入失败不回滚 fact 结构化入库,retrievable 标待补,由 dream/refresh 补嵌。
  // 存量 fact 初值 retrievable=false —— 待 dream 相位补嵌后翻真,不在迁移内同步嵌入(避免迁移阻塞在 embedding 服务)。
  await pool.query(`
    ALTER TABLE facts ADD COLUMN IF NOT EXISTS embedding vector;
  `);
  await pool.query(`
    ALTER TABLE facts ADD COLUMN IF NOT EXISTS embedding_model TEXT;
  `);
  await pool.query(`
    ALTER TABLE facts ADD COLUMN IF NOT EXISTS retrievable BOOLEAN NOT NULL DEFAULT false;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_facts_source_id
    ON facts (source_id, created_at DESC);
  `);

  // 可检索 fact 召回索引:仅 retrievable 集参与,配合 valid_until 生命周期过滤(FR-165)。
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_facts_retrievable
    ON facts (source_id, entity_slug)
    WHERE retrievable = true;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_facts_entity_slug
    ON facts (entity_slug, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_facts_approved_by
    ON facts (approved_by, approved_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      previous_status TEXT,
      next_status TEXT,
      review_comment TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_target
    ON audit_logs (target_type, target_id, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
    ON audit_logs (actor_user_id, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action
    ON audit_logs (action, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dream_locks (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL CHECK (target_type IN ('user_source', 'public_source', 'review_queue')),
      target_source_id TEXT REFERENCES sources(id) ON DELETE CASCADE,
      target_user_id TEXT,
      holder_id TEXT NOT NULL,
      holder_host TEXT,
      acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      ttl_expires_at TIMESTAMPTZ NOT NULL,
      CHECK (
        (target_type = 'user_source' AND target_source_id IS NOT NULL AND target_user_id IS NOT NULL)
        OR
        (target_type = 'public_source' AND target_source_id IS NOT NULL AND target_user_id IS NULL)
        OR
        (target_type = 'review_queue' AND target_user_id IS NULL)
      )
    );
  `);

  await pool.query(`
    ALTER TABLE dream_locks
    DROP CONSTRAINT IF EXISTS dream_locks_target_shape;
  `);

  await pool.query(`
    ALTER TABLE dream_locks
    ADD CONSTRAINT dream_locks_target_shape CHECK (
      (target_type = 'user_source' AND target_source_id IS NOT NULL AND target_user_id IS NOT NULL)
      OR
      (target_type = 'public_source' AND target_source_id IS NOT NULL AND target_user_id IS NULL)
      OR
      (target_type = 'review_queue' AND target_user_id IS NULL)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dream_locks_ttl_expires_at
    ON dream_locks (ttl_expires_at);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dream_locks_target
    ON dream_locks (target_type, target_source_id, target_user_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dream_runs (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL CHECK (target_type IN ('user_source', 'public_source', 'review_queue')),
      target_source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
      target_user_id TEXT,
      target JSONB NOT NULL DEFAULT '{}'::jsonb,
      triggered_by TEXT NOT NULL CHECK (triggered_by IN ('user', 'admin', 'system')),
      triggered_by_user_id TEXT,
      dry_run BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'clean', 'ok', 'partial', 'skipped', 'failed')),
      requested_phases JSONB NOT NULL DEFAULT '[]'::jsonb,
      totals JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (jsonb_typeof(target) = 'object'),
      CHECK (jsonb_typeof(requested_phases) = 'array'),
      CHECK (jsonb_typeof(totals) = 'object'),
      CHECK (
        (target_type = 'user_source' AND target_source_id IS NOT NULL AND target_user_id IS NOT NULL)
        OR
        (target_type = 'public_source' AND target_source_id IS NOT NULL AND target_user_id IS NULL)
        OR
        (target_type = 'review_queue' AND target_user_id IS NULL)
      )
    );
  `);

  await pool.query(`
    ALTER TABLE dream_runs
    DROP CONSTRAINT IF EXISTS dream_runs_target_shape;
  `);

  await pool.query(`
    ALTER TABLE dream_runs
    ADD CONSTRAINT dream_runs_target_shape CHECK (
      (target_type = 'user_source' AND target_source_id IS NOT NULL AND target_user_id IS NOT NULL)
      OR
      (target_type = 'public_source' AND target_source_id IS NOT NULL AND target_user_id IS NULL)
      OR
      (target_type = 'review_queue' AND target_user_id IS NULL)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dream_runs_target_created
    ON dream_runs (target_type, target_source_id, target_user_id, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dream_runs_status_created
    ON dream_runs (status, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dream_phase_runs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES dream_runs(id) ON DELETE CASCADE,
      phase TEXT NOT NULL CHECK (phase IN ('extract_links', 'refresh_embeddings', 'health_check', 'review_queue_summary')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'clean', 'ok', 'skipped', 'failed')),
      duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
      summary TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      error JSONB,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (jsonb_typeof(details) = 'object'),
      CHECK (error IS NULL OR jsonb_typeof(error) = 'object'),
      UNIQUE (run_id, phase)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dream_phase_runs_run
    ON dream_phase_runs (run_id, created_at ASC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_dream_phase_runs_phase_status
    ON dream_phase_runs (phase, status, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS page_dream_state (
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      phase TEXT NOT NULL CHECK (phase IN ('extract_links', 'refresh_embeddings', 'health_check', 'review_queue_summary')),
      phase_version TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      PRIMARY KEY (page_id, phase),
      CHECK (jsonb_typeof(details) = 'object')
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_page_dream_state_source_phase
    ON page_dream_state (source_id, phase, processed_at DESC);
  `);

  // 014 · FR-367 · §5.1 + P20:dream 相位 CHECK 一次性放开 'compile' 与 'auto_link'。
  // 存量表已带内联 CHECK(名 = {table}_{column}_check)→ DROP+ADD 命名约束一次性纳入 compile + auto_link。
  //   🔴 P20 修(codex Phase4.5):auto_link 必须与 compile 在同一次 ADD 内放开——若分两段(先 compile-only
  //   再补 auto_link),迁移重跑时本段先 ADD compile-only CHECK,一旦库中已有 phase='auto_link' 存量数据
  //   即校验失败、整段迁移不可重入。故直接把 auto_link 并入本段值域。
  //   既有 4 相位(extract_links/refresh_embeddings/health_check/review_queue_summary)仍合法,不破坏。
  await pool.query(`
    ALTER TABLE dream_phase_runs DROP CONSTRAINT IF EXISTS dream_phase_runs_phase_check;
  `);
  await pool.query(`
    ALTER TABLE dream_phase_runs
    ADD CONSTRAINT dream_phase_runs_phase_check
    CHECK (phase IN ('extract_links', 'refresh_embeddings', 'health_check', 'review_queue_summary', 'compile', 'auto_link', 'theme_compile'));
  `);
  await pool.query(`
    ALTER TABLE page_dream_state DROP CONSTRAINT IF EXISTS page_dream_state_phase_check;
  `);
  await pool.query(`
    ALTER TABLE page_dream_state
    ADD CONSTRAINT page_dream_state_phase_check
    CHECK (phase IN ('extract_links', 'refresh_embeddings', 'health_check', 'review_queue_summary', 'compile', 'auto_link', 'theme_compile'));
  `);

  // 014 · FR-360 · §5.2:原文全文真理来源(1 文件 1 行,编译无论如何不丢原文)。
  //   UNIQUE(source_id, external_ref) = 幂等 upsert 锚点(FR-371);raw_body 永为归一化原文,编译改 pages.body 不动此表。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS raw_documents (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      external_ref TEXT NOT NULL,
      title TEXT NOT NULL,
      content_type TEXT NOT NULL,
      raw_body TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (source_id, external_ref)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_raw_documents_source_id ON raw_documents (source_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_raw_documents_content_hash ON raw_documents (content_hash);
  `);

  // 014 · FR-361 · §5.2:原文可寻址分片(溯源锚点)。
  //   char_start/char_end 是对 raw_body 的字符偏移:raw_body.slice(char_start,char_end)==chunk_text,分片连续覆盖全文无空洞。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS raw_chunks (
      id TEXT PRIMARY KEY,
      raw_document_id TEXT NOT NULL REFERENCES raw_documents(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      char_start INTEGER NOT NULL,
      char_end INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (raw_document_id, chunk_index),
      CHECK (char_start >= 0 AND char_end > char_start)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_raw_chunks_raw_document ON raw_chunks (raw_document_id, chunk_index);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_raw_chunks_source_id ON raw_chunks (source_id);
  `);

  // 014 · FR-364 · §5.2:分节 → 原文 span 溯源(忠实度地基)。
  //   char_start/char_end 落在对应 raw_document.raw_body 合法区间内;assertion_ordinal 非空=断言级(016 钩子),空=分节级。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS page_provenance (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      section_id TEXT NOT NULL,
      assertion_ordinal INTEGER,
      raw_document_id TEXT NOT NULL REFERENCES raw_documents(id) ON DELETE CASCADE,
      raw_chunk_id TEXT REFERENCES raw_chunks(id) ON DELETE SET NULL,
      char_start INTEGER,
      char_end INTEGER,
      quote TEXT,
      confidence REAL NOT NULL DEFAULT 1.0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_page_provenance_page ON page_provenance (page_id, section_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_page_provenance_raw_document ON page_provenance (raw_document_id);
  `);

  // 014 · FR-372/373 · §5.2:theme_entry 成员记账(N-2 多源熔一篇不漏源)。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS page_members (
      id TEXT PRIMARY KEY,
      theme_page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      member_kind TEXT NOT NULL CHECK (member_kind IN ('source_entry', 'raw_document')),
      member_page_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
      raw_document_id TEXT REFERENCES raw_documents(id) ON DELETE CASCADE,
      cluster_score REAL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_page_members_theme ON page_members (theme_page_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_page_members_member_page ON page_members (member_page_id);
  `);

  // 014 · FR-371/378 · §5.2:编译增量状态(content_hash 增量,重编触发)。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS raw_document_compile_state (
      raw_document_id TEXT PRIMARY KEY REFERENCES raw_documents(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      compile_version TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      compiled_page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
      status TEXT NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_raw_document_compile_state_source ON raw_document_compile_state (source_id);
  `);

  // ─────────────────────────────────────────────────────────────────────────
  // 015 · Gbrain 知识网络 · AM-1501 · FR-380/384/392/396 · §5 · §11
  //   四项 schema 地基,幂等可回滚(ADD COLUMN/CREATE TABLE IF NOT EXISTS + 命名 CHECK DROP+ADD)。
  //   供后续簇消费:T1(links.origin/link_suppressions)/T3(page_versions)/T4(fact_conflicts)。
  // ─────────────────────────────────────────────────────────────────────────

  // 015 · FR-380 · §5.1:links 增 origin(手写/机器链分治:manual/auto/suggested)。
  //   既有手写/markdown 抽出的链默认回填 origin='manual';机器发现相位建 auto/suggested。
  //   CHECK 用 DROP+ADD 命名约束(幂等,可放开值域;照 pages/dream_locks 风格)。
  await pool.query(`
    ALTER TABLE links ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'manual';
  `);
  await pool.query(`
    ALTER TABLE links DROP CONSTRAINT IF EXISTS links_origin_check;
  `);
  await pool.query(`
    ALTER TABLE links
    ADD CONSTRAINT links_origin_check
    CHECK (origin IN ('manual', 'auto', 'suggested'));
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_links_origin ON links (source_id, origin);
  `);

  // 015 · FR-384 · §5.1:误链删除防复活(tombstone)。删 auto / 拒 suggested 后登记,
  //   发现相位 LEFT JOIN 排除被压制边,重跑不复活。手写链(manual)不受 tombstone 约束(人的明确意图)。
  //   唯一约束同 links 四元组 (source_id, from_slug, to_slug, link_type) = 防重复登记 + 排除锚点。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS link_suppressions (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      from_slug TEXT NOT NULL,
      to_slug TEXT NOT NULL,
      link_type TEXT NOT NULL,
      suppressed_by TEXT NOT NULL,
      suppressed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (source_id, from_slug, to_slug, link_type)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_link_suppressions_source ON link_suppressions (source_id);
  `);

  // 015 · FR-392 · §5.3:条目版本历史(更新留版本,非破坏式回滚只增不减)。
  //   version_no 单调自增,UNIQUE (page_id, version_no) 防并发丢版本/跳错;
  //   索引 (page_id, version_no DESC) = 取最新版/列历史。edit_reason 可空(回滚标"回滚自 vK")。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS page_versions (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      version_no INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      edited_by TEXT NOT NULL,
      edit_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (page_id, version_no)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_page_versions_page_version
    ON page_versions (page_id, version_no DESC);
  `);

  // 015 · FR-396 · §5.4:事实冲突登记(标记+进队列,不阻断入库)。
  //   fact_id_a/fact_id_b FK facts(id) ON DELETE CASCADE(fact 删则冲突随删);
  //   status inline CHECK(照 fact_submissions.status 新表内联风格,值域稳定);
  //   UNIQUE (fact_id_a, fact_id_b) = 防同一对重复登记(重跑检测/ sweep 幂等,规范化排序由消费方保证)。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fact_conflicts (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      entity_slug TEXT,
      claim_metric TEXT,
      claim_period TEXT,
      fact_id_a TEXT NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
      fact_id_b TEXT NOT NULL REFERENCES facts(id) ON DELETE CASCADE,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
      resolved_by TEXT,
      resolution_note TEXT,
      UNIQUE (fact_id_a, fact_id_b)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_fact_conflicts_source_status
    ON fact_conflicts (source_id, status, detected_at DESC);
  `);
}
