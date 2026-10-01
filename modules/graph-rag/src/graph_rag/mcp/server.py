import os

from mcp.server.fastmcp import FastMCP

from graph_rag.core.search import get_document_context, search
from graph_rag.core.neo4j_boundary import assert_neo4j_config_valid
from graph_rag.core.sources import ensure_default_private_source, list_readable_sources
from graph_rag.core.types import UserContext

TOKEN_ENV = "GRAPH_RAG_MCP_TOKEN"

mcp = FastMCP("graph-rag")


def resolve_user_context() -> UserContext:
    # Stdio MCP is process scoped. Agent Gateway should launch one module MCP
    # process per user session and inject the user's bearer token through TOKEN_ENV.
    token = os.getenv(TOKEN_ENV)
    if not token:
        raise RuntimeError(f"{TOKEN_ENV} is not configured")
    return UserContext(
        user_id=os.getenv("FF_USER_ID", ""),
        username=os.getenv("FF_USERNAME", ""),
        is_admin=os.getenv("FF_IS_ADMIN") == "true",
    )


@mcp.tool()
async def graph_search(query: str, limit: int = 10, source_id: str | None = None, mode: str = "mix") -> dict:
    """Search GraphRAG and return evidence/context for the Agent to answer from."""
    return await search(resolve_user_context(), query, limit, source_id=source_id, mode=mode)


@mcp.tool()
async def graph_list_sources() -> dict:
    """List GraphRAG sources readable by the current user."""
    user = resolve_user_context()
    if not user.is_admin:
        await ensure_default_private_source(user.user_id, user.username)
    sources = await list_readable_sources(user)
    return {
        "sources": [
            {
                "id": source.id,
                "name": source.name,
                "description": source.description,
                "kind": source.kind,
                "owner_user_id": source.owner_user_id,
                "created_at": source.created_at.isoformat(),
                "updated_at": source.updated_at.isoformat(),
            }
            for source in sources
        ]
    }


@mcp.tool()
async def graph_get_document(document_id: str) -> dict:
    """Read a GraphRAG document if it is visible to the current user."""
    return {"document": await get_document_context(resolve_user_context(), document_id)}


def main() -> None:
    assert_neo4j_config_valid()
    mcp.run()


if __name__ == "__main__":
    main()
