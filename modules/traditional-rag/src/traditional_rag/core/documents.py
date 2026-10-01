import asyncio
import json
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from pathlib import PurePath
from uuid import uuid4

from traditional_rag.core.errors import TraditionalRagError
from traditional_rag.core.extractors import file_types_for_kind
from traditional_rag.core.sources import (
    TraditionalSource,
    assert_can_manage_source,
    assert_can_read_source,
    get_source_by_id,
)
from traditional_rag.core.types import UserContext
from traditional_rag.db import get_connection
from traditional_rag.storage import resolve_storage_path

DocumentStatus = str
JobStatus = str

EXTENSION_TO_FILE_TYPE = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".csv": "csv",
    ".xlsx": "xlsx",
    ".md": "markdown",
    ".markdown": "markdown",
    ".txt": "txt",
    ".html": "html",
    ".htm": "html",
    ".json": "json",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".webp": "image",
    ".gif": "image",
    ".mp3": "audio",
    ".wav": "audio",
    ".m4a": "audio",
    ".mp4": "video",
    ".mov": "video",
    ".webm": "video",
}
SUPPORTED_FILE_TYPES = set(EXTENSION_TO_FILE_TYPE.values())
# FR-430:文本类型集由 extractor 注册表派生(注册表是真源,非平行壳),核心管线消费此集
INDEXABLE_TEXT_FILE_TYPES = file_types_for_kind("text")
MEDIA_FILE_TYPES = {"image", "audio", "video"}


@dataclass(frozen=True)
class TraditionalDocument:
    id: str
    source_id: str
    original_filename: str
    file_type: str
    status: DocumentStatus
    content_hash: str | None
    storage_path: str | None
    metadata: dict
    uploaded_by: str
    created_at: object
    updated_at: object
    archived_at: object | None


@dataclass(frozen=True)
class TraditionalJob:
    id: str
    document_id: str | None
    source_id: str | None
    status: JobStatus
    stage: str
    error: dict | None
    created_by: str
    created_at: object
    updated_at: object


@dataclass(frozen=True)
class UploadResult:
    document: TraditionalDocument
    job: TraditionalJob
    deduplicated: bool = False


def map_document(row: dict) -> TraditionalDocument:
    return TraditionalDocument(
        id=row["id"],
        source_id=row["source_id"],
        original_filename=row["original_filename"],
        file_type=row["file_type"],
        status=row["status"],
        content_hash=row["content_hash"],
        storage_path=row["storage_path"],
        metadata=row["metadata"],
        uploaded_by=row["uploaded_by"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        archived_at=row["archived_at"],
    )


def map_job(row: dict) -> TraditionalJob:
    return TraditionalJob(
        id=row["id"],
        document_id=row["document_id"],
        source_id=row["source_id"],
        status=row["status"],
        stage=row["stage"],
        error=row["error"],
        created_by=row["created_by"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def safe_original_filename(filename: str) -> str:
    base = PurePath(filename).name.strip()
    if not base:
        return "upload.bin"
    safe = "".join(char if char.isalnum() or char in {".", "_", "-", " ", "(" , ")"} else "_" for char in base)
    return safe[:180] or "upload.bin"


def detect_file_type(filename: str, content: bytes) -> str:
    suffix = PurePath(filename).suffix.lower()
    file_type = EXTENSION_TO_FILE_TYPE.get(suffix)
    if not file_type:
        raise TraditionalRagError(
            "不支持的文件类型：仅支持 PDF、DOCX、CSV、XLSX、Markdown、TXT、HTML、JSON",
            "unsupported_file_type",
        )
    if file_type == "pdf" and not content.startswith(b"%PDF"):
        raise TraditionalRagError("PDF 文件头无效", "unsupported_file_type")
    if file_type in {"docx", "xlsx"} and not content.startswith(b"PK"):
        raise TraditionalRagError(f"{file_type.upper()} 文件头无效", "unsupported_file_type")
    if suffix == ".png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise TraditionalRagError("PNG 文件头无效", "unsupported_file_type")
    if suffix in {".jpg", ".jpeg"} and not content.startswith(b"\xff\xd8\xff"):
        raise TraditionalRagError("JPEG 文件头无效", "unsupported_file_type")
    if suffix == ".gif" and not (content.startswith(b"GIF87a") or content.startswith(b"GIF89a")):
        raise TraditionalRagError("GIF 文件头无效", "unsupported_file_type")
    if suffix == ".webp" and not (content.startswith(b"RIFF") and content[8:12] == b"WEBP"):
        raise TraditionalRagError("WEBP 文件头无效", "unsupported_file_type")
    if suffix == ".mp3" and not (content.startswith(b"ID3") or content[:2] in {b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"}):
        raise TraditionalRagError("MP3 文件头无效", "unsupported_file_type")
    if suffix == ".wav" and not (content.startswith(b"RIFF") and content[8:12] == b"WAVE"):
        raise TraditionalRagError("WAV 文件头无效", "unsupported_file_type")
    if suffix in {".mp4", ".m4a", ".mov"} and b"ftyp" not in content[:32]:
        raise TraditionalRagError(f"{suffix.upper().lstrip('.')} 文件头无效", "unsupported_file_type")
    return file_type


def relative_storage_path(source_id: str, document_id: str, filename: str) -> str:
    return f"files/{source_id}/{document_id}/{filename}"


def _find_active_document_by_hash(source_id: str, content_hash: str) -> TraditionalDocument | None:
    """同 source 内按 content_hash 查未归档 document(FR-150 幂等判定,per (source, hash))。"""
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, source_id, original_filename, file_type, status, content_hash,
                       storage_path, metadata, uploaded_by, created_at, updated_at, archived_at
                FROM traditional_documents
                WHERE source_id = %s AND content_hash = %s AND archived_at IS NULL
                ORDER BY created_at ASC
                LIMIT 1
                """,
                (source_id, content_hash),
            )
            row = cursor.fetchone()
            return map_document(row) if row else None


def _latest_job_for_document(document_id: str) -> TraditionalJob:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, document_id, source_id, status, stage, error, created_by, created_at, updated_at
                FROM traditional_jobs
                WHERE document_id = %s
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (document_id,),
            )
            row = cursor.fetchone()
            if row is None:
                raise TraditionalRagError("document 无关联 job", "invalid_state")
            return map_job(row)


def _write_upload_file(destination, content: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)


async def create_uploaded_document(
    user: UserContext,
    source_id: str,
    filename: str,
    content: bytes,
    content_type: str | None = None,
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
) -> UploadResult:
    source = await get_source_by_id(source_id)
    if not source:
        raise TraditionalRagError("source 不存在", "not_found")
    assert_can_manage_source(user, source)
    if not content:
        raise TraditionalRagError("上传文件不能为空")

    original_filename = safe_original_filename(filename)
    file_type = detect_file_type(original_filename, content)
    digest = sha256(content).hexdigest()

    # FR-150 文件级幂等:同 source 同 content_hash 命中既有(未归档)document → 幂等跳过,
    # 返回既有 document + 其最近 job,不建新 document/job/chunk(根治重复上传堆模块层垃圾)。
    existing = _find_active_document_by_hash(source_id, digest)
    if existing is not None:
        existing_job = _latest_job_for_document(existing.id)
        return UploadResult(document=existing, job=existing_job, deduplicated=True)

    document_id = str(uuid4())
    job_id = str(uuid4())
    storage_path = relative_storage_path(source_id, document_id, original_filename)
    destination = resolve_storage_path(*storage_path.split("/"))
    await asyncio.to_thread(_write_upload_file, destination, content)
    metadata = {
        "content_type": content_type,
        "size_bytes": len(content),
        "detected_by": "extension_and_magic",
    }
    if chunk_size is not None or chunk_overlap is not None:
        metadata["chunk_config"] = {
            "max_chars": chunk_size,
            "overlap_chars": chunk_overlap,
        }

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO traditional_documents (
                  id, source_id, original_filename, file_type, status,
                  content_hash, storage_path, metadata, uploaded_by
                )
                VALUES (%s, %s, %s, %s, 'uploaded', %s, %s, %s::jsonb, %s)
                RETURNING id, source_id, original_filename, file_type, status, content_hash,
                          storage_path, metadata, uploaded_by, created_at, updated_at, archived_at
                """,
                (document_id, source_id, original_filename, file_type, digest, storage_path, json.dumps(metadata), user.user_id),
            )
            document = map_document(cursor.fetchone())
            cursor.execute(
                """
                INSERT INTO traditional_jobs (id, document_id, source_id, status, stage, created_by)
                VALUES (%s, %s, %s, 'uploaded', 'uploaded', %s)
                RETURNING id, document_id, source_id, status, stage, error, created_by, created_at, updated_at
                """,
                (job_id, document_id, source_id, user.user_id),
            )
            job = map_job(cursor.fetchone())
        connection.commit()
    return UploadResult(document=document, job=job)


def _get_document_for_job(job_id: str) -> tuple[TraditionalJob, TraditionalDocument] | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                  j.id AS job_id, j.document_id, j.source_id AS job_source_id, j.status AS job_status,
                  j.stage, j.error, j.created_by, j.created_at AS job_created_at, j.updated_at AS job_updated_at,
                  d.id AS doc_id, d.source_id AS doc_source_id, d.original_filename, d.file_type,
                  d.status AS doc_status, d.content_hash, d.storage_path, d.metadata, d.uploaded_by,
                  d.created_at AS doc_created_at, d.updated_at AS doc_updated_at, d.archived_at
                FROM traditional_jobs j
                JOIN traditional_documents d ON d.id = j.document_id
                WHERE j.id = %s
                """,
                (job_id,),
            )
            row = cursor.fetchone()
    if not row:
        return None
    job = TraditionalJob(
        id=row["job_id"],
        document_id=row["document_id"],
        source_id=row["job_source_id"],
        status=row["job_status"],
        stage=row["stage"],
        error=row["error"],
        created_by=row["created_by"],
        created_at=row["job_created_at"],
        updated_at=row["job_updated_at"],
    )
    document = TraditionalDocument(
        id=row["doc_id"],
        source_id=row["doc_source_id"],
        original_filename=row["original_filename"],
        file_type=row["file_type"],
        status=row["doc_status"],
        content_hash=row["content_hash"],
        storage_path=row["storage_path"],
        metadata=row["metadata"],
        uploaded_by=row["uploaded_by"],
        created_at=row["doc_created_at"],
        updated_at=row["doc_updated_at"],
        archived_at=row["archived_at"],
    )
    return job, document


def _find_mineru_cache(content_hash: str, document_id: str) -> tuple[str, dict] | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, metadata->'mineru' AS mineru
                FROM traditional_documents
                WHERE id <> %s
                  AND file_type = 'pdf'
                  AND content_hash = %s
                  AND metadata ? 'mineru'
                  AND metadata->'mineru'->>'state' = 'done'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (document_id, content_hash),
            )
            row = cursor.fetchone()
    if not row:
        return None
    return row["id"], row["mineru"]


def _mark_non_pdf_ready(job_id: str) -> TraditionalJob | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE traditional_jobs
                SET status = 'ready', stage = 'type_identified', updated_at = now()
                WHERE id = %s AND status IN ('uploaded', 'parsing')
                RETURNING id, document_id, source_id, status, stage, error, created_by, created_at, updated_at
                """,
                (job_id,),
            )
            job_row = cursor.fetchone()
            if not job_row:
                connection.commit()
                return None
            cursor.execute(
                """
                UPDATE traditional_documents
                SET status = 'ready', updated_at = now()
                WHERE id = %s AND status IN ('uploaded', 'processing')
                """,
                (job_row["document_id"],),
            )
        connection.commit()
        return map_job(job_row)


def _mark_processing(job_id: str, status: str, stage: str) -> TraditionalJob | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE traditional_jobs
                SET status = %s, stage = %s, error = NULL, updated_at = now()
                WHERE id = %s
                RETURNING id, document_id, source_id, status, stage, error, created_by, created_at, updated_at
                """,
                (status, stage, job_id),
            )
            job_row = cursor.fetchone()
            if job_row:
                cursor.execute(
                    """
                    UPDATE traditional_documents
                    SET status = 'processing', updated_at = now()
                    WHERE id = %s AND status <> 'archived'
                    """,
                    (job_row["document_id"],),
                )
        connection.commit()
        return map_job(job_row) if job_row else None


def _mark_text_ready(job_id: str, document: TraditionalDocument, processing_metadata: dict, stage: str) -> TraditionalJob | None:
    next_metadata = dict(document.metadata or {})
    next_metadata["processing"] = processing_metadata
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE traditional_documents
                SET status = 'ready', metadata = %s::jsonb, updated_at = now()
                WHERE id = %s AND status <> 'archived'
                """,
                (json.dumps(next_metadata, ensure_ascii=False), document.id),
            )
            cursor.execute(
                """
                UPDATE traditional_jobs
                SET status = 'ready', stage = %s, error = NULL, updated_at = now()
                WHERE id = %s
                RETURNING id, document_id, source_id, status, stage, error, created_by, created_at, updated_at
                """,
                (stage, job_id),
            )
            job_row = cursor.fetchone()
        connection.commit()
        return map_job(job_row) if job_row else None


def _mark_pdf_ready(job_id: str, document: TraditionalDocument, mineru_metadata: dict, stage: str) -> TraditionalJob | None:
    next_metadata = dict(document.metadata or {})
    next_metadata["mineru"] = mineru_metadata
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE traditional_documents
                SET status = 'ready', metadata = %s::jsonb, updated_at = now()
                WHERE id = %s AND status <> 'archived'
                """,
                (json.dumps(next_metadata), document.id),
            )
            cursor.execute(
                """
                UPDATE traditional_jobs
                SET status = 'ready', stage = %s, error = NULL, updated_at = now()
                WHERE id = %s
                RETURNING id, document_id, source_id, status, stage, error, created_by, created_at, updated_at
                """,
                (stage, job_id),
            )
            job_row = cursor.fetchone()
        connection.commit()
        return map_job(job_row) if job_row else None


def _chunk_overrides(document: TraditionalDocument) -> dict:
    """从 document.metadata 提取 per-document 切片参数，仅返回非 None 项（供 build_* 以 ** 透传，缺省落默认 1200/160）。"""
    chunk_config = document.metadata.get("chunk_config") or {}
    overrides: dict = {}
    if chunk_config.get("max_chars") is not None:
        overrides["max_chars"] = chunk_config["max_chars"]
    if chunk_config.get("overlap_chars") is not None:
        overrides["overlap_chars"] = chunk_config["overlap_chars"]
    return overrides


def _index_pdf_markdown(job_id: str, document: TraditionalDocument, mineru_metadata: dict) -> tuple[dict, str]:
    markdown_path = mineru_metadata.get("markdown_path")
    if not isinstance(markdown_path, str) or not markdown_path:
        # 001 FR-109:PDF 解析未产出 markdown(如扫描件无文本层)→ 0 可检索内容,诚实标失败,
        # 不再返回让 _mark_pdf_ready 把 0-chunk PDF 标 ready(与文本路径 empty_chunks 守卫对齐)。
        raise TraditionalRagError("PDF 解析未产出可切片文本（疑似扫描件无文本层），无可检索内容", "empty_chunks")
    from traditional_rag.core.chunks import build_chunks_and_embeddings_from_mineru_markdown

    _mark_processing(job_id, "chunking", "mineru_markdown_chunking")
    _mark_processing(job_id, "embedding", "mineru_markdown_embedding")
    result = build_chunks_and_embeddings_from_mineru_markdown(
        document_id=document.id,
        source_id=document.source_id,
        markdown_path=markdown_path,
        uploaded_by=document.uploaded_by,
        **_chunk_overrides(document),
    )
    # 001 FR-109:PDF 切片产出 0 chunk → 诚实标失败(与文本路径 :611 empty_chunks 守卫对齐),不假 ready。
    if result.chunk_count == 0:
        raise TraditionalRagError("PDF 切片产出 0 chunk，文档无可检索内容", "empty_chunks")
    next_metadata = dict(mineru_metadata)
    next_metadata["indexed"] = {
        "parser": result.parser_metadata,
        "chunk_count": result.chunk_count,
        "embedding_model": result.embedding_model,
        "embedding_dimensions": result.embedding_dimensions,
    }
    return next_metadata, "mineru_embedded"


def _mark_table_ready(job_id: str, document: TraditionalDocument, table_metadata: dict, stage: str) -> TraditionalJob | None:
    next_metadata = dict(document.metadata or {})
    next_metadata["tables"] = table_metadata
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE traditional_documents
                SET status = 'ready', metadata = %s::jsonb, updated_at = now()
                WHERE id = %s AND status <> 'archived'
                """,
                (json.dumps(next_metadata, ensure_ascii=False), document.id),
            )
            cursor.execute(
                """
                UPDATE traditional_jobs
                SET status = 'ready', stage = %s, error = NULL, updated_at = now()
                WHERE id = %s
                RETURNING id, document_id, source_id, status, stage, error, created_by, created_at, updated_at
                """,
                (stage, job_id),
            )
            job_row = cursor.fetchone()
        connection.commit()
        return map_job(job_row) if job_row else None


def _mark_job_failed(job_id: str, document_id: str | None, error: Exception) -> TraditionalJob | None:
    payload = {
        "error": getattr(error, "code", "processing_error"),
        "message": getattr(error, "message", str(error)),
    }
    with get_connection() as connection:
        with connection.cursor() as cursor:
            if document_id:
                cursor.execute(
                    """
                    UPDATE traditional_documents
                    SET status = 'failed', updated_at = now()
                    WHERE id = %s AND status <> 'archived'
                    """,
                    (document_id,),
                )
            cursor.execute(
                """
                UPDATE traditional_jobs
                SET status = 'failed', stage = 'failed', error = %s::jsonb, updated_at = now()
                WHERE id = %s
                RETURNING id, document_id, source_id, status, stage, error, created_by, created_at, updated_at
                """,
                (json.dumps(payload, ensure_ascii=False), job_id),
            )
            job_row = cursor.fetchone()
        connection.commit()
        return map_job(job_row) if job_row else None


def _claim_job(job_id: str) -> bool:
    """C2 原子领取：仅当 job 为 'uploaded' 时置 'parsing' 并返回 True，否则 False(真去重)。

    只认 'uploaded'→'parsing' 的单向跃迁：同一 job 被并发派发两次，只有第一次能把它从 uploaded 翻走，
    第二次看到非 uploaded 即领取失败。recovery 路径先把残留 job 重置为 uploaded 再走此领取(见
    reset_stale_jobs_for_recovery)。注意 traditional_jobs status_check 无 'processing'，用 'parsing'(最早合法工作态)。
    """
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE traditional_jobs SET status = 'parsing', updated_at = now() WHERE id = %s AND status = 'uploaded' RETURNING id",
                (job_id,),
            )
            claimed = cursor.fetchone() is not None
        connection.commit()
    return claimed


def reset_stale_jobs_for_recovery(updated_before: datetime) -> list[str]:
    """C2 启动恢复：把重启前残留的非终态 job 原子重置为 'uploaded' 并返回其 id。

    updated_before=启动时刻：只捡重启前残留(updated_at < 启动时刻)，绝不误抢启动后新上传的 job。
    一条 UPDATE...RETURNING 同时完成"重置为可领取态 + 取 id 清单"，避免 list/reset 两步竞态。
    返回的 id 交给 complete_upload_job(其 _claim_job 会 uploaded→parsing 接管)；全删全建保证重跑幂等。
    """
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE traditional_jobs j
                SET status = 'uploaded', updated_at = now()
                FROM traditional_documents d
                WHERE d.id = j.document_id
                  AND j.status NOT IN ('ready', 'failed')
                  AND d.archived_at IS NULL
                  AND j.updated_at < %s
                RETURNING j.id
                """,
                (updated_before,),
            )
            # cursor 为 dict_row，按列名取值（不能用 row[0]）。
            return [row["id"] for row in cursor.fetchall()]


def complete_upload_job(job_id: str) -> TraditionalJob | None:
    # C2：原子领取，领不到(已终态/已被其它处理者领取)直接返回，防重复派发。
    if not _claim_job(job_id):
        return None
    current = _get_document_for_job(job_id)
    if not current:
        return None
    _, document = current
    if not document.content_hash or not document.storage_path:
        return _mark_job_failed(job_id, document.id, TraditionalRagError("文档缺少存储路径或内容哈希", "invalid_input"))

    if document.file_type in INDEXABLE_TEXT_FILE_TYPES:
        try:
            from traditional_rag.core.chunks import build_chunks_and_embeddings

            _mark_processing(job_id, "chunking", "chunking")
            _mark_processing(job_id, "embedding", "embedding")
            result = build_chunks_and_embeddings(
                document_id=document.id,
                source_id=document.source_id,
                file_type=document.file_type,
                storage_path=document.storage_path,
                uploaded_by=document.uploaded_by,
                **_chunk_overrides(document),
            )
            if result.chunk_count == 0:
                return _mark_job_failed(
                    job_id,
                    document.id,
                    TraditionalRagError("切片产出 0 chunk，文档无可检索内容", "empty_chunks"),
                )
            return _mark_text_ready(
                job_id,
                document,
                {
                    "parser": result.parser_metadata,
                    "chunk_count": result.chunk_count,
                    "embedding_model": result.embedding_model,
                    "embedding_dimensions": result.embedding_dimensions,
                },
                "embedded",
            )
        except Exception as error:
            return _mark_job_failed(job_id, document.id, error)

    if document.file_type in {"csv", "xlsx"}:
        try:
            from traditional_rag.core.tables import build_tables

            _mark_processing(job_id, "parsing", "table_extracting")
            result = build_tables(
                document_id=document.id,
                source_id=document.source_id,
                file_type=document.file_type,
                storage_path=document.storage_path,
            )
            return _mark_table_ready(
                job_id,
                document,
                {
                    "parser": result.parser_metadata,
                    "table_count": result.table_count,
                    "row_count": result.row_count,
                },
                "table_indexed",
            )
        except Exception as error:
            return _mark_job_failed(job_id, document.id, error)

    if document.file_type in MEDIA_FILE_TYPES:
        next_metadata = dict(document.metadata or {})
        next_metadata["media"] = {
            "state": "awaiting_extractor",
            "file_type": document.file_type,
            "message": "当前已接收原始媒体资产；需要配置真实 OCR、ASR 或视频解析服务后才能生成可检索文本。",
        }
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE traditional_documents
                    SET metadata = %s::jsonb, updated_at = now()
                    WHERE id = %s AND status <> 'archived'
                    """,
                    (json.dumps(next_metadata, ensure_ascii=False), document.id),
                )
                cursor.execute(
                    """
                    UPDATE traditional_jobs
                    SET status = 'failed',
                        stage = 'awaiting_media_extractor',
                        error = %s::jsonb,
                        updated_at = now()
                    WHERE id = %s
                    RETURNING id, document_id, source_id, status, stage, error, created_by, created_at, updated_at
                    """,
                    (
                        json.dumps(
                            {
                                "error": "extractor_unavailable",
                                "message": "媒体文件已存储，但当前模块未配置真实 OCR/ASR/视频解析器。",
                            },
                            ensure_ascii=False,
                        ),
                        job_id,
                    ),
                )
                job_row = cursor.fetchone()
            connection.commit()
            return map_job(job_row) if job_row else None

    if document.file_type != "pdf":
        # 001 FR-110:到此 = 未被 text/csv/xlsx/media/pdf 任一已知分支命中的类型。
        # 不再静默 _mark_non_pdf_ready(假装就绪),而是诚实标失败——未知类型无可检索产出。
        # (诚实拒收文案归 003;此处只堵状态诚实:不把无内容的类型标 ready。)
        return _mark_job_failed(
            job_id,
            document.id,
            TraditionalRagError(f"不支持的文件类型「{document.file_type}」，无法入库", "unsupported_file_type"),
        )

    cache = _find_mineru_cache(document.content_hash, document.id)
    if cache:
        cached_document_id, cached_mineru = cache
        mineru_metadata = dict(cached_mineru)
        mineru_metadata["cache_hit"] = True
        mineru_metadata["cached_from_document_id"] = cached_document_id
        try:
            indexed_metadata, stage = _index_pdf_markdown(job_id, document, mineru_metadata)
            return _mark_pdf_ready(job_id, document, indexed_metadata, stage)
        except Exception as error:
            return _mark_job_failed(job_id, document.id, error)

    _mark_processing(job_id, "parsing", "mineru_uploading")
    try:
        from traditional_rag.core.mineru import parse_pdf_with_precise_api

        file_path = resolve_storage_path(*document.storage_path.split("/"))
        result = parse_pdf_with_precise_api(
            document_id=document.id,
            filename=document.original_filename,
            content_hash=document.content_hash,
            file_path=file_path,
        )
        indexed_metadata, stage = _index_pdf_markdown(job_id, document, result.metadata)
        return _mark_pdf_ready(job_id, document, indexed_metadata, stage)
    except Exception as error:
        return _mark_job_failed(job_id, document.id, error)


async def get_document_by_id(document_id: str) -> TraditionalDocument | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, source_id, original_filename, file_type, status, content_hash,
                       storage_path, metadata, uploaded_by, created_at, updated_at, archived_at
                FROM traditional_documents
                WHERE id = %s
                """,
                (document_id,),
            )
            row = cursor.fetchone()
            return map_document(row) if row else None


async def get_readable_document(user: UserContext, document_id: str) -> TraditionalDocument:
    document = await get_document_by_id(document_id)
    if not document or document.archived_at is not None:
        raise TraditionalRagError("document 不存在", "not_found")
    source = await get_source_by_id(document.source_id)
    if not source:
        raise TraditionalRagError("source 不存在", "not_found")
    assert_can_read_source(user, source)
    return document


def readable_source_filter(user: UserContext) -> tuple[str, tuple]:
    return "(%s = true OR s.kind = 'public' OR s.owner_user_id = %s)", (user.is_admin, user.user_id)


async def list_readable_documents(user: UserContext, source_id: str | None = None) -> list[TraditionalDocument]:
    params: list[object] = []
    readable_sql, readable_params = readable_source_filter(user)
    params.extend(readable_params)
    source_sql = ""
    if source_id:
        source = await get_source_by_id(source_id)
        if not source:
            raise TraditionalRagError("source 不存在", "not_found")
        assert_can_read_source(user, source)
        source_sql = "AND d.source_id = %s"
        params.append(source_id)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT d.id, d.source_id, d.original_filename, d.file_type, d.status, d.content_hash,
                       d.storage_path, d.metadata, d.uploaded_by, d.created_at, d.updated_at, d.archived_at
                FROM traditional_documents d
                JOIN traditional_sources s ON s.id = d.source_id
                WHERE d.archived_at IS NULL AND s.archived_at IS NULL
                  AND {readable_sql}
                  {source_sql}
                ORDER BY d.created_at DESC
                """,
                tuple(params),
            )
            return [map_document(row) for row in cursor.fetchall()]


async def delete_document_chunk(user: UserContext, document_id: str, chunk_id: str) -> bool:
    """管理员/owner 删除某文档下一个噪声 chunk。真删 traditional_chunks 行。"""
    document = await get_document_by_id(document_id)
    if not document:
        raise TraditionalRagError("document 不存在", "not_found")
    source = await get_source_by_id(document.source_id)
    if not source:
        raise TraditionalRagError("source 不存在", "not_found")
    assert_can_manage_source(user, source)
    from traditional_rag.core.chunks import delete_chunk_row

    return delete_chunk_row(document_id, chunk_id)


async def archive_document(user: UserContext, document_id: str) -> TraditionalDocument:
    document = await get_document_by_id(document_id)
    if not document or document.archived_at is not None:
        raise TraditionalRagError("document 不存在", "not_found")
    source = await get_source_by_id(document.source_id)
    if not source:
        raise TraditionalRagError("source 不存在", "not_found")
    assert_can_manage_source(user, source)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE traditional_documents
                SET status = 'archived', archived_at = now(), updated_at = now()
                WHERE id = %s
                RETURNING id, source_id, original_filename, file_type, status, content_hash,
                          storage_path, metadata, uploaded_by, created_at, updated_at, archived_at
                """,
                (document_id,),
            )
            archived = map_document(cursor.fetchone())
        connection.commit()
        return archived


async def delete_document(user: UserContext, document_id: str) -> bool:
    """FR-153 文档级硬删除:删 document → cascade 删其 chunks / jobs / tables / table_rows / structured_rows。

    供平台编排层 re-ingest 差集(被移除/被替换文件)同步删除模块层数据,杜绝 chunk 累积。

    注(移植决策 2026-07-06):① 仅硬删 DB 行——依赖各子表 FK ON DELETE CASCADE(已核实
    chunks/jobs/tables/table_rows/structured_rows + 二级 table_id 均有);storage_path 磁盘文件
    暂不清理(已知限制,待后续增强)。② core 能力,当前 HTTP DELETE /documents/{id} 仍走
    archive_document 软删,本函数未接线;改删除语义为硬删需单独拍板。
    """
    document = await get_document_by_id(document_id)
    if not document:
        raise TraditionalRagError("document 不存在", "not_found")
    source = await get_source_by_id(document.source_id)
    if not source:
        raise TraditionalRagError("source 不存在", "not_found")
    assert_can_manage_source(user, source)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM traditional_documents WHERE id = %s", (document_id,))
            deleted = cursor.rowcount
        connection.commit()
    return deleted > 0


async def get_readable_job(user: UserContext, job_id: str) -> TraditionalJob:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT j.id, j.document_id, j.source_id, j.status, j.stage, j.error,
                       j.created_by, j.created_at, j.updated_at,
                       s.kind, s.owner_user_id, s.archived_at AS source_archived_at
                FROM traditional_jobs j
                LEFT JOIN traditional_sources s ON s.id = j.source_id
                WHERE j.id = %s
                """,
                (job_id,),
            )
            row = cursor.fetchone()
    if not row:
        raise TraditionalRagError("job 不存在", "not_found")
    if row["source_id"]:
        source = TraditionalSource(
            id=row["source_id"],
            name="",
            description="",
            kind=row["kind"],
            owner_user_id=row["owner_user_id"],
            created_by=row["created_by"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            archived_at=row["source_archived_at"],
        )
        assert_can_read_source(user, source)
    return map_job(row)


async def list_readable_jobs(
    user: UserContext,
    *,
    source_id: str | None = None,
    document_id: str | None = None,
) -> list[TraditionalJob]:
    params: list[object] = []
    readable_sql, readable_params = readable_source_filter(user)
    params.extend(readable_params)
    filters = ["s.archived_at IS NULL", readable_sql]
    if source_id:
        source = await get_source_by_id(source_id)
        if not source:
            raise TraditionalRagError("source 不存在", "not_found")
        assert_can_read_source(user, source)
        filters.append("j.source_id = %s")
        params.append(source_id)
    if document_id:
        document = await get_readable_document(user, document_id)
        filters.append("j.document_id = %s")
        params.append(document.id)
    where_sql = " AND ".join(filters)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT j.id, j.document_id, j.source_id, j.status, j.stage, j.error,
                       j.created_by, j.created_at, j.updated_at
                FROM traditional_jobs j
                JOIN traditional_sources s ON s.id = j.source_id
                WHERE {where_sql}
                ORDER BY j.created_at DESC
                """,
                tuple(params),
            )
            return [map_job(row) for row in cursor.fetchall()]
