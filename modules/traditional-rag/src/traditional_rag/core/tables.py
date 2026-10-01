from __future__ import annotations

import asyncio
import csv
import json
import re
import zipfile
from dataclasses import dataclass
from datetime import datetime
from io import StringIO
from pathlib import Path
from uuid import uuid4
from xml.etree import ElementTree

from traditional_rag.core.documents import TraditionalDocument, get_readable_document
from traditional_rag.core.errors import TraditionalRagError
from traditional_rag.core.sources import get_source_by_id, assert_can_read_source
from traditional_rag.core.types import UserContext
from traditional_rag.db import get_connection
from traditional_rag.storage import resolve_storage_path


MAX_TABLE_ROWS = 5000
MAX_RESULT_ROWS = 200
ALLOWED_OPERATIONS = {"filter", "sort", "count", "sum", "average", "min", "max", "group"}
ALLOWED_FILTER_OPS = {"eq", "ne", "gt", "gte", "lt", "lte", "contains", "starts_with", "ends_with", "in"}


@dataclass(frozen=True)
class TraditionalTable:
    id: str
    document_id: str
    source_id: str
    table_index: int
    sheet_name: str
    columns: list[dict]
    row_count: int
    metadata: dict
    created_at: object


@dataclass(frozen=True)
class ParsedTable:
    sheet_name: str
    columns: list[dict]
    rows: list[dict]
    metadata: dict


@dataclass(frozen=True)
class TableBuildResult:
    table_count: int
    row_count: int
    parser_metadata: dict


def map_table(row: dict) -> TraditionalTable:
    return TraditionalTable(
        id=row["id"],
        document_id=row["document_id"],
        source_id=row["source_id"],
        table_index=row["table_index"],
        sheet_name=row["sheet_name"],
        columns=row["columns"],
        row_count=row["row_count"],
        metadata=row["metadata"],
        created_at=row["created_at"],
    )


def normalize_header(value: object, index: int) -> str:
    text = str(value or "").strip()
    return text if text else f"column_{index + 1}"


def dedupe_headers(headers: list[str]) -> list[str]:
    counts: dict[str, int] = {}
    result: list[str] = []
    for header in headers:
        count = counts.get(header, 0)
        counts[header] = count + 1
        result.append(header if count == 0 else f"{header}_{count + 1}")
    return result


def parse_scalar(value: object) -> object:
    if value is None:
        return None
    text = str(value).strip()
    if text == "":
        return None
    normalized = text.replace(",", "")
    if re.fullmatch(r"[-+]?\d+", normalized):
        try:
            return int(normalized)
        except ValueError:
            return text
    if re.fullmatch(r"[-+]?(?:\d+\.\d*|\d*\.\d+)", normalized):
        try:
            return float(normalized)
        except ValueError:
            return text
    lowered = text.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    return text


def infer_column_type(values: list[object]) -> str:
    present = [value for value in values if value is not None]
    if not present:
        return "empty"
    if all(isinstance(value, bool) for value in present):
        return "boolean"
    if all(isinstance(value, int) and not isinstance(value, bool) for value in present):
        return "integer"
    if all(isinstance(value, (int, float)) and not isinstance(value, bool) for value in present):
        return "number"
    return "string"


def build_parsed_table(sheet_name: str, raw_rows: list[list[object]], metadata: dict) -> ParsedTable | None:
    non_empty_rows = [row for row in raw_rows if any(str(value or "").strip() for value in row)]
    if not non_empty_rows:
        return None
    headers = dedupe_headers([normalize_header(value, index) for index, value in enumerate(non_empty_rows[0])])
    parsed_rows: list[dict] = []
    for raw_row in non_empty_rows[1:]:
        values = {header: parse_scalar(raw_row[index] if index < len(raw_row) else None) for index, header in enumerate(headers)}
        if any(value is not None for value in values.values()):
            parsed_rows.append(values)
    if len(parsed_rows) > MAX_TABLE_ROWS:
        raise TraditionalRagError(f"表格行数超过上限 {MAX_TABLE_ROWS}", "table_error")
    columns = [
        {
            "name": header,
            "type": infer_column_type([row.get(header) for row in parsed_rows]),
            "index": index,
            "non_null_count": sum(1 for row in parsed_rows if row.get(header) is not None),
        }
        for index, header in enumerate(headers)
    ]
    return ParsedTable(
        sheet_name=sheet_name,
        columns=columns,
        rows=parsed_rows,
        metadata={**metadata, "column_count": len(columns), "row_count": len(parsed_rows)},
    )


def parse_csv_table(path: Path) -> list[ParsedTable]:
    raw = path.read_bytes()
    text = raw.decode("utf-8-sig", errors="replace")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample)
    except csv.Error:
        dialect = csv.excel
    rows = list(csv.reader(StringIO(text), dialect))
    table = build_parsed_table("CSV", rows, {"parser": "csv", "dialect": dialect.delimiter})
    if not table:
        raise TraditionalRagError("CSV 未抽取到可查询表格", "parser_error")
    return [table]


def xlsx_column_index(cell_ref: str) -> int:
    letters = "".join(char for char in cell_ref if char.isalpha()).upper()
    index = 0
    for char in letters:
        index = index * 26 + (ord(char) - ord("A") + 1)
    return max(index - 1, 0)


def xlsx_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        xml = archive.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ElementTree.fromstring(xml)
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    strings: list[str] = []
    for item in root.findall("s:si", ns):
        parts = [node.text or "" for node in item.findall(".//s:t", ns)]
        strings.append("".join(parts))
    return strings


def xlsx_sheet_paths(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
    workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    rels = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    ns = {
        "s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
    }
    rel_targets = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall("pr:Relationship", ns)
        if "Id" in rel.attrib and "Target" in rel.attrib
    }
    sheets: list[tuple[str, str]] = []
    for sheet in workbook.findall("s:sheets/s:sheet", ns):
        name = sheet.attrib.get("name", f"Sheet{len(sheets) + 1}")
        rel_id = sheet.attrib.get(f"{{{ns['r']}}}id")
        target = rel_targets.get(rel_id or "")
        if not target:
            continue
        path = target.lstrip("/")
        if not path.startswith("xl/"):
            path = f"xl/{path}"
        sheets.append((name, path))
    return sheets


def xlsx_cell_value(cell: ElementTree.Element, shared_strings: list[str], ns: dict[str, str]) -> object:
    cell_type = cell.attrib.get("t")
    value_node = cell.find("s:v", ns)
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//s:t", ns))
    if value_node is None or value_node.text is None:
        return None
    raw = value_node.text
    if cell_type == "s":
        try:
            return shared_strings[int(raw)]
        except (ValueError, IndexError):
            return raw
    if cell_type == "b":
        return raw == "1"
    return raw


def parse_xlsx_table(path: Path) -> list[ParsedTable]:
    try:
        with zipfile.ZipFile(path) as archive:
            shared_strings = xlsx_shared_strings(archive)
            ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            tables: list[ParsedTable] = []
            for sheet_index, (sheet_name, sheet_path) in enumerate(xlsx_sheet_paths(archive)):
                root = ElementTree.fromstring(archive.read(sheet_path))
                raw_rows: list[list[object]] = []
                for row in root.findall(".//s:sheetData/s:row", ns):
                    values: list[object] = []
                    for cell in row.findall("s:c", ns):
                        ref = cell.attrib.get("r", "")
                        column_index = xlsx_column_index(ref)
                        while len(values) <= column_index:
                            values.append(None)
                        values[column_index] = xlsx_cell_value(cell, shared_strings, ns)
                    raw_rows.append(values)
                table = build_parsed_table(
                    sheet_name,
                    raw_rows,
                    {"parser": "xlsx", "sheet_index": sheet_index, "sheet_path": sheet_path},
                )
                if table:
                    tables.append(table)
            if not tables:
                raise TraditionalRagError("XLSX 未抽取到可查询表格", "parser_error")
            return tables
    except zipfile.BadZipFile as error:
        raise TraditionalRagError("XLSX 文件损坏，无法解压", "parser_error") from error
    except KeyError as error:
        raise TraditionalRagError(f"XLSX 缺少必要结构：{error}", "parser_error") from error


def parse_supported_table_document(file_type: str, path_parts: list[str]) -> list[ParsedTable]:
    path = resolve_storage_path(*path_parts)
    if file_type == "csv":
        return parse_csv_table(path)
    if file_type == "xlsx":
        return parse_xlsx_table(path)
    raise TraditionalRagError(f"M45 不处理该文件类型：{file_type}", "unsupported_file_type")


def build_tables(
    *,
    document_id: str,
    source_id: str,
    file_type: str,
    storage_path: str,
) -> TableBuildResult:
    parsed_tables = parse_supported_table_document(file_type, storage_path.split("/"))
    total_rows = 0
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM traditional_tables WHERE document_id = %s", (document_id,))
            for table_index, table in enumerate(parsed_tables):
                table_id = str(uuid4())
                total_rows += len(table.rows)
                cursor.execute(
                    """
                    INSERT INTO traditional_tables (
                      id, document_id, source_id, table_index, sheet_name, columns, row_count, metadata
                    )
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb)
                    """,
                    (
                        table_id,
                        document_id,
                        source_id,
                        table_index,
                        table.sheet_name,
                        json.dumps(table.columns, ensure_ascii=False),
                        len(table.rows),
                        json.dumps(table.metadata, ensure_ascii=False),
                    ),
                )
                for row_index, row_values in enumerate(table.rows):
                    cursor.execute(
                        """
                        INSERT INTO traditional_table_rows (
                          id, table_id, document_id, source_id, row_index, values
                        )
                        VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                        """,
                        (
                            str(uuid4()),
                            table_id,
                            document_id,
                            source_id,
                            row_index,
                            json.dumps(row_values, ensure_ascii=False),
                        ),
                    )
        connection.commit()
    from traditional_rag.core.structured import index_structured_rows_for_document

    structured_row_count = index_structured_rows_for_document(document_id)
    return TableBuildResult(
        table_count=len(parsed_tables),
        row_count=total_rows,
        parser_metadata={
            "parser": file_type,
            "table_count": len(parsed_tables),
            "row_count": total_rows,
            "structured_row_count": structured_row_count,
            "max_rows": MAX_TABLE_ROWS,
        },
    )


def _column_names(table: TraditionalTable) -> set[str]:
    return {column["name"] for column in table.columns if isinstance(column, dict) and isinstance(column.get("name"), str)}


def _require_column(table: TraditionalTable, column: str | None, label: str = "column") -> str:
    if not column or not isinstance(column, str):
        raise TraditionalRagError(f"{label} 不能为空", "invalid_input")
    if column not in _column_names(table):
        raise TraditionalRagError(f"未知列：{column}", "invalid_input")
    return column


def _coerce_limit(value: object, default: int = 50) -> int:
    if value is None:
        return default
    try:
        limit = int(value)
    except (TypeError, ValueError) as error:
        raise TraditionalRagError("limit 必须是数字", "invalid_input") from error
    if limit < 1 or limit > MAX_RESULT_ROWS:
        raise TraditionalRagError(f"limit 必须在 1 到 {MAX_RESULT_ROWS} 之间", "invalid_input")
    return limit


def compare_values(left: object, op: str, right: object) -> bool:
    if op not in ALLOWED_FILTER_OPS:
        raise TraditionalRagError(f"不支持的筛选操作：{op}", "invalid_input")
    if op == "eq":
        return left == right
    if op == "ne":
        return left != right
    if op == "contains":
        return str(right) in str(left or "")
    if op == "starts_with":
        return str(left or "").startswith(str(right))
    if op == "ends_with":
        return str(left or "").endswith(str(right))
    if op == "in":
        if not isinstance(right, list):
            raise TraditionalRagError("in 操作的 value 必须是数组", "invalid_input")
        return left in right
    if left is None:
        return False
    try:
        left_value = float(left) if isinstance(left, (int, float, str)) else left
        right_value = float(right) if isinstance(right, (int, float, str)) else right
    except (TypeError, ValueError):
        left_value = str(left)
        right_value = str(right)
    if op == "gt":
        return left_value > right_value
    if op == "gte":
        return left_value >= right_value
    if op == "lt":
        return left_value < right_value
    if op == "lte":
        return left_value <= right_value
    return False


def apply_filters(rows: list[dict], filters: object, table: TraditionalTable) -> tuple[list[dict], list[dict]]:
    if filters is None:
        return rows, []
    if not isinstance(filters, list):
        raise TraditionalRagError("filters 必须是数组", "invalid_input")
    normalized_filters: list[dict] = []
    result = rows
    for item in filters:
        if not isinstance(item, dict):
            raise TraditionalRagError("filter 必须是对象", "invalid_input")
        column = _require_column(table, item.get("column") if isinstance(item.get("column"), str) else None, "filter.column")
        op = item.get("op", "eq")
        if not isinstance(op, str):
            raise TraditionalRagError("filter.op 必须是字符串", "invalid_input")
        value = item.get("value")
        result = [row for row in result if compare_values(row["values"].get(column), op, value)]
        normalized_filters.append({"column": column, "op": op, "value": value})
    return result, normalized_filters


def numeric_values(rows: list[dict], column: str) -> list[float]:
    values: list[float] = []
    for row in rows:
        value = row["values"].get(column)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            values.append(float(value))
    return values


def list_readable_tables(user: UserContext, document_id: str | None = None, source_id: str | None = None) -> list[TraditionalTable]:
    params: list[object] = [user.is_admin, user.user_id]
    filters = ["d.archived_at IS NULL", "s.archived_at IS NULL", "(%s = true OR s.kind = 'public' OR s.owner_user_id = %s)"]
    if document_id:
        filters.append("t.document_id = %s")
        params.append(document_id)
    if source_id:
        filters.append("t.source_id = %s")
        params.append(source_id)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT t.id, t.document_id, t.source_id, t.table_index, t.sheet_name,
                       t.columns, t.row_count, t.metadata, t.created_at
                FROM traditional_tables t
                JOIN traditional_documents d ON d.id = t.document_id
                JOIN traditional_sources s ON s.id = t.source_id
                WHERE {" AND ".join(filters)}
                ORDER BY t.created_at DESC, t.table_index ASC
                """,
                tuple(params),
            )
            return [map_table(row) for row in cursor.fetchall()]


async def list_document_tables(user: UserContext, document_id: str) -> list[TraditionalTable]:
    document = await get_readable_document(user, document_id)
    return list_readable_tables(user, document.id)


async def get_readable_table(user: UserContext, table_id: str) -> TraditionalTable:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, document_id, source_id, table_index, sheet_name, columns, row_count, metadata, created_at
                FROM traditional_tables
                WHERE id = %s
                """,
                (table_id,),
            )
            row = cursor.fetchone()
    if not row:
        raise TraditionalRagError("table 不存在", "not_found")
    table = map_table(row)
    source = await get_source_by_id(table.source_id)
    if not source:
        raise TraditionalRagError("source 不存在", "not_found")
    assert_can_read_source(user, source)
    document = await get_readable_document(user, table.document_id)
    if document.archived_at is not None:
        raise TraditionalRagError("document 不存在", "not_found")
    return table


def fetch_table_rows(table_id: str) -> list[dict]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT row_index, values
                FROM traditional_table_rows
                WHERE table_id = %s
                ORDER BY row_index ASC
                """,
                (table_id,),
            )
            return cursor.fetchall()


def build_table_row_chunks(
    tables: list[TraditionalTable], *, max_rows_per_table: int = MAX_RESULT_ROWS
) -> list[dict]:
    """把表格行序列化成 chunk 式条目，供后台「按文档查看 chunk」预览 CSV/XLSX 内容。

    CSV/XLSX 不写 traditional_chunks(行数据存 traditional_tables / traditional_table_rows)，
    后台 chunk 浏览器直接查 chunks 会显示「暂无 chunk」。此函数按行渲染文本块，
    结构与 to_public_chunk 对齐，让表格文档在同一浏览器里可见。
    """
    chunks: list[dict] = []
    running = 0
    for table in tables:
        created = table.created_at.isoformat() if hasattr(table.created_at, "isoformat") else str(table.created_at)
        for row in fetch_table_rows(table.id)[:max_rows_per_table]:
            values = row.get("values") or {}
            text = " ｜ ".join(f"{key}：{value}" for key, value in values.items()) or "(空行)"
            chunks.append(
                {
                    "id": f"{table.id}:{row['row_index']}",
                    "document_id": table.document_id,
                    "source_id": table.source_id,
                    "chunk_index": running,
                    "chunk_text": text,
                    "metadata": {
                        "kind": "table_row",
                        "sheet_name": table.sheet_name,
                        "table_index": table.table_index,
                        "row_index": row["row_index"],
                    },
                    "embedding_model": None,
                    "embedding_dimensions": None,
                    "created_at": created,
                }
            )
            running += 1
    return chunks


def find_first_readable_table(user: UserContext, input_data: dict) -> TraditionalTable:
    table_id = input_data.get("table_id")
    if isinstance(table_id, str) and table_id:
        raise TraditionalRagError("internal table lookup requires async path", "invalid_input")
    params: list[object] = [user.is_admin, user.user_id]
    filters = ["d.archived_at IS NULL", "s.archived_at IS NULL", "(%s = true OR s.kind = 'public' OR s.owner_user_id = %s)"]
    for key, column in (("document_id", "t.document_id"), ("source_id", "t.source_id"), ("sheet_name", "t.sheet_name")):
        value = input_data.get(key)
        if isinstance(value, str) and value:
            filters.append(f"{column} = %s")
            params.append(value)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                SELECT t.id, t.document_id, t.source_id, t.table_index, t.sheet_name,
                       t.columns, t.row_count, t.metadata, t.created_at
                FROM traditional_tables t
                JOIN traditional_documents d ON d.id = t.document_id
                JOIN traditional_sources s ON s.id = t.source_id
                WHERE {" AND ".join(filters)}
                ORDER BY t.created_at DESC, t.table_index ASC
                LIMIT 1
                """,
                tuple(params),
            )
            row = cursor.fetchone()
    if not row:
        raise TraditionalRagError("没有找到可查询表格", "not_found")
    return map_table(row)


def normalize_operation(value: object) -> str:
    operation = value if isinstance(value, str) else "filter"
    aliases = {"avg": "average", "mean": "average"}
    operation = aliases.get(operation, operation)
    if operation not in ALLOWED_OPERATIONS:
        raise TraditionalRagError(f"不支持的表格操作：{operation}", "invalid_input")
    return operation


def plan_from_query(query: str, table: TraditionalTable) -> dict:
    column_names = list(_column_names(table))
    matched_column = next((column for column in column_names if column in query), None)
    plan: dict = {"operation": "filter", "limit": 50}
    if any(word in query for word in ("平均", "均值", "average", "avg")):
        plan = {"operation": "average", "column": matched_column}
    elif any(word in query for word in ("求和", "合计", "总和", "sum")):
        plan = {"operation": "sum", "column": matched_column}
    elif any(word in query for word in ("最大", "最高", "max")):
        plan = {"operation": "max", "column": matched_column}
    elif any(word in query for word in ("最小", "最低", "min")):
        plan = {"operation": "min", "column": matched_column}
    elif any(word in query for word in ("多少", "数量", "计数", "count")):
        plan = {"operation": "count"}
    group_column = None
    group_match = re.search(r"按(.+?)(?:分组|统计|汇总)", query)
    if group_match:
        candidate = group_match.group(1).strip()
        group_column = next((column for column in column_names if column in candidate), None)
    if group_column:
        plan["operation"] = "group"
        plan["group_by"] = group_column
        plan.setdefault("aggregate", "count")
        if matched_column and matched_column != group_column and plan.get("aggregate") == "count":
            plan["column"] = matched_column
    return plan


def execute_table_query(table: TraditionalTable, input_data: dict) -> dict:
    raw_query = input_data.get("query")
    planned = plan_from_query(raw_query, table) if isinstance(raw_query, str) and raw_query.strip() else {}
    plan = {**planned, **{key: value for key, value in input_data.items() if value is not None}}
    operation = normalize_operation(plan.get("operation"))
    rows, normalized_filters = apply_filters(fetch_table_rows(table.id), plan.get("filters"), table)
    limit = _coerce_limit(plan.get("limit"), default=50)
    row_indices = [row["row_index"] for row in rows]
    columns_used: list[str] = []

    sort_column = plan.get("sort_column")
    if sort_column:
        sort_column = _require_column(table, sort_column if isinstance(sort_column, str) else None, "sort_column")
        reverse = plan.get("sort_direction") == "desc"
        rows = sorted(rows, key=lambda row: (row["values"].get(sort_column) is None, row["values"].get(sort_column)), reverse=reverse)
        columns_used.append(sort_column)

    if operation == "sort":
        operation = "filter"
    if operation == "filter":
        selected_columns = plan.get("columns")
        if selected_columns is not None:
            if not isinstance(selected_columns, list):
                raise TraditionalRagError("columns 必须是数组", "invalid_input")
            selected = [_require_column(table, column if isinstance(column, str) else None, "columns") for column in selected_columns]
        else:
            selected = [column["name"] for column in table.columns]
        columns_used.extend(selected)
        result_rows = [
            {"row_index": row["row_index"], "values": {column: row["values"].get(column) for column in selected}}
            for row in rows[:limit]
        ]
        return {
            "kind": "rows",
            "rows": result_rows,
            "total_matched": len(rows),
            "returned": len(result_rows),
            "plan": {**plan, "operation": "filter", "filters": normalized_filters, "limit": limit},
            "references": {"row_indices": row_indices[:limit], "columns": sorted(set(columns_used))},
        }

    if operation == "count":
        return {
            "kind": "scalar",
            "value": len(rows),
            "plan": {**plan, "operation": "count", "filters": normalized_filters},
            "references": {"row_indices": row_indices, "columns": sorted(set(columns_used))},
        }

    if operation in {"sum", "average", "min", "max"}:
        column = _require_column(table, plan.get("column") if isinstance(plan.get("column"), str) else None)
        columns_used.append(column)
        values = numeric_values(rows, column)
        if not values:
            raise TraditionalRagError(f"列 {column} 没有可聚合的数字值", "invalid_input")
        if operation == "sum":
            value = sum(values)
        elif operation == "average":
            value = sum(values) / len(values)
        elif operation == "min":
            value = min(values)
        else:
            value = max(values)
        return {
            "kind": "scalar",
            "value": value,
            "matched_numeric_rows": len(values),
            "plan": {**plan, "operation": operation, "filters": normalized_filters},
            "references": {"row_indices": row_indices, "columns": sorted(set(columns_used))},
        }

    group_by = _require_column(table, plan.get("group_by") if isinstance(plan.get("group_by"), str) else None, "group_by")
    aggregate = normalize_operation(plan.get("aggregate") or "count")
    if aggregate == "group":
        aggregate = "count"
    if aggregate not in {"count", "sum", "average", "min", "max"}:
        raise TraditionalRagError("group.aggregate 仅支持 count、sum、average、min、max", "invalid_input")
    aggregate_column = plan.get("column") if aggregate != "count" else None
    if aggregate_column:
        aggregate_column = _require_column(table, aggregate_column if isinstance(aggregate_column, str) else None)
    groups: dict[str, list[dict]] = {}
    for row in rows:
        key = str(row["values"].get(group_by))
        groups.setdefault(key, []).append(row)
    group_results: list[dict] = []
    for key, group_rows in groups.items():
        if aggregate == "count":
            value = len(group_rows)
        else:
            values = numeric_values(group_rows, aggregate_column or "")
            if not values:
                value = None
            elif aggregate == "sum":
                value = sum(values)
            elif aggregate == "average":
                value = sum(values) / len(values)
            elif aggregate == "min":
                value = min(values)
            else:
                value = max(values)
        group_results.append({"group": key, "value": value, "row_count": len(group_rows)})
    group_results.sort(key=lambda item: item["group"])
    columns_used.extend([group_by] + ([aggregate_column] if isinstance(aggregate_column, str) else []))
    return {
        "kind": "groups",
        "groups": group_results[:limit],
        "total_groups": len(group_results),
        "plan": {**plan, "operation": "group", "aggregate": aggregate, "filters": normalized_filters, "limit": limit},
        "references": {"row_indices": row_indices, "columns": sorted(set(columns_used))},
    }


async def query_tables(user: UserContext, input_data: dict) -> dict:
    if not isinstance(input_data, dict):
        raise TraditionalRagError("查询请求必须是对象", "invalid_input")
    table_id = input_data.get("table_id")
    if isinstance(table_id, str) and table_id:
        table = await get_readable_table(user, table_id)
    else:
        table = find_first_readable_table(user, input_data)
    result = await asyncio.to_thread(execute_table_query, table, input_data)
    return {
        "table": {
            "id": table.id,
            "document_id": table.document_id,
            "source_id": table.source_id,
            "table_index": table.table_index,
            "sheet_name": table.sheet_name,
            "columns": table.columns,
            "row_count": table.row_count,
            "metadata": table.metadata,
        },
        "result": result,
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
