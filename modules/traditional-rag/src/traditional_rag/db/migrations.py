from traditional_rag.db import get_connection
from traditional_rag.storage import ensure_storage_layout


def migrate_database() -> None:
    ensure_storage_layout()
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            cursor.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS traditional_sources (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  description TEXT NOT NULL DEFAULT '',
                  kind TEXT NOT NULL CHECK (kind IN ('private', 'public')),
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
                CREATE UNIQUE INDEX IF NOT EXISTS idx_traditional_sources_private_owner_name
                ON traditional_sources (owner_user_id, name)
                WHERE kind = 'private' AND archived_at IS NULL;
                """
            )
            cursor.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS idx_traditional_sources_public_name
                ON traditional_sources (name)
                WHERE kind = 'public' AND archived_at IS NULL;
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_sources_readable
                ON traditional_sources (kind, owner_user_id, archived_at);
                """
            )

            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS traditional_documents (
                  id TEXT PRIMARY KEY,
                  source_id TEXT NOT NULL REFERENCES traditional_sources(id) ON DELETE CASCADE,
                  original_filename TEXT NOT NULL,
                  file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'docx', 'csv', 'xlsx', 'markdown', 'txt')),
                  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processing', 'ready', 'failed', 'archived')),
                  content_hash TEXT,
                  storage_path TEXT,
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
                ALTER TABLE traditional_documents
                DROP CONSTRAINT IF EXISTS traditional_documents_file_type_check;
                """
            )
            cursor.execute(
                """
                ALTER TABLE traditional_documents
                ADD CONSTRAINT traditional_documents_file_type_check
                CHECK (file_type IN ('pdf', 'docx', 'csv', 'xlsx', 'markdown', 'txt', 'html', 'json', 'image', 'audio', 'video'));
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_documents_source_status
                ON traditional_documents (source_id, status, created_at DESC);
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_documents_uploaded_by
                ON traditional_documents (uploaded_by, created_at DESC);
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_documents_metadata_gin
                ON traditional_documents USING GIN (metadata);
                """
            )

            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS traditional_jobs (
                  id TEXT PRIMARY KEY,
                  document_id TEXT REFERENCES traditional_documents(id) ON DELETE CASCADE,
                  source_id TEXT REFERENCES traditional_sources(id) ON DELETE CASCADE,
                  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'parsing', 'chunking', 'embedding', 'ready', 'failed')),
                  stage TEXT NOT NULL DEFAULT 'uploaded',
                  error JSONB,
                  created_by TEXT NOT NULL,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_jobs_document
                ON traditional_jobs (document_id, created_at DESC);
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_jobs_source
                ON traditional_jobs (source_id, created_at DESC);
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_jobs_status
                ON traditional_jobs (status, created_at DESC);
                """
            )

            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS traditional_chunks (
                  id TEXT PRIMARY KEY,
                  document_id TEXT NOT NULL REFERENCES traditional_documents(id) ON DELETE CASCADE,
                  source_id TEXT NOT NULL REFERENCES traditional_sources(id) ON DELETE CASCADE,
                  chunk_index INTEGER NOT NULL,
                  chunk_text TEXT NOT NULL,
                  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                  embedding vector NOT NULL,
                  embedding_model TEXT NOT NULL,
                  embedding_dimensions INTEGER NOT NULL,
                  text_search TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', chunk_text)) STORED,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  UNIQUE (document_id, chunk_index)
                );
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_chunks_document
                ON traditional_chunks (document_id, chunk_index);
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_chunks_source
                ON traditional_chunks (source_id, created_at DESC);
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_chunks_text_search
                ON traditional_chunks USING GIN (text_search);
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_chunks_text_trgm
                ON traditional_chunks USING GIN (chunk_text gin_trgm_ops);
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS traditional_tables (
                  id TEXT PRIMARY KEY,
                  document_id TEXT NOT NULL REFERENCES traditional_documents(id) ON DELETE CASCADE,
                  source_id TEXT NOT NULL REFERENCES traditional_sources(id) ON DELETE CASCADE,
                  table_index INTEGER NOT NULL,
                  sheet_name TEXT NOT NULL,
                  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
                  row_count INTEGER NOT NULL DEFAULT 0,
                  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  UNIQUE (document_id, table_index)
                );
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_tables_document
                ON traditional_tables (document_id, table_index);
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_tables_source
                ON traditional_tables (source_id, created_at DESC);
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_tables_metadata_gin
                ON traditional_tables USING GIN (metadata);
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS traditional_table_rows (
                  id TEXT PRIMARY KEY,
                  table_id TEXT NOT NULL REFERENCES traditional_tables(id) ON DELETE CASCADE,
                  document_id TEXT NOT NULL REFERENCES traditional_documents(id) ON DELETE CASCADE,
                  source_id TEXT NOT NULL REFERENCES traditional_sources(id) ON DELETE CASCADE,
                  row_index INTEGER NOT NULL,
                  values JSONB NOT NULL DEFAULT '{}'::jsonb,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  UNIQUE (table_id, row_index)
                );
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_table_rows_table
                ON traditional_table_rows (table_id, row_index);
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_table_rows_values_gin
                ON traditional_table_rows USING GIN (values);
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS traditional_structured_rows (
                  id TEXT PRIMARY KEY,
                  table_id TEXT NOT NULL REFERENCES traditional_tables(id) ON DELETE CASCADE,
                  document_id TEXT NOT NULL REFERENCES traditional_documents(id) ON DELETE CASCADE,
                  source_id TEXT NOT NULL REFERENCES traditional_sources(id) ON DELETE CASCADE,
                  row_index INTEGER NOT NULL,
                  semantic_text TEXT NOT NULL,
                  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                  embedding vector NOT NULL,
                  embedding_model TEXT NOT NULL,
                  embedding_dimensions INTEGER NOT NULL,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  UNIQUE (table_id, row_index)
                );
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_structured_rows_table
                ON traditional_structured_rows (table_id, row_index);
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_structured_rows_source
                ON traditional_structured_rows (source_id, created_at DESC);
                """
            )
            cursor.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traditional_structured_rows_metadata_gin
                ON traditional_structured_rows USING GIN (metadata);
                """
            )
            # P0-1：embedding 降维 1024（MRL 截断+归一化）+ 建 HNSW 向量索引，幂等。
            # 4096 维超 pgvector HNSW 上限(vector≤2000)，降到 1024 才能建 ANN，告别全表暴扫。
            cursor.execute(
                "select format_type(atttypid, atttypmod) as t from pg_attribute "
                "where attrelid='traditional_chunks'::regclass and attname='embedding'"
            )
            row = cursor.fetchone()
            if row and row["t"] != "vector(1024)":
                cursor.execute(
                    "ALTER TABLE traditional_chunks ALTER COLUMN embedding TYPE vector(1024) "
                    "USING l2_normalize(subvector(embedding,1,1024))::vector(1024)"
                )
                cursor.execute(
                    "UPDATE traditional_chunks SET embedding_dimensions=1024 WHERE embedding_dimensions<>1024"
                )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_traditional_chunks_embedding_hnsw "
                "ON traditional_chunks USING hnsw (embedding vector_cosine_ops)"
            )
        connection.commit()


def main() -> None:
    migrate_database()
    print("traditional rag database migrated")


if __name__ == "__main__":
    main()
