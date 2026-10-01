from fastapi import HTTPException

from graph_rag.core.errors import GraphRagError
from graph_rag.db import GraphRagDatabaseError


def raise_http_error(error: Exception) -> None:
    if isinstance(error, GraphRagError):
        status = {
            "forbidden": 403,
            "not_found": 404,
            "duplicate_source": 409,
            "conflict": 409,
            "source_unavailable": 409,
            "graph_cleanup_failed": 503,
            "postgres_cleanup_failed": 503,
            "invalid_input": 400,
            "unsupported_file_type": 400,
            "config_error": 500,
        }.get(error.code, 400)
        raise HTTPException(status_code=status, detail={"error": error.code, "message": error.message}) from error
    if isinstance(error, GraphRagDatabaseError):
        raise HTTPException(status_code=500, detail={"error": "missing_config", "message": str(error)}) from error
    if isinstance(error, ValueError):
        raise HTTPException(status_code=400, detail={"error": "invalid_input", "message": str(error)}) from error
    raise error
