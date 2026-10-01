from __future__ import annotations

import json
import re
from dataclasses import dataclass
from uuid import uuid4

from traditional_rag.config import get_settings
from traditional_rag.core.embeddings import embed_texts, vector_literal
from traditional_rag.core.errors import TraditionalRagError
from traditional_rag.core.parsers import ParsedDocument, parse_docx_file, parse_html_file, parse_json_file, parse_text_file
from traditional_rag.core.types import UserContext
from traditional_rag.db import get_connection
from traditional_rag.storage import resolve_storage_path


@dataclass(frozen=True)
class TraditionalChunk:
    id: str
    document_id: str
    source_id: str
    chunk_index: int
    chunk_text: str
    metadata: dict
    embedding_model: str
    embedding_dimensions: int
    created_at: object


@dataclass(frozen=True)
class ChunkBuildResult:
    chunk_count: int
    embedding_model: str
    embedding_dimensions: int
    parser_metadata: dict


def map_chunk(row: dict) -> TraditionalChunk:
    return TraditionalChunk(
        id=row["id"],
        document_id=row["document_id"],
        source_id=row["source_id"],
        chunk_index=row["chunk_index"],
        chunk_text=row["chunk_text"],
        metadata=row["metadata"],
        embedding_model=row["embedding_model"],
        embedding_dimensions=row["embedding_dimensions"],
        created_at=row["created_at"],
    )


def parse_supported_document(file_type: str, path_parts: list[str]) -> ParsedDocument:
    path = resolve_storage_path(*path_parts)
    if file_type == "docx":
        return parse_docx_file(path)
    if file_type == "markdown":
        return parse_text_file(path, parser="markdown")
    if file_type == "txt":
        return parse_text_file(path, parser="txt")
    if file_type == "html":
        return parse_html_file(path)
    if file_type == "json":
        return parse_json_file(path)
    raise TraditionalRagError(f"M44 不处理该文件类型：{file_type}", "unsupported_file_type")


def segment_reference(segment_index: int, metadata: dict) -> dict:
    reference = {"segment_index": segment_index}
    for key in ("kind", "paragraph_index", "table_index", "row_count", "parser"):
        if key in metadata:
            reference[key] = metadata[key]
    return reference


def reference_kinds(references: list[dict]) -> list[str]:
    kinds: list[str] = []
    for reference in references:
        kind = reference.get("kind")
        if isinstance(kind, str) and kind not in kinds:
            kinds.append(kind)
    return kinds


def split_into_chunks(parsed: ParsedDocument, *, max_chars: int = 1200, overlap_chars: int = 160) -> list[tuple[str, dict]]:
    # 防御：overlap 必须严格小于 max_chars，否则长段落切片步进(max_chars - overlap)≤0 会死循环。
    # per-document 可配参数(T1-B1)下 chunk_size=overlap=300 等组合会触发，此处 clamp 保证步进≥1。
    max_chars = max(1, max_chars)
    overlap_chars = max(0, min(overlap_chars, max_chars - 1))
    chunks: list[tuple[str, dict]] = []
    current_parts: list[str] = []
    current_references: list[dict] = []
    current_start: int | None = None
    current_end: int | None = None
    current_chars = 0

    def flush() -> None:
        nonlocal current_parts, current_references, current_start, current_end, current_chars
        if not current_parts:
            return
        text = "\n\n".join(current_parts).strip()
        if text:
            chunks.append(
                (
                    text,
                    {
                        "segment_start": current_start,
                        "segment_end": current_end,
                        "segments": current_references,
                        "reference_kinds": reference_kinds(current_references),
                        "char_count": len(text),
                    },
                )
            )
        current_parts = []
        current_references = []
        current_start = None
        current_end = None
        current_chars = 0

    for segment_index, segment in enumerate(parsed.segments):
        text = segment.text.strip()
        if not text:
            continue
        if len(text) > max_chars:
            flush()
            start = 0
            while start < len(text):
                end = min(len(text), start + max_chars)
                piece = text[start:end].strip()
                if piece:
                    references = [segment_reference(segment_index, segment.metadata)]
                    metadata = dict(segment.metadata)
                    metadata.update(
                        {
                            "segment_start": segment_index,
                            "segment_end": segment_index,
                            "segments": references,
                            "reference_kinds": reference_kinds(references),
                            "char_start": start,
                            "char_end": end,
                            "char_count": len(piece),
                        }
                    )
                    chunks.append((piece, metadata))
                if end >= len(text):
                    break
                start = max(0, end - overlap_chars)
            continue
        projected = current_chars + len(text) + (2 if current_parts else 0)
        if projected > max_chars:
            flush()
        if current_start is None:
            current_start = segment_index
        current_end = segment_index
        current_chars += len(text) + (2 if current_parts else 0)
        current_parts.append(text)
        current_references.append(segment_reference(segment_index, segment.metadata))
    flush()
    if not chunks:
        raise TraditionalRagError("文档切分后没有产生 chunk", "parser_error")
    return chunks


# P7-B token 切分（opt-in，CHUNK_TOKEN_MODE=1 才启用；默认走字符基线）：按 embedding 模型自身分词器计尺寸。
# 从本地 vendored tokenizer.json 加载（离线优先、零运行时网络）；加载失败退回字符兜底；
# 字符版 split_into_chunks 是默认路径 + per-document chunk_size 显式覆盖路径（见分派）。
TARGET_TOKENS = 1024
OVERLAP_TOKENS = 128
CHAR_FALLBACK_MAX = 1600
CHAR_FALLBACK_OVERLAP = 200

_tokenizer = None
_tokenizer_loaded = False


def _get_tokenizer():
    # 懒加载 embedding 模型分词器：本地 vendored tokenizer.json（EMBEDDING_TOKENIZER_PATH）→ None（字符兜底）。
    # 离线优先、零运行时网络（国内 HF 被墙，不做运行时拉取；与 nano 一致）。任何失败都安全退回 None。
    global _tokenizer, _tokenizer_loaded

    if _tokenizer_loaded:
        return _tokenizer

    _tokenizer_loaded = True

    try:
        from tokenizers import Tokenizer
        import os

        s = get_settings()
        local_path = s.embedding_tokenizer_path
        if local_path and os.path.exists(local_path):
            _tokenizer = Tokenizer.from_file(local_path)
    except Exception:
        _tokenizer = None
    return _tokenizer


def _split_by_token(parsed: ParsedDocument, tok, *, chunk_tokens: int, overlap_tokens: int) -> list[tuple[str, dict]]:
    chunk_tokens = max(1, chunk_tokens)
    overlap_tokens = max(0, min(overlap_tokens, chunk_tokens - 1))
    sep_tokens = len(tok.encode("\n\n").ids)
    chunks: list[tuple[str, dict]] = []
    current_parts: list[str] = []
    current_references: list[dict] = []
    current_start: int | None = None
    current_end: int | None = None
    current_tokens = 0

    def flush() -> None:
        nonlocal current_parts, current_references, current_start, current_end, current_tokens
        if not current_parts:
            return
        text = "\n\n".join(current_parts).strip()
        if text:
            chunks.append((text, {
                "segment_start": current_start, "segment_end": current_end,
                "segments": current_references, "reference_kinds": reference_kinds(current_references),
                "token_count": len(tok.encode(text).ids),
            }))
        current_parts = []
        current_references = []
        current_start = None
        current_end = None
        current_tokens = 0

    for segment_index, segment in enumerate(parsed.segments):
        text = segment.text.strip()
        if not text:
            continue
        text_ids = tok.encode(text).ids
        if len(text_ids) > chunk_tokens:
            flush()
            start = 0
            while start < len(text_ids):
                end = min(len(text_ids), start + chunk_tokens)
                piece = tok.decode(text_ids[start:end]).strip()
                if piece:
                    references = [segment_reference(segment_index, segment.metadata)]
                    metadata = dict(segment.metadata)
                    metadata.update({
                        "segment_start": segment_index, "segment_end": segment_index,
                        "segments": references, "reference_kinds": reference_kinds(references),
                        "token_start": start, "token_end": end, "token_count": len(text_ids[start:end]),
                    })
                    chunks.append((piece, metadata))
                if end >= len(text_ids):
                    break
                start = max(0, end - overlap_tokens)
            continue
        projected = current_tokens + len(text_ids) + (sep_tokens if current_parts else 0)
        if projected > chunk_tokens:
            flush()
        if current_start is None:
            current_start = segment_index
        current_end = segment_index
        current_tokens += len(text_ids) + (sep_tokens if current_parts else 0)
        current_parts.append(text)
        current_references.append(segment_reference(segment_index, segment.metadata))
    flush()
    if not chunks:
        raise TraditionalRagError("文档切分后没有产生 chunk", "parser_error")
    return chunks


def split_into_chunks_default(parsed: ParsedDocument, *, chunk_tokens: int = TARGET_TOKENS, overlap_tokens: int = OVERLAP_TOKENS) -> list[tuple[str, dict]]:
    tok = _get_tokenizer()
    if tok is None:
        return split_into_chunks(parsed, max_chars=CHAR_FALLBACK_MAX, overlap_chars=CHAR_FALLBACK_OVERLAP)
    return _split_by_token(parsed, tok, chunk_tokens=chunk_tokens, overlap_tokens=overlap_tokens)


def keyword_like_pattern(query: str) -> str:
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def compact_cjk_query(query: str) -> str:
    if re.search(r"[\u3400-\u9fff\uf900-\ufaff]", query):
        return re.sub(r"\s+", "", query)
    return query


def build_chunks_and_embeddings(
    *,
    document_id: str,
    source_id: str,
    file_type: str,
    storage_path: str,
    uploaded_by: str,
    max_chars: int | None = None,
    overlap_chars: int | None = None,
    chunk_tokens: int = TARGET_TOKENS,
    overlap_tokens: int = OVERLAP_TOKENS,
) -> ChunkBuildResult:
    parsed = parse_supported_document(file_type, storage_path.split("/"))
    return build_chunks_and_embeddings_from_parsed(
        document_id=document_id,
        source_id=source_id,
        parsed=parsed,
        uploaded_by=uploaded_by,
        max_chars=max_chars,
        overlap_chars=overlap_chars,
        chunk_tokens=chunk_tokens,
        overlap_tokens=overlap_tokens,
    )


def build_chunks_and_embeddings_from_mineru_markdown(
    *,
    document_id: str,
    source_id: str,
    markdown_path: str,
    uploaded_by: str,
    max_chars: int | None = None,
    overlap_chars: int | None = None,
    chunk_tokens: int = TARGET_TOKENS,
    overlap_tokens: int = OVERLAP_TOKENS,
) -> ChunkBuildResult:
    parsed = parse_text_file(resolve_storage_path(*markdown_path.split("/")), parser="mineru_markdown")
    return build_chunks_and_embeddings_from_parsed(
        document_id=document_id,
        source_id=source_id,
        parsed=parsed,
        uploaded_by=uploaded_by,
        max_chars=max_chars,
        overlap_chars=overlap_chars,
        chunk_tokens=chunk_tokens,
        overlap_tokens=overlap_tokens,
    )


def build_chunks_and_embeddings_from_parsed(
    *,
    document_id: str,
    source_id: str,
    parsed: ParsedDocument,
    uploaded_by: str,
    max_chars: int | None = None,
    overlap_chars: int | None = None,
    chunk_tokens: int = TARGET_TOKENS,
    overlap_tokens: int = OVERLAP_TOKENS,
) -> ChunkBuildResult:
    # P7-B 分派：默认走字符切分（基线 1200/160）；仅当 get_settings().chunk_token_mode 为真
    # 且没有 per-document 字符覆盖（max_chars/overlap_chars 都是 None）时才走 token 切分。
    # per-document 显式传字符参数时永远走字符路径。
    if (max_chars is None and overlap_chars is None) and get_settings().chunk_token_mode:
        chunk_items = split_into_chunks_default(parsed, chunk_tokens=chunk_tokens, overlap_tokens=overlap_tokens)
    else:
        chunk_items = split_into_chunks(
            parsed,
            max_chars=max_chars if max_chars is not None else 1200,
            overlap_chars=overlap_chars if overlap_chars is not None else 160,
        )
    vectors, embedding_model, embedding_dimensions = embed_texts([text for text, _ in chunk_items])
    if len(vectors) != len(chunk_items):
        raise TraditionalRagError("Embedding 数量与 chunk 数量不一致", "embedding_error")

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM traditional_chunks WHERE document_id = %s", (document_id,))
            for index, ((chunk_text, metadata), vector) in enumerate(zip(chunk_items, vectors, strict=True)):
                chunk_metadata = dict(metadata)
                chunk_metadata.update({"parser": parsed.metadata.get("parser"), "uploaded_by": uploaded_by})
                cursor.execute(
                    """
                    INSERT INTO traditional_chunks (
                      id, document_id, source_id, chunk_index, chunk_text, metadata,
                      embedding, embedding_model, embedding_dimensions
                    )
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::vector, %s, %s)
                    """,
                    (
                        str(uuid4()),
                        document_id,
                        source_id,
                        index,
                        chunk_text,
                        json.dumps(chunk_metadata, ensure_ascii=False),
                        vector_literal(vector),
                        embedding_model,
                        embedding_dimensions,
                    ),
                )
        connection.commit()
    return ChunkBuildResult(
        chunk_count=len(chunk_items),
        embedding_model=embedding_model,
        embedding_dimensions=embedding_dimensions,
        parser_metadata=parsed.metadata,
    )


def delete_chunk_row(document_id: str, chunk_id: str) -> bool:
    """真删除某文档的一个 chunk(连同其向量行)。返回是否删到。"""
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM traditional_chunks WHERE id = %s AND document_id = %s",
                (chunk_id, document_id),
            )
            deleted = cursor.rowcount > 0
        connection.commit()
        return deleted


def list_document_chunks(document_id: str) -> list[TraditionalChunk]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, document_id, source_id, chunk_index, chunk_text, metadata,
                       embedding_model, embedding_dimensions, created_at
                FROM traditional_chunks
                WHERE document_id = %s
                ORDER BY chunk_index ASC
                """,
                (document_id,),
            )
            return [map_chunk(row) for row in cursor.fetchall()]


def keyword_search_chunks(user: UserContext, query: str, *, limit: int = 10) -> list[TraditionalChunk]:
    normalized = query.strip()
    if not normalized:
        raise TraditionalRagError("检索 query 不能为空", "invalid_input")
    phrase_pattern = keyword_like_pattern(normalized)
    compact_pattern = keyword_like_pattern(compact_cjk_query(normalized))
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                WITH keyword_query AS (
                  SELECT plainto_tsquery('simple', %s) AS tsq
                )
                SELECT c.id, c.document_id, c.source_id, c.chunk_index, c.chunk_text, c.metadata,
                       c.embedding_model, c.embedding_dimensions, c.created_at
                FROM traditional_chunks c
                JOIN traditional_documents d ON d.id = c.document_id
                JOIN traditional_sources s ON s.id = c.source_id
                CROSS JOIN keyword_query
                WHERE d.archived_at IS NULL
                  AND s.archived_at IS NULL
                  AND (%s = true OR s.kind = 'public' OR s.owner_user_id = %s)
                  AND (
                    c.text_search @@ keyword_query.tsq
                    OR c.chunk_text ILIKE %s ESCAPE '\\'
                    OR c.chunk_text ILIKE %s ESCAPE '\\'
                  )
                ORDER BY
                  CASE WHEN c.chunk_text ILIKE %s ESCAPE '\\' THEN 1 ELSE 0 END DESC,
                  CASE WHEN c.chunk_text ILIKE %s ESCAPE '\\' THEN 1 ELSE 0 END DESC,
                  ts_rank(c.text_search, keyword_query.tsq) DESC,
                  c.created_at DESC
                LIMIT %s
                """,
                (normalized, user.is_admin, user.user_id, phrase_pattern, compact_pattern, phrase_pattern, compact_pattern, limit),
            )
            return [map_chunk(row) for row in cursor.fetchall()]
