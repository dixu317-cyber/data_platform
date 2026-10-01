from fastapi import APIRouter
from fastapi.responses import JSONResponse

from graph_rag.core.errors import GraphRagError
from graph_rag.core.neo4j_boundary import (
    assert_neo4j_config_valid,
    check_neo4j_readiness,
)

router = APIRouter()


@router.get("/health")
async def health() -> JSONResponse:
    try:
        assert_neo4j_config_valid()
        await check_neo4j_readiness()
    except GraphRagError as exc:
        return JSONResponse(
            status_code=503,
            content={"status": "error", "service": "graph-rag", "code": exc.code},
        )
    return JSONResponse(status_code=200, content={"status": "ok", "service": "graph-rag", "graph": "ready"})
