from graph_rag.db import close_pool, get_connection


def migrate_database() -> None:
    """Create PostgreSQL vector, business and LightRAG-supporting schema.

    Graph storage is Neo4j-only. PostgreSQL retains vector/KV/doc-status data;
    graph readiness is checked at the shared Neo4j boundary, not here.
    """
    _migrate_core_schema()


def _migrate_core_schema() -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS public.graph_sources (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  description TEXT NOT NULL DEFAULT '',
                  kind TEXT NOT NULL CHECK (kind IN ('private', 'public')),
                  workspace TEXT NOT NULL UNIQUE,
                  owner_user_id TEXT,
                  created_by TEXT NOT NULL,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  archived_at TIMESTAMPTZ,
                  CHECK (
                    (kind = 'private' AND owner_user_id IS NOT NULL)
                    OR
                    (kind = 'public' AND owner_user_id IS NULL)
                  )
                );
                """
            )
            cursor.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_sources_private_owner_name
                ON public.graph_sources (owner_user_id, name)
                WHERE kind = 'private' AND archived_at IS NULL;
                """
            )
            cursor.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_graph_sources_public_name
                ON public.graph_sources (name)
                WHERE kind = 'public' AND archived_at IS NULL;
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_graph_sources_readable
                ON public.graph_sources (kind, owner_user_id, archived_at);
                """
            )
            # 012 FR-320/322(发现待回报①):graph_sources 现无 metadata 列 → 加 jsonb metadata 存
            # per-source schema_profile_id(领域 schema 模板绑定)。幂等 ADD COLUMN IF NOT EXISTS,
            # 与 graph_documents.metadata 同型;既有行落回 '{}'(未绑 profile → 出厂默认,零回归)。
            cursor.execute(
                "ALTER TABLE public.graph_sources "
                "ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;"
            )
            # M2-A Stage 3: persisted source-deletion Saga. Keep the six fields
            # exact: later phases and the operational ledger inspect them.
            cursor.execute(
                "ALTER TABLE public.graph_sources "
                "ADD COLUMN IF NOT EXISTS delete_state TEXT NOT NULL DEFAULT 'active', "
                "ADD COLUMN IF NOT EXISTS delete_step TEXT, "
                "ADD COLUMN IF NOT EXISTS delete_attempts INTEGER NOT NULL DEFAULT 0, "
                "ADD COLUMN IF NOT EXISTS delete_error JSONB, "
                "ADD COLUMN IF NOT EXISTS delete_started_at TIMESTAMPTZ, "
                "ADD COLUMN IF NOT EXISTS delete_updated_at TIMESTAMPTZ;"
            )
            cursor.execute(
                "ALTER TABLE public.graph_sources "
                "DROP CONSTRAINT IF EXISTS graph_sources_delete_saga_check;"
            )
            cursor.execute(
                """
                ALTER TABLE public.graph_sources
                ADD CONSTRAINT graph_sources_delete_saga_check CHECK (
                  delete_attempts >= 0
                  AND (
                    (delete_state = 'active'
                      AND delete_step IS NULL
                      AND delete_error IS NULL
                      AND delete_started_at IS NULL
                      AND delete_updated_at IS NULL)
                    OR
                    (delete_state = 'deleting'
                      AND delete_step IN ('drain', 'graph', 'postgres')
                      AND delete_error IS NULL
                      AND delete_started_at IS NOT NULL
                      AND delete_updated_at IS NOT NULL)
                    OR
                    (delete_state = 'delete_failed'
                      AND delete_step IN ('drain', 'graph', 'postgres')
                      AND delete_error IS NOT NULL
                      AND delete_started_at IS NOT NULL
                      AND delete_updated_at IS NOT NULL)
                  )
                );
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS public.graph_documents (
                  id TEXT PRIMARY KEY,
                  source_id TEXT NOT NULL REFERENCES public.graph_sources(id) ON DELETE CASCADE,
                  original_filename TEXT NOT NULL,
                  file_type TEXT NOT NULL CHECK (file_type IN ('markdown', 'txt', 'text')),
                  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed', 'archived', 'quarantined')),
                  content_hash TEXT,
                  content_text TEXT NOT NULL,
                  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                  uploaded_by TEXT NOT NULL,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  archived_at TIMESTAMPTZ
                );
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_graph_documents_source_status
                ON public.graph_documents (source_id, status, created_at DESC);
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_graph_documents_uploaded_by
                ON public.graph_documents (uploaded_by, created_at DESC);
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_graph_documents_metadata_gin
                ON public.graph_documents USING GIN (metadata);
                """
            )
            # 001 FR-112:已建库补 quarantined 隔离态到 status 约束(幂等 drop+add)。
            cursor.execute(
                "ALTER TABLE public.graph_documents DROP CONSTRAINT IF EXISTS graph_documents_status_check;"
            )
            cursor.execute(
                """
                ALTER TABLE public.graph_documents
                ADD CONSTRAINT graph_documents_status_check
                CHECK (status IN ('processing', 'ready', 'failed', 'archived', 'quarantined'));
                """
            )
            # 012 FR-326(发现待回报①):CSV/XLSX 结构化入图 → file_type CHECK 约束扩 'csv'/'xlsx'
            # (幂等 drop+add,参照上面 status 的 001 模式)。既有 'markdown'/'txt'/'text' 保留,零回归。
            cursor.execute(
                "ALTER TABLE public.graph_documents DROP CONSTRAINT IF EXISTS graph_documents_file_type_check;"
            )
            cursor.execute(
                """
                ALTER TABLE public.graph_documents
                ADD CONSTRAINT graph_documents_file_type_check
                CHECK (file_type IN ('markdown', 'txt', 'text', 'csv', 'xlsx'));
                """
            )
            # 013 T6(FR-421 / AM-1321):抽取复核待审队列。LLM 抽取的新实体/关系在复核开启的
            # source 上进 pending_review 态**而非直接入图**——存 review 队列(不入 LightRAG 图),
            # 故 pending 天然不被检索命中(检索读图存储,pending 不在图里)=状态即证据,
            # **无需改 011 检索侧 filter**(最小侵入,零 011 回归)。approved 才真入图,rejected 永不入图。
            # 状态机 pending_review → {approved | rejected};ON DELETE CASCADE 随 source 清理。
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS public.graph_extraction_review (
                  id TEXT PRIMARY KEY,
                  source_id TEXT NOT NULL REFERENCES public.graph_sources(id) ON DELETE CASCADE,
                  kind TEXT NOT NULL CHECK (kind IN ('entity', 'relation')),
                  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                  status TEXT NOT NULL DEFAULT 'pending_review'
                    CHECK (status IN ('pending_review', 'approved', 'rejected')),
                  audit JSONB NOT NULL DEFAULT '[]'::jsonb,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_graph_extraction_review_source_status
                ON public.graph_extraction_review (source_id, status, created_at);
                """
            )
        connection.commit()


def main() -> None:
    try:
        migrate_database()
    finally:
        close_pool()


if __name__ == "__main__":
    main()
