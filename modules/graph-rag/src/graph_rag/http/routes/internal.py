from fastapi import APIRouter, Depends

from graph_rag.core.sources import ensure_default_private_source
from graph_rag.core.types import UserContext
from graph_rag.http.auth import require_internal_user
from graph_rag.http.errors import raise_http_error
from graph_rag.http.serializers import to_public_source

router = APIRouter(prefix="/internal")


@router.post("/users/default-source")
async def initialize_user(user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        source = await ensure_default_private_source(user.user_id, user.username)
        return {"status": "ok", "service": "graph-rag", "user_id": user.user_id, "source": to_public_source(source)}
    except Exception as error:
        raise_http_error(error)
