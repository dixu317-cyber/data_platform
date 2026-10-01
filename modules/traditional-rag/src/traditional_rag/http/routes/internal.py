from fastapi import APIRouter, Depends

from traditional_rag.core.sources import ensure_default_private_source
from traditional_rag.core.types import UserContext
from traditional_rag.http.auth import require_internal_user
from traditional_rag.http.errors import raise_http_error
from traditional_rag.http.serializers import to_public_source

router = APIRouter(prefix="/internal")


@router.post("/users/default-source")
async def initialize_user(user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        source = await ensure_default_private_source(user.user_id, user.username)
        return {"status": "ok", "service": "traditional-rag", "user_id": user.user_id, "source": to_public_source(source)}
    except Exception as error:
        raise_http_error(error)
