from fastapi import HTTPException

from traditional_rag.core.errors import TraditionalRagError
from traditional_rag.db import TraditionalRagDatabaseError


def raise_http_error(error: Exception) -> None:
    if isinstance(error, TraditionalRagError):
        status = {
            "forbidden": 403,
            "not_found": 404,
            "duplicate_source": 409,
            "invalid_input": 400,
            "unsupported_file_type": 400,
            "config_error": 500,
            "mineru_error": 502,
            "parser_error": 400,
            "embedding_error": 502,
            "table_error": 400,
        }.get(error.code, 400)
        raise HTTPException(status_code=status, detail={"error": error.code, "message": error.message}) from error
    if isinstance(error, TraditionalRagDatabaseError):
        raise HTTPException(
            status_code=500,
            detail={"error": "missing_config", "message": str(error)},
        ) from error
    raise error
