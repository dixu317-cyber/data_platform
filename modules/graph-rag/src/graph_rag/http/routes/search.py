import asyncio

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

import base64

from graph_rag.core.search import ask, search
from graph_rag.core.graph_stats import graph_stats
from graph_rag.core import graph_curation
from graph_rag.core import curation
from graph_rag.core import entity_portrait
from graph_rag.core.types import UserContext
from graph_rag.http.auth import require_internal_user
from graph_rag.http.errors import raise_http_error

router = APIRouter(prefix="/graph")


class QueryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=10, ge=1, le=30)
    source_id: str | None = None
    # 011 FR-310：允许 auto(编排层不再写死 mix,交模块按问题路由 / admin 旋钮判决)。
    mode: str = Field(default="mix", pattern="^(auto|local|global|hybrid|naive|mix)$")
    # P22-P2：检索旋钮入参优先(平台 per-engine config 传入;None=落 settings/库默认)。
    chunk_top_k: int | None = Field(default=None, ge=1, le=200)
    max_total_tokens: int | None = Field(default=None, ge=1, le=100000)
    enable_rerank: bool | None = None
    # 011 T4 FR-316：多轮 passthrough(可选)——透传给 QueryParam.conversation_history 结构。
    #   仅结构 passthrough,检索增益不作 AC(spec §13-1 待探针)。
    conversation_history: list[dict] | None = None
    # 011 T4 FR-317 判决:检索端点**刻意不暴露 user_prompt**(领域指令注入生成 prompt)——
    #   该路径无生成语义,拒绝 user_prompt 注入以防提示注入。故此处**没有** user_prompt 字段。


class MergeEntitiesRequest(BaseModel):
    source_id: str = Field(min_length=1)
    source_entities: list[str] = Field(min_length=1)
    target_entity: str = Field(min_length=1)


class EditEntityRequest(BaseModel):
    source_id: str = Field(min_length=1)
    entity_name: str = Field(min_length=1)
    updated_data: dict = Field(default_factory=dict)


class EntityRequest(BaseModel):
    source_id: str = Field(min_length=1)
    entity_name: str = Field(min_length=1)


class EditRelationRequest(BaseModel):
    source_id: str = Field(min_length=1)
    source_entity: str = Field(min_length=1)
    target_entity: str = Field(min_length=1)
    updated_data: dict = Field(default_factory=dict)


class RelationRequest(BaseModel):
    source_id: str = Field(min_length=1)
    source_entity: str = Field(min_length=1)
    target_entity: str = Field(min_length=1)


class CreateEntityRequest(BaseModel):
    source_id: str = Field(min_length=1)
    entity_name: str = Field(min_length=1)
    entity_type: str = Field(min_length=1)
    description: str = Field(default="")


class CreateRelationRequest(BaseModel):
    source_id: str = Field(min_length=1)
    source_entity: str = Field(min_length=1)
    target_entity: str = Field(min_length=1)
    description: str = Field(default="")
    keywords: str = Field(default="")
    weight: float | None = None


class BatchDeleteEntitiesRequest(BaseModel):
    source_id: str = Field(min_length=1)
    entity_names: list[str] = Field(min_length=1)


class ExportGraphRequest(BaseModel):
    source_id: str = Field(min_length=1)
    format: str = Field(default="md", pattern="^(csv|excel|md|txt)$")


@router.post("/search")
async def search_route(body: QueryRequest, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        return await search(
            user, body.query, body.limit, source_id=body.source_id, mode=body.mode,
            conversation_history=body.conversation_history,
            chunk_top_k=body.chunk_top_k,
            max_total_tokens=body.max_total_tokens,
            enable_rerank=body.enable_rerank,
        )
    except Exception as error:
        raise_http_error(error)


@router.post("/ask")
async def ask_route(body: QueryRequest, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        return await ask(
            user, body.query, body.limit, source_id=body.source_id, mode=body.mode,
            conversation_history=body.conversation_history,
            chunk_top_k=body.chunk_top_k,
            max_total_tokens=body.max_total_tokens,
            enable_rerank=body.enable_rerank,
        )
    except Exception as error:
        raise_http_error(error)


@router.get("/graph-stats")
async def graph_stats_route(user: UserContext = Depends(require_internal_user)) -> dict:
    """图谱健康统计:实体/关系规模、来源、重复实体候选(curate 信号)。后台图谱型监控面板用。"""
    try:
        return await asyncio.to_thread(graph_stats, user)
    except Exception as error:
        raise_http_error(error)


@router.get("/curation/detail")
async def graph_detail_route(
    source_id: str,
    page: int = 0,
    page_size: int = graph_curation.CURATION_PAGE_SIZE,
    user: UserContext = Depends(require_internal_user),
) -> dict:
    """列出某 source 图谱的实体与关系,供 curate 工作台。

    013 T5(FR-355):分页(page/page_size)替换原 200 硬截断——page_size 具名常量
    `CURATION_PAGE_SIZE`,`has_more` 显式给"还有更多"信号,逐页可达全部实体无丢。"""
    try:
        return await graph_curation.graph_detail(user, source_id, page=page, page_size=page_size)
    except Exception as error:
        raise_http_error(error)


@router.get("/curation/subgraph")
async def graph_subgraph_route(
    source_id: str,
    entity_name: str,
    max_depth: int = graph_curation.SUBGRAPH_DEFAULT_DEPTH,
    user: UserContext = Depends(require_internal_user),
) -> dict:
    """子图下钻(FR-356):以某实体聚焦下钻,只返回其邻域局部子图(脱离全图平铺),
    `max_depth` 可调(默认 1 跳)。与画像邻域复用同一取数路径。"""
    try:
        return await graph_curation.subgraph(user, source_id, entity_name, max_depth=max_depth)
    except Exception as error:
        raise_http_error(error)


@router.post("/curation/entities/merge")
async def merge_entities_route(body: MergeEntitiesRequest, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        return await graph_curation.merge_entities(user, body.source_id, body.source_entities, body.target_entity)
    except Exception as error:
        raise_http_error(error)


@router.post("/curation/entities/edit")
async def edit_entity_route(body: EditEntityRequest, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        return await graph_curation.edit_entity(user, body.source_id, body.entity_name, body.updated_data)
    except Exception as error:
        raise_http_error(error)


@router.post("/curation/entities/delete")
async def delete_entity_route(body: EntityRequest, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        return await graph_curation.delete_entity(user, body.source_id, body.entity_name)
    except Exception as error:
        raise_http_error(error)


@router.post("/curation/relations/edit")
async def edit_relation_route(body: EditRelationRequest, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        return await graph_curation.edit_relation(user, body.source_id, body.source_entity, body.target_entity, body.updated_data)
    except Exception as error:
        raise_http_error(error)


@router.post("/curation/relations/delete")
async def delete_relation_route(body: RelationRequest, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        return await graph_curation.delete_relation(user, body.source_id, body.source_entity, body.target_entity)
    except Exception as error:
        raise_http_error(error)


# ── 013 curation 写路径补齐(建实体 / 建关系 / 批量删除 / 导出)──────────────────────────


@router.post("/curation/entities/create")
async def create_entity_route(body: CreateEntityRequest, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        return await curation.create_entity(
            user, body.source_id, body.entity_name,
            {"entity_type": body.entity_type, "description": body.description},
        )
    except Exception as error:
        raise_http_error(error)


@router.post("/curation/relations/create")
async def create_relation_route(body: CreateRelationRequest, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        return await curation.create_relation(
            user, body.source_id, body.source_entity, body.target_entity,
            {"description": body.description, "keywords": body.keywords, "weight": body.weight},
        )
    except Exception as error:
        raise_http_error(error)


@router.post("/curation/entities/batch-delete")
async def batch_delete_entities_route(body: BatchDeleteEntitiesRequest, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        return await curation.batch_delete_entities(user, body.source_id, body.entity_names)
    except Exception as error:
        raise_http_error(error)


# ── 013 T3:实体画像聚合端点(五区块 A-E + role 双投影 + 三降级态)───────────────────────


@router.get("/curation/entities/portrait")
async def entity_portrait_route(
    source_id: str, entity_name: str, user: UserContext = Depends(require_internal_user)
) -> dict:
    """实体画像:聚合 get_entity_info + get_knowledge_graph(邻域)成五区块,按 user.role 投影
    (admin weight 裸值 + 治理句柄 + 展开;member confidence 分级 + 无句柄 + 折叠)。
    实体不存在 → 404;member 对不可读 source → 403(get_readable_source 把关)。
    注:entity_name 走 query param(实体名可含 `/`,不宜作 path 段)。"""
    try:
        return await entity_portrait.build_portrait(user, source_id, entity_name)
    except Exception as error:
        raise_http_error(error)


@router.post("/curation/export")
async def export_graph_route(body: ExportGraphRequest, user: UserContext = Depends(require_internal_user)) -> dict:
    try:
        result = await curation.export_graph(user, body.source_id, body.format)
        # 二进制内容 base64 编码走 JSON 响应(下载端在编排层解码)。
        return {
            "ok": result["ok"],
            "filename": result["filename"],
            "format": result["format"],
            "content_base64": base64.b64encode(result["content"]).decode("ascii"),
            "audit": result["audit"],
        }
    except Exception as error:
        raise_http_error(error)
