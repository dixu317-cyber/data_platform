import asyncio
import os
from typing import Any

from mcp.server.fastmcp import FastMCP

from traditional_rag.core.chunks import list_document_chunks
from traditional_rag.core.documents import get_readable_document, get_readable_job
from traditional_rag.core.errors import TraditionalRagError, TraditionalRagPermissionError
from traditional_rag.core.search import search
from traditional_rag.core.sources import ensure_default_private_source, list_readable_sources
from traditional_rag.core.structured import search_structured_rows
from traditional_rag.core.tables import list_document_tables, query_tables
from traditional_rag.core.types import UserContext
from traditional_rag.http.serializers import to_public_chunk, to_public_document, to_public_job, to_public_source, to_public_table

TOKEN_ENV = "TRADITIONAL_RAG_MCP_TOKEN"

mcp = FastMCP("traditional-rag")


class McpAuthError(RuntimeError):
    pass


def resolve_user_context() -> UserContext:
    # Stdio MCP is process scoped. Agent Gateway should launch one module MCP
    # process per user session and inject the user's bearer token through TOKEN_ENV.
    token = os.getenv(TOKEN_ENV)
    if not token:
        raise McpAuthError(f"{TOKEN_ENV} is not configured")
    user_id = os.getenv("FF_USER_ID", "").strip()
    username = os.getenv("FF_USERNAME", "").strip()
    if not user_id or not username:
        raise McpAuthError("FF_USER_ID and FF_USERNAME are required")
    return UserContext(
        user_id=user_id,
        username=username,
        is_admin=os.getenv("FF_IS_ADMIN") == "true",
    )


def fail(error: Exception) -> dict[str, Any]:
    if isinstance(error, McpAuthError):
        return {"error": "unauthorized", "message": str(error)}
    if isinstance(error, TraditionalRagPermissionError):
        return {"error": "forbidden", "message": error.message}
    if isinstance(error, TraditionalRagError):
        return {"error": error.code, "message": error.message}
    raise error


@mcp.tool()
async def traditional_search(
    query: str,
    limit: int = 10,
    source_id: str | None = None,
    document_id: str | None = None,
    file_types: list[str] | None = None,
) -> dict:
    """Search Traditional RAG and return evidence chunks, not a final answer."""
    try:
        input_data: dict[str, Any] = {"query": query, "limit": limit}
        if source_id:
            input_data["source_id"] = source_id
        if document_id:
            input_data["document_id"] = document_id
        if file_types:
            input_data["file_types"] = file_types
        # C2：search 已改同步 def，投线程池避免阻塞 MCP 事件循环。
        return await asyncio.to_thread(search, resolve_user_context(), input_data)
    except Exception as error:
        return fail(error)


@mcp.tool(name="search_structured_rows")
async def search_structured_rows_tool(
    query: str,
    limit: int = 10,
    source_id: str | None = None,
    document_id: str | None = None,
) -> dict:
    """Semantic search over table rows (CSV/XLSX). 表格资料(CSV/XLSX)语义检索走本工具;正文分块走 traditional_search。

    与 Web 腿(POST /traditional/structured/search)**完全同一底层 core**(search_structured_rows),
    走同一 resolve_user_context 鉴权与权限过滤;返回结构与 traditional_search 同构(便于 Agent 融合)。
    """
    try:
        input_data: dict[str, Any] = {"query": query, "limit": limit}
        if source_id:
            input_data["source_id"] = source_id
        if document_id:
            input_data["document_id"] = document_id
        return await asyncio.to_thread(search_structured_rows, resolve_user_context(), input_data)
    except Exception as error:
        return fail(error)


@mcp.tool()
async def traditional_query_table(
    query: str | None = None,
    operation: str | None = None,
    aggregate: str | None = None,
    table_id: str | None = None,
    source_id: str | None = None,
    document_id: str | None = None,
    sheet_name: str | None = None,
    column: str | None = None,
    group_by: str | None = None,
    sort_column: str | None = None,
    sort_direction: str | None = None,
    filters: list[dict] | None = None,
    columns: list[str] | None = None,
    limit: int | None = None,
) -> dict:
    """Run a read-only table query over readable CSV/XLSX tables."""
    try:
        input_data = {
            key: value
            for key, value in {
                "query": query,
                "operation": operation,
                "aggregate": aggregate,
                "table_id": table_id,
                "source_id": source_id,
                "document_id": document_id,
                "sheet_name": sheet_name,
                "column": column,
                "group_by": group_by,
                "sort_column": sort_column,
                "sort_direction": sort_direction,
                "filters": filters,
                "columns": columns,
                "limit": limit,
            }.items()
            if value is not None
        }
        return await query_tables(resolve_user_context(), input_data)
    except Exception as error:
        return fail(error)


@mcp.tool()
async def traditional_get_document(document_id: str, include_chunks: bool = True, include_tables: bool = True) -> dict:
    """Get a readable Traditional RAG document with optional chunks and tables."""
    try:
        user = resolve_user_context()
        document = await get_readable_document(user, document_id)
        payload: dict[str, Any] = {"document": to_public_document(document)}
        if include_chunks:
            payload["chunks"] = [to_public_chunk(chunk) for chunk in list_document_chunks(document.id)]
        if include_tables:
            payload["tables"] = [to_public_table(table) for table in await list_document_tables(user, document.id)]
        return payload
    except Exception as error:
        return fail(error)


@mcp.tool()
async def traditional_list_sources() -> dict:
    """List Traditional RAG sources readable by the current user."""
    try:
        user = resolve_user_context()
        if not user.is_admin:
            await ensure_default_private_source(user.user_id, user.username)
        sources = await list_readable_sources(user)
        return {"sources": [to_public_source(source) for source in sources]}
    except Exception as error:
        return fail(error)


@mcp.tool()
async def traditional_get_job(job_id: str) -> dict:
    """Get a readable Traditional RAG ingestion job."""
    try:
        job = await get_readable_job(resolve_user_context(), job_id)
        return {"job": to_public_job(job)}
    except Exception as error:
        return fail(error)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
