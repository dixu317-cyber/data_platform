from __future__ import annotations

import json
import re
from uuid import uuid4
from typing import Any

from traditional_rag.core.embeddings import embed_texts, vector_literal
from traditional_rag.core.errors import TraditionalRagError
from traditional_rag.core.types import UserContext
from traditional_rag.db import get_connection


TEXT_HINTS = ("名称", "描述", "说明", "摘要", "内容", "风险", "备注", "结论", "建议", "问题", "原因")
CATEGORY_HINTS = ("区域", "地区", "行业", "分类", "类别", "状态", "阶段", "等级", "负责人", "部门", "类型")
NUMERIC_HINTS = ("金额", "价格", "收入", "成本", "利润", "数量", "评分", "分数", "库存", "天数", "次数", "比例", "率")
DEFAULT_STRUCTURED_LIMIT = 10
MAX_STRUCTURED_LIMIT = 50


def classify_table_fields(columns: list[dict[str, Any]]) -> dict[str, list[str]]:
    text_fields: list[str] = []
    numeric_fields: list[str] = []
    categorical_fields: list[str] = []
    metadata_fields: list[str] = []

    for column in columns:
        name = column.get("name")
        if not isinstance(name, str) or not name:
            continue
        column_type = str(column.get("type") or "")
        if column_type in {"integer", "number"} or any(hint in name for hint in NUMERIC_HINTS):
            numeric_fields.append(name)
            metadata_fields.append(name)
            continue
        if any(hint in name for hint in CATEGORY_HINTS):
            categorical_fields.append(name)
            metadata_fields.append(name)
            continue
        if column_type == "string" and (any(hint in name for hint in TEXT_HINTS) or not text_fields):
            text_fields.append(name)
        else:
            metadata_fields.append(name)

    return {
        "text_fields": text_fields,
        "metadata_fields": list(dict.fromkeys(metadata_fields)),
        "numeric_fields": numeric_fields,
        "categorical_fields": categorical_fields,
    }


def row_to_semantic_text(row: dict[str, Any], *, text_fields: list[str], metadata_fields: list[str]) -> str:
    ordered_fields = list(dict.fromkeys([*text_fields, *metadata_fields]))
    lines = []
    for field in ordered_fields:
        value = row.get(field)
        if value is None or value == "":
            continue
        lines.append(f"{field}: {value}")
    return "\n".join(lines)


def make_structured_row_payloads(table: dict[str, Any], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    field_plan = classify_table_fields(table.get("columns") or [])
    text_fields = field_plan["text_fields"]
    metadata_fields = list(
        dict.fromkeys(
            [
                *field_plan["metadata_fields"],
                *field_plan["numeric_fields"],
                *field_plan["categorical_fields"],
            ]
        )
    )
    payloads: list[dict[str, Any]] = []
    for row in rows:
        values = row.get("values") if isinstance(row.get("values"), dict) else {}
        semantic_text = row_to_semantic_text(values, text_fields=text_fields, metadata_fields=metadata_fields)
        if not semantic_text.strip():
            continue
        payloads.append(
            {
                "table_id": table.get("id"),
                "document_id": table.get("document_id"),
                "source_id": table.get("source_id"),
                "row_index": row.get("row_index"),
                "semantic_text": semantic_text,
                "metadata": {
                    "field_plan": field_plan,
                    "values": values,
                },
            }
        )
    return payloads


def _resolve_column_hint(values: dict[str, Any], hint: object) -> str | None:
    if not isinstance(hint, str) or not hint:
        return None
    if hint in values:
        return hint
    return next((column for column in values if hint in column or column in hint), None)


def _compare_value(left: object, op: str, right: object) -> bool:
    if op == "contains":
        return str(right) in str(left or "")
    if op == "eq":
        return left == right
    if op == "ne":
        return left != right
    if left is None:
        return False
    try:
        left_number = float(left) if isinstance(left, (int, float, str)) else left
        right_number = float(right) if isinstance(right, (int, float, str)) else right
    except (TypeError, ValueError):
        left_number = str(left)
        right_number = str(right)
    if op == "gt":
        return left_number > right_number
    if op == "gte":
        return left_number >= right_number
    if op == "lt":
        return left_number < right_number
    if op == "lte":
        return left_number <= right_number
    return False


def apply_structured_filter_plan(values: dict[str, Any], plan: dict[str, Any]) -> bool:
    filters = plan.get("filters") if isinstance(plan, dict) else None
    if not filters:
        return True
    if not isinstance(filters, list):
        raise TraditionalRagError("structured filters 必须是数组", "invalid_input")
    for item in filters:
        if not isinstance(item, dict):
            raise TraditionalRagError("structured filter 必须是对象", "invalid_input")
        column = _resolve_column_hint(values, item.get("column_hint") or item.get("column"))
        if not column:
            return False
        if not _compare_value(values.get(column), str(item.get("op") or "eq"), item.get("value")):
            return False
    return True


def _number_from_match(match: re.Match[str]) -> int | float:
    raw = match.group("value").replace(",", "")
    return float(raw) if "." in raw else int(raw)


# 004 · FR-169:领域无关的比较词(与 op 映射)。**不含任何领域列名**——列名一律来自表实际列(数据派生)。
_COMPARE_WORD_GROUPS: list[tuple[str, str]] = [
    (r"不低于|不小于|大于等于|>=|＞=|≥", "gte"),
    (r"不高于|不大于|小于等于|<=|＜=|≤", "lte"),
    (r"大于|超过|高于|多于|超出|>|＞", "gt"),
    (r"小于|低于|少于|不足|<|＜", "lt"),
]
_NUMBER_RE = r"(?P<value>\d+(?:,\d{3})*(?:\.\d+)?)"


def plan_structured_filters(
    query: str,
    *,
    columns: list[str] | None = None,
    categorical_values: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    """从查询派生结构化过滤器。

    004 · FR-168/169:**删除所有硬编码领域词**(旧实现写死了地区名与金额类列名常量,已全部移除)。
    - 类别/枚举 contains 过滤:枚举值来自该表实际数据的 distinct 值域(``categorical_values``),非写死常量。
    - 数值比较过滤:列名来自表实际列(``columns``,数据派生),比较词领域无关;换领域零改代码仍生效。
    - 无法从数据派生出列(``columns`` 空且无类别命中)→ 诚实返回空 filters,不静默套用错误列
      (与 ``_resolve_column_hint`` 返回 None 时的短路语义对齐)。
    """
    filters: list[dict[str, Any]] = []
    derived_columns = [c for c in (columns or []) if isinstance(c, str) and c]
    derived_categoricals = categorical_values or {}

    # 1. 类别/枚举 contains:枚举值来自实际数据的 distinct 值域(数据派生,非硬编码)。
    for column, enum_values in derived_categoricals.items():
        if not isinstance(column, str) or not column:
            continue
        for value in enum_values:
            if isinstance(value, str) and value and value in query:
                candidate = {"column_hint": column, "op": "contains", "value": value}
                if candidate not in filters:
                    filters.append(candidate)

    # 2. 数值比较:列名来自表实际列(派生),比较词领域无关。长列名优先(避免子串误配)。
    if derived_columns:
        column_alt = "|".join(re.escape(c) for c in sorted(set(derived_columns), key=len, reverse=True))
        matched_spans: list[tuple[int, int]] = []
        for words, op in _COMPARE_WORD_GROUPS:
            pattern = rf"(?P<column>{column_alt})\s*(?:{words})\s*{_NUMBER_RE}"
            for match in re.finditer(pattern, query):
                # 同一文本片段已被更强的比较词组(如 >= 先于 >)匹配,则跳过,避免 gt/gte 重复。
                if any(start <= match.start() < end for start, end in matched_spans):
                    continue
                matched_spans.append((match.start(), match.end()))
                filters.append({"column_hint": match.group("column"), "op": op, "value": _number_from_match(match)})

    return {"filters": filters}


def _normalize_limit(value: object) -> int:
    if value is None:
        return DEFAULT_STRUCTURED_LIMIT
    try:
        limit = int(value)
    except (TypeError, ValueError) as error:
        raise TraditionalRagError("limit 必须是数字", "invalid_input") from error
    if limit < 1 or limit > MAX_STRUCTURED_LIMIT:
        raise TraditionalRagError(f"limit 必须在 1 到 {MAX_STRUCTURED_LIMIT} 之间", "invalid_input")
    return limit


def _normalize_optional_string(value: object, label: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise TraditionalRagError(f"{label} 必须是字符串", "invalid_input")
    return value.strip() or None


def index_structured_rows_for_document(document_id: str) -> int:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, document_id, source_id, columns
                FROM traditional_tables
                WHERE document_id = %s
                ORDER BY table_index ASC
                """,
                (document_id,),
            )
            tables = cursor.fetchall()
            table_rows: dict[str, list[dict[str, Any]]] = {}
            for table in tables:
                cursor.execute(
                    """
                    SELECT row_index, values
                    FROM traditional_table_rows
                    WHERE table_id = %s
                    ORDER BY row_index ASC
                    """,
                    (table["id"],),
                )
                table_rows[table["id"]] = cursor.fetchall()

    payloads: list[dict[str, Any]] = []
    for table in tables:
        payloads.extend(make_structured_row_payloads(table, table_rows.get(table["id"], [])))
    if not payloads:
        return 0

    vectors, embedding_model, embedding_dimensions = embed_texts([payload["semantic_text"] for payload in payloads])
    if len(vectors) != len(payloads):
        raise TraditionalRagError("结构化行 Embedding 数量与输入不一致", "embedding_error")

    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM traditional_structured_rows WHERE document_id = %s", (document_id,))
            for payload, vector in zip(payloads, vectors, strict=True):
                cursor.execute(
                    """
                    INSERT INTO traditional_structured_rows (
                      id, table_id, document_id, source_id, row_index, semantic_text,
                      metadata, embedding, embedding_model, embedding_dimensions
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::vector, %s, %s)
                    """,
                    (
                        str(uuid4()),
                        payload["table_id"],
                        payload["document_id"],
                        payload["source_id"],
                        payload["row_index"],
                        payload["semantic_text"],
                        json.dumps(payload["metadata"], ensure_ascii=False),
                        vector_literal(vector),
                        embedding_model,
                        embedding_dimensions,
                    ),
                )
        connection.commit()
    return len(payloads)


def _structured_projection() -> str:
    return """
      sr.id,
      sr.table_id,
      sr.document_id,
      sr.source_id,
      sr.row_index,
      sr.semantic_text,
      sr.metadata,
      sr.embedding_model,
      sr.embedding_dimensions,
      sr.created_at,
      t.sheet_name,
      t.columns,
      d.original_filename,
      d.file_type,
      s.name AS source_name,
      s.kind AS source_kind,
      s.owner_user_id AS source_owner_user_id
    """


def _build_scope(user: UserContext, input_data: dict[str, Any]) -> tuple[str, list[object]]:
    filters = [
        "d.archived_at IS NULL",
        "s.archived_at IS NULL",
        "(%s = true OR s.kind = 'public' OR s.owner_user_id = %s)",
    ]
    values: list[object] = [user.is_admin, user.user_id]
    for key, column in (("source_id", "sr.source_id"), ("document_id", "sr.document_id"), ("table_id", "sr.table_id")):
        value = _normalize_optional_string(input_data.get(key), key)
        if value:
            filters.append(f"{column} = %s")
            values.append(value)
    return " AND ".join(filters), values


def _literal_pattern(query: str) -> str:
    return "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _fetch_literal_candidates(where_sql: str, values: list[object], query: str, candidate_limit: int) -> list[dict[str, Any]]:
    pattern = _literal_pattern(query)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT {_structured_projection()}, 1.0 AS recall_score, 'literal' AS match_type
                FROM traditional_structured_rows sr
                JOIN traditional_tables t ON t.id = sr.table_id
                JOIN traditional_documents d ON d.id = sr.document_id
                JOIN traditional_sources s ON s.id = sr.source_id
                WHERE {where_sql}
                  AND sr.semantic_text ILIKE %s ESCAPE '\\'
                ORDER BY sr.created_at DESC
                LIMIT %s
                """,
                [*values, pattern, candidate_limit],
            )
            return cursor.fetchall()


def _fetch_vector_candidates(where_sql: str, values: list[object], query: str, candidate_limit: int) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    try:
        vectors, model, dimensions = embed_texts([query])
    except TraditionalRagError as error:
        if error.code == "config_error":
            return [], {"type": "vector", "status": "skipped", "reason": error.message}
        raise
    query_vector = vector_literal(vectors[0])
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT {_structured_projection()},
                       (1.0 / (1.0 + (sr.embedding <=> %s::vector))) AS recall_score,
                       'vector' AS match_type
                FROM traditional_structured_rows sr
                JOIN traditional_tables t ON t.id = sr.table_id
                JOIN traditional_documents d ON d.id = sr.document_id
                JOIN traditional_sources s ON s.id = sr.source_id
                WHERE {where_sql}
                  AND sr.embedding_model = %s
                  AND sr.embedding_dimensions = %s
                ORDER BY sr.embedding <=> %s::vector ASC, sr.created_at DESC
                LIMIT %s
                """,
                [query_vector, *values, model, dimensions, query_vector, candidate_limit],
            )
            return cursor.fetchall(), {"type": "vector", "status": "ok", "model": model, "dimensions": dimensions}


def _fetch_scope_candidates(where_sql: str, values: list[object], candidate_limit: int) -> list[dict[str, Any]]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT {_structured_projection()}, 0.1 AS recall_score, 'filter' AS match_type
                FROM traditional_structured_rows sr
                JOIN traditional_tables t ON t.id = sr.table_id
                JOIN traditional_documents d ON d.id = sr.document_id
                JOIN traditional_sources s ON s.id = sr.source_id
                WHERE {where_sql}
                ORDER BY sr.created_at DESC
                LIMIT %s
                """,
                [*values, candidate_limit],
            )
            return cursor.fetchall()


def _public_structured_row(row: dict[str, Any], score: float, match_types: list[str]) -> dict[str, Any]:
    metadata = row.get("metadata") or {}
    return {
        "id": row["id"],
        "table_id": row["table_id"],
        "document_id": row["document_id"],
        "source_id": row["source_id"],
        "row_index": row["row_index"],
        "semantic_text": row["semantic_text"],
        "values": metadata.get("values") or {},
        "field_plan": metadata.get("field_plan") or {},
        "score": score,
        "match_types": match_types,
        "embedding_model": row["embedding_model"],
        "embedding_dimensions": row["embedding_dimensions"],
        "created_at": row["created_at"].isoformat(),
        "table": {"id": row["table_id"], "sheet_name": row["sheet_name"], "columns": row["columns"]},
        "document": {"id": row["document_id"], "filename": row["original_filename"], "file_type": row["file_type"]},
        "source": {
            "id": row["source_id"],
            "name": row["source_name"],
            "kind": row["source_kind"],
            "owner_user_id": row["source_owner_user_id"],
        },
    }


def _derive_filter_vocabulary(where_sql: str, values: list[object]) -> tuple[list[str], dict[str, list[str]]]:
    """从 scope 内的表结构 + 行数据派生过滤器词表(FR-168/169:数据派生,零领域硬编码)。

    - 列名:来自 scope 内各表的实际列定义(``traditional_tables.columns``)。
    - 类别枚举:对分类列(``classify_table_fields`` 判定)取行数据的 distinct 字符串值域。
    大表值域派生的缓存策略若成必需 → 登记 escape-ledger(spec §11 待回报-4,不在本 feature gate)。
    """
    columns: list[str] = []
    column_defs: list[dict[str, Any]] = []
    categorical_values: dict[str, list[str]] = {}
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT DISTINCT t.columns
                FROM traditional_structured_rows sr
                JOIN traditional_tables t ON t.id = sr.table_id
                JOIN traditional_documents d ON d.id = sr.document_id
                JOIN traditional_sources s ON s.id = sr.source_id
                WHERE {where_sql}
                """,
                list(values),
            )
            for record in cursor.fetchall():
                for column in record["columns"] or []:
                    name = column.get("name")
                    if isinstance(name, str) and name and name not in columns:
                        columns.append(name)
                        column_defs.append(column)

            categorical_columns = set(classify_table_fields(column_defs)["categorical_fields"])
            if categorical_columns:
                cursor.execute(
                    f"""
                    SELECT sr.metadata
                    FROM traditional_structured_rows sr
                    JOIN traditional_tables t ON t.id = sr.table_id
                    JOIN traditional_documents d ON d.id = sr.document_id
                    JOIN traditional_sources s ON s.id = sr.source_id
                    WHERE {where_sql}
                    LIMIT 2000
                    """,
                    list(values),
                )
                for record in cursor.fetchall():
                    row_values = (record["metadata"] or {}).get("values") or {}
                    for column in categorical_columns:
                        value = row_values.get(column)
                        if isinstance(value, str) and value:
                            bucket = categorical_values.setdefault(column, [])
                            if value not in bucket:
                                bucket.append(value)
    return columns, categorical_values


def search_structured_rows(user: UserContext, input_data: dict[str, Any]) -> dict[str, Any]:
    query = input_data.get("query")
    if not isinstance(query, str) or not query.strip():
        raise TraditionalRagError("query 不能为空", "invalid_input")
    normalized_query = re.sub(r"\s+", " ", query.strip())
    limit = _normalize_limit(input_data.get("limit"))
    candidate_limit = max(limit * 6, 60)
    where_sql, values = _build_scope(user, input_data)
    # FR-168/169:列名/枚举从 scope 内实际数据派生(换领域零改代码),不写死任何领域词。
    derived_columns, derived_categoricals = _derive_filter_vocabulary(where_sql, values)
    derived_plan = plan_structured_filters(
        normalized_query, columns=derived_columns, categorical_values=derived_categoricals
    )
    filter_plan = {"filters": [*derived_plan["filters"], *(input_data.get("filters") or [])]}

    by_id: dict[str, dict[str, Any]] = {}
    diagnostics: list[dict[str, Any]] = []
    literal_rows = _fetch_literal_candidates(where_sql, values, normalized_query, candidate_limit)
    diagnostics.append({"type": "literal", "status": "ok", "candidates": len(literal_rows)})
    vector_rows, vector_diag = _fetch_vector_candidates(where_sql, values, normalized_query, candidate_limit)
    diagnostics.append({**vector_diag, "candidates": len(vector_rows)})

    candidates = [*literal_rows, *vector_rows]
    if not candidates and filter_plan["filters"]:
        candidates = _fetch_scope_candidates(where_sql, values, candidate_limit)
        diagnostics.append({"type": "filter", "status": "ok", "candidates": len(candidates)})

    for row in candidates:
        values_payload = (row.get("metadata") or {}).get("values") or {}
        if not apply_structured_filter_plan(values_payload, filter_plan):
            continue
        current = by_id.get(row["id"])
        score = float(row.get("recall_score") or 0)
        match_type = str(row.get("match_type") or "unknown")
        if current:
            current["score"] += score
            current["match_types"].add(match_type)
        else:
            by_id[row["id"]] = {"row": row, "score": score, "match_types": {match_type}}

    ordered = sorted(by_id.values(), key=lambda item: item["score"], reverse=True)[:limit]
    return {
        "query": normalized_query,
        "limit": limit,
        "results": [
            _public_structured_row(item["row"], round(item["score"], 6), sorted(item["match_types"]))
            for item in ordered
        ],
        "filter_plan": filter_plan,
        "diagnostics": diagnostics,
    }
