from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from graph_rag.core.lightrag_service import set_schema_profile_and_forget
from graph_rag.core.source_deletion import delete_source_cascade
from graph_rag.core.sources import create_source, ensure_default_private_source, get_manageable_source, get_readable_source, list_readable_sources, update_source
from graph_rag.core.types import UserContext
from graph_rag.http.auth import require_internal_user
from graph_rag.http.errors import raise_http_error
from graph_rag.http.serializers import to_public_source

router = APIRouter(prefix="/graph")


class CreateSourceRequest(BaseModel):
    name: str = Field(min_length=3, max_length=96)
    kind: str = Field(default="private", pattern="^(private|public)$")
    description: str = Field(default="", max_length=1000)


class UpdateSourceRequest(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=96)
    description: str | None = Field(default=None, max_length=1000)
    schema_profile_id: str | None = Field(default=None)


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
        if body.schema_profile_id is not None:
            # P1: entity_schema 接线 — 权限校验后,在 workspace 冷启动锁内原子地「改绑定+清 LightRAG 实例缓存」,
            # 与 get_lightrag 冷启动互斥,防止 in-flight 冷启动写回旧 addon_params 实例(codex P1 复审并发竞态)。
            # 空串→解绑落 generic;get_lightrag 命中缓存直接返回、addon_params 仅冷启动注入,故改绑必须清缓存。
            managed = await get_manageable_source(user, source_id)
            await set_schema_profile_and_forget(managed.workspace, source_id, body.schema_profile_id or None)
        source = await update_source(user, source_id, name=body.name, description=body.description)
        return {"source": to_public_source(source)}
    except Exception as error:
        raise_http_error(error)


@router.delete("/sources/{source_id}")
async def delete_source_route(source_id: str, user: UserContext = Depends(require_internal_user)) -> dict:
    """级联删除 Neo4j workspace、LightRAG PG 行和 source 业务行。仅 admin/owner。"""
    try:
        await delete_source_cascade(user, source_id)
        return {"deleted": True, "source_id": source_id}
    except Exception as error:
        raise_http_error(error)
