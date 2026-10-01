from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from traditional_rag.core.chunks import compact_cjk_query, keyword_like_pattern
from traditional_rag.core.embeddings import embed_texts, vector_literal
from traditional_rag.core.errors import TraditionalRagError
from traditional_rag.core.types import UserContext
from traditional_rag.db import get_connection

RRF_K = 60
RRF_SCORE_EPS = 1e-9
DEFAULT_CANDIDATE_LIMIT = 50


@dataclass
class SearchCandidate:
    row: dict[str, Any]
    ranks: dict[str, int] = field(default_factory=dict)
    raw_scores: dict[str, float] = field(default_factory=dict)


def normalize_filter(value: object, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise TraditionalRagError(f"{label} 必须是字符串", "invalid_input")
    normalized = value.strip()
    return normalized or None


def normalize_file_types(value: object) -> list[str] | None:
    if value is None:
        return None
    if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
        raise TraditionalRagError("file_types 必须是字符串数组", "invalid_input")
    allowed = {"pdf", "docx", "csv", "xlsx", "markdown", "txt", "html", "json", "image", "audio", "video"}
    normalized = [item.strip() for item in value]
    unsupported = sorted(set(normalized).difference(allowed))
    if unsupported:
        raise TraditionalRagError(f"不支持的 file_types：{unsupported}", "invalid_input")
    return normalized


def build_scope_filters(user: UserContext, input_data: dict[str, Any]) -> tuple[str, list[object]]:
    values: list[object] = [user.is_admin, user.user_id]
    filters = [
        "d.archived_at IS NULL",
        "s.archived_at IS NULL",
        "(%s = true OR s.kind = 'public' OR s.owner_user_id = %s)",
    ]
    source_id = normalize_filter(input_data.get("source_id"), "source_id")
    document_id = normalize_filter(input_data.get("document_id"), "document_id")
    if source_id:
        filters.append("c.source_id = %s")
        values.append(source_id)
    # 全局检索：平台传入已授权的源集合做范围过滤（与 admin/public/owner 权限 AND）。
    # 显式空列表 → 加恒假条件，不退化为全库搜索（M1）。
    source_ids = input_data.get("source_ids")
    if isinstance(source_ids, list):
        if source_ids:
            filters.append("c.source_id = ANY(%s)")
            values.append(source_ids)
        else:
            filters.append("false")
    if document_id:
        filters.append("c.document_id = %s")
        values.append(document_id)
    file_types = normalize_file_types(input_data.get("file_types"))
    if file_types:
        filters.append("d.file_type = ANY(%s)")
        values.append(file_types)
    return " AND ".join(filters), values


def search_projection() -> str:
    return """
      c.id AS chunk_id,
      c.document_id,
      c.source_id,
      c.chunk_index,
      c.chunk_text,
      c.metadata AS chunk_metadata,
      c.embedding_model,
      c.embedding_dimensions,
      c.created_at AS chunk_created_at,
      d.original_filename,
      d.file_type,
      d.status AS document_status,
      d.metadata AS document_metadata,
      d.created_at AS document_created_at,
      s.name AS source_name,
      s.kind AS source_kind,
      s.owner_user_id AS source_owner_user_id
    """


def run_lexical_recall(where_sql: str, values: list[object], query: str, candidate_limit: int) -> list[dict[str, Any]]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '10s'")  # C4：检索 SQL DB 侧硬超时
            cursor.execute(
                f"""
                WITH keyword_query AS (
                  SELECT plainto_tsquery('simple', %s) AS tsq
                )
                SELECT {search_projection()},
                       ts_rank(c.text_search, keyword_query.tsq) AS recall_score
                FROM traditional_chunks c
                JOIN traditional_documents d ON d.id = c.document_id
                JOIN traditional_sources s ON s.id = c.source_id
                CROSS JOIN keyword_query
                WHERE {where_sql}
                  AND c.text_search @@ keyword_query.tsq
                ORDER BY recall_score DESC, c.created_at DESC
                LIMIT %s
                """,
                [query, *values, candidate_limit],
            )
            return cursor.fetchall()


def run_literal_recall(where_sql: str, values: list[object], query: str, candidate_limit: int) -> list[dict[str, Any]]:
    phrase_pattern = keyword_like_pattern(query)
    compact_pattern = keyword_like_pattern(compact_cjk_query(query))
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '10s'")  # C4：检索 SQL DB 侧硬超时
            cursor.execute(
                f"""
                SELECT {search_projection()},
                       GREATEST(
                         CASE WHEN c.chunk_text ILIKE %s ESCAPE '\\' THEN 1.0 ELSE 0.0 END,
                         CASE WHEN c.chunk_text ILIKE %s ESCAPE '\\' THEN 0.95 ELSE 0.0 END
                       ) AS recall_score
                FROM traditional_chunks c
                JOIN traditional_documents d ON d.id = c.document_id
                JOIN traditional_sources s ON s.id = c.source_id
                WHERE {where_sql}
                  AND (
                    c.chunk_text ILIKE %s ESCAPE '\\'
                    OR c.chunk_text ILIKE %s ESCAPE '\\'
                  )
                ORDER BY recall_score DESC, c.created_at DESC
                LIMIT %s
                """,
                [phrase_pattern, compact_pattern, *values, phrase_pattern, compact_pattern, candidate_limit],
            )
            return cursor.fetchall()


def run_vector_recall(where_sql: str, values: list[object], query: str, candidate_limit: int) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    try:
        vectors, model, dimensions = embed_texts([query])
    except TraditionalRagError as error:
        if error.code == "config_error":
            return [], {"type": "vector", "status": "skipped", "reason": error.message}
        raise
    query_vector = vector_literal(vectors[0])
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '10s'")  # C4：检索 SQL DB 侧硬超时
            cursor.execute(
                f"""
                SELECT {search_projection()},
                       (1.0 / (1.0 + (c.embedding <=> %s::vector))) AS recall_score
                FROM traditional_chunks c
                JOIN traditional_documents d ON d.id = c.document_id
                JOIN traditional_sources s ON s.id = c.source_id
                WHERE {where_sql}
                  AND c.embedding_model = %s
                  AND c.embedding_dimensions = %s
                ORDER BY c.embedding <=> %s::vector ASC, c.created_at DESC
                LIMIT %s
                """,
                [query_vector, *values, model, dimensions, query_vector, candidate_limit],
            )
            return cursor.fetchall(), {"type": "vector", "status": "ok", "model": model, "dimensions": dimensions}


def add_candidates(candidates: dict[str, SearchCandidate], rows: list[dict[str, Any]], recall_type: str) -> None:
    for rank, row in enumerate(rows, start=1):
        chunk_id = row["chunk_id"]
        candidate = candidates.get(chunk_id)
        if not candidate:
            candidate = SearchCandidate(row=row)
            candidates[chunk_id] = candidate
        candidate.ranks.setdefault(recall_type, rank)
        score = row.get("recall_score")
        if isinstance(score, (int, float)):
            candidate.raw_scores[recall_type] = float(score)


def rrf_score(candidate: SearchCandidate) -> float:
    return sum(1.0 / (RRF_K + rank) for rank in candidate.ranks.values())


def snippet(text: str, query: str, size: int = 220) -> str:
    normalized = query.strip()
    compact = compact_cjk_query(normalized)
    positions = [text.lower().find(normalized.lower())]
    if compact != normalized:
        positions.append(text.lower().find(compact.lower()))
    position = next((value for value in positions if value >= 0), 0)
    start = max(position - 60, 0)
    end = min(start + size, len(text))
    return text[start:end]


def table_references(row: dict[str, Any]) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    metadata = row.get("chunk_metadata") or {}
    for segment in metadata.get("segments") or []:
        if isinstance(segment, dict) and segment.get("kind") == "table":
            refs.append({
                "segment_index": segment.get("segment_index"),
                "table_index": segment.get("table_index"),
                "row_count": segment.get("row_count"),
            })
    return refs


def to_search_result(candidate: SearchCandidate, query: str, normalized_score: float) -> dict[str, Any]:
    row = candidate.row
    score = rrf_score(candidate)
    return {
        "chunk": {
            "id": row["chunk_id"],
            "document_id": row["document_id"],
            "source_id": row["source_id"],
            "chunk_index": row["chunk_index"],
            "text": row["chunk_text"],
            "snippet": snippet(row["chunk_text"], query),
            "metadata": row["chunk_metadata"],
            "embedding_model": row["embedding_model"],
            "embedding_dimensions": row["embedding_dimensions"],
            "created_at": row["chunk_created_at"].isoformat(),
        },
        "score": score,
        "normalized_score": normalized_score,
        "match_types": sorted(candidate.ranks.keys()),
        "rank_details": {
            recall_type: {"rank": rank, "raw_score": candidate.raw_scores.get(recall_type)}
            for recall_type, rank in sorted(candidate.ranks.items())
        },
        "document": {
            "id": row["document_id"],
            "filename": row["original_filename"],
            "file_type": row["file_type"],
            "status": row["document_status"],
            "metadata": row["document_metadata"],
            "created_at": row["document_created_at"].isoformat(),
        },
        "source": {
            "id": row["source_id"],
            "name": row["source_name"],
            "kind": row["source_kind"],
            "owner_user_id": row["source_owner_user_id"],
        },
        "references": {
            "segments": (row.get("chunk_metadata") or {}).get("segments") or [],
            "segment_start": (row.get("chunk_metadata") or {}).get("segment_start"),
            "segment_end": (row.get("chunk_metadata") or {}).get("segment_end"),
            "tables": table_references(row),
            "images": (row.get("document_metadata") or {}).get("mineru", {}).get("image_paths", []),
            "pages": (row.get("document_metadata") or {}).get("mineru", {}).get("page_refs"),
        },
    }


def search(user: UserContext, input_data: dict[str, Any]) -> dict:
    # C2：改同步 def（body 全同步 psycopg+urllib，无 await）。调用方用 asyncio.to_thread 投线程池，不阻塞事件循环。
    query = input_data.get("query")
    if not isinstance(query, str) or not query.strip():
        raise TraditionalRagError("query 不能为空", "invalid_input")
    normalized_query = re.sub(r"\s+", " ", query.strip())
    limit = int(input_data.get("limit", 10))
    if limit < 1 or limit > 30:
        raise TraditionalRagError("limit 必须在 1 到 30 之间", "invalid_input")
    candidate_limit = max(limit * 5, DEFAULT_CANDIDATE_LIMIT)
    where_sql, values = build_scope_filters(user, input_data)

    candidates: dict[str, SearchCandidate] = {}
    diagnostics: list[dict[str, Any]] = []

    lexical = run_lexical_recall(where_sql, values, normalized_query, candidate_limit)
    add_candidates(candidates, lexical, "keyword")
    diagnostics.append({"type": "keyword", "status": "ok", "candidates": len(lexical)})

    literal = run_literal_recall(where_sql, values, normalized_query, candidate_limit)
    add_candidates(candidates, literal, "literal")
    diagnostics.append({"type": "literal", "status": "ok", "candidates": len(literal)})

    vector, vector_diag = run_vector_recall(where_sql, values, normalized_query, candidate_limit)
    add_candidates(candidates, vector, "vector")
    diagnostics.append(vector_diag or {"type": "vector", "status": "ok", "candidates": len(vector)})
    if diagnostics[-1].get("status") == "ok":
        diagnostics[-1]["candidates"] = len(vector)

    ordered = sorted(candidates.values(), key=lambda candidate: (rrf_score(candidate), max(candidate.raw_scores.values() or [0])), reverse=True)

    min_score = input_data.get("min_score")
    # 显式拒 bool：Python 中 True/False 是 int 子类，否则 True 会被当 1.0 静默接受。
    if min_score is not None and (isinstance(min_score, bool) or not isinstance(min_score, (int, float)) or not (0 <= min_score <= 1)):
        raise TraditionalRagError("min_score 必须在 0 到 1 之间", "invalid_input")
    # 归一化 RRF（相对本次 max）：normalized_score = rrf_score / 本次全候选最大 rrf_score。
    # ordered 已按 rrf_score 降序，[0] 即最大；EPS 防阈值=1.0 时浮点误杀并列 top。
    max_rrf = rrf_score(ordered[0]) if ordered else 0.0

    def norm_of(candidate: SearchCandidate) -> float:
        return rrf_score(candidate) / max_rrf if max_rrf > 0 else 0.0

    if min_score is not None and min_score > 0:
        selected = [candidate for candidate in ordered if norm_of(candidate) + RRF_SCORE_EPS >= min_score]
    else:
        selected = ordered

    return {
        "query": normalized_query,
        "limit": limit,
        "results": [to_search_result(candidate, normalized_query, norm_of(candidate)) for candidate in selected[:limit]],
        "diagnostics": diagnostics,
        "filters": {
            "source_id": normalize_filter(input_data.get("source_id"), "source_id"),
            "document_id": normalize_filter(input_data.get("document_id"), "document_id"),
            "file_types": normalize_file_types(input_data.get("file_types")),
        },
        "fusion": {"method": "rrf", "k": RRF_K, "candidate_limit": candidate_limit, "min_score": min_score},
    }
