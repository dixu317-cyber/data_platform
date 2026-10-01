from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from traditional_rag.core.sources import create_source, ensure_default_private_source, get_readable_source, list_readable_sources, update_source
from traditional_rag.core.types import UserContext
from traditional_rag.http.auth import require_internal_user
from traditional_rag.http.errors import raise_http_error
from traditional_rag.http.serializers import to_public_source

router = APIRouter(prefix="/traditional")


class CreateSourceRequest(BaseModel):
    name: str = Field(min_length=3, max_length=96)
    kind: str = Field(default="private", pattern="^(private|public)$")
    description: str = Field(default="", max_length=1000)


class UpdateSourceRequest(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=96)
    description: str | None = Field(default=None, max_length=1000)


@router.get("/sources")
async def list_sources_route(user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        if not user.is_admin:
            await ensure_default_private_source(user.user_id, user.username)
        sources = await list_readable_sources(user)
        return {"sources": [to_public_source(source) for source in sources]}
    except Exception as error:
        raise_http_error(error)


@router.post("/sources", status_code=201)
async def create_source_route(body: CreateSourceRequest, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        source = await create_source(user, body.name, body.kind, body.description)
        return {"source": to_public_source(source)}
    except Exception as error:
        raise_http_error(error)


@router.get("/sources/{source_id}")
async def get_source_route(source_id: str, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        source = await get_readable_source(user, source_id)
        return {"source": to_public_source(source)}
    except Exception as error:
        raise_http_error(error)


@router.patch("/sources/{source_id}")
async def update_source_route(source_id: str, body: UpdateSourceRequest, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        source = await update_source(user, source_id, name=body.name, description=body.description)
        return {"source": to_public_source(source)}
    except Exception as error:
        raise_http_error(error)
