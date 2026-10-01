"""图谱 curate(可编辑工作台)业务逻辑:列出、合并、编辑、删除实体与关系。

全部经 LightRAG service 真改 Neo4j 图存储，不绕过 LightRAG
直接写内部表。仅管理员可操作(由 source 的 manageable 权限把关)。
"""

from __future__ import annotations

from graph_rag.core.graph_limits import MAX_GRAPH_NODES
from graph_rag.core.lightrag_service import get_lightrag
from graph_rag.core.source_operation import guard_source_graph_operation
from graph_rag.core.sources import get_manageable_source, get_readable_source
from graph_rag.core.types import UserContext

# ── 013 T5 具名常量(反 Replace Magic Literal:禁散落魔法数作 page_size / 硬上限)──────────
# FR-355 / AM-1316:分页替换 200 硬截断——page_size 具名常量(非散落 200 字面量)。
CURATION_PAGE_SIZE = 50
# 全图取数上限:替换原先固定 200 节点的硬截断(硬上限命中=0)。设远大于单页,
# 让全部实体经分页逐页可达无丢(不再在硬上限处静默丢后续实体)。
CURATION_MAX_GRAPH_NODES = MAX_GRAPH_NODES
# 全图遍历深度(取"*" 全图时的 BFS 深度,沿用原行为)。
CURATION_GRAPH_MAX_DEPTH = 3
# FR-356 / AM-1317:子图下钻默认邻域深度(1 跳),与画像邻域(entity_portrait)复用同一路径。
SUBGRAPH_DEFAULT_DEPTH = 1
# 子图下钻邻域取数上限(局部子图,脱离全图平铺)。
SUBGRAPH_MAX_NODES = 500


def _node_to_dict(node) -> dict:
    props = getattr(node, "properties", None) or {}
    return {
        "id": getattr(node, "id", None),
        "name": props.get("entity_id") or props.get("entity_name") or getattr(node, "id", None),
        "type": props.get("entity_type") or "UNKNOWN",
        "description": props.get("description") or "",
        "source": props.get("file_path") or props.get("source_id") or "",
    }


def _edge_to_dict(edge) -> dict:
    props = getattr(edge, "properties", None) or {}
    return {
        "id": getattr(edge, "id", None),
        "source": getattr(edge, "source", None),
        "target": getattr(edge, "target", None),
        "description": props.get("description") or props.get("keywords") or "",
        "weight": props.get("weight"),
    }


@guard_source_graph_operation("source_id")
async def _load_full_graph(user: UserContext, source_id: str):
    """读某 source 全图(实体 + 关系),经 weight 分层后返回 (source, nodes, edges, truncated)。

    全图取数上限用具名常量 `CURATION_MAX_GRAPH_NODES`(替换原先固定节点数硬截断)——不在中途静默丢
    实体,全部由上层分页逐页可达。导出(全量)与分页(逐页切片)共用此内部读取路径。
    """
    source = await get_readable_source(user, source_id)
    rag = await get_lightrag(source)
    graph = await rag.get_knowledge_graph(
        node_label="*", max_depth=CURATION_GRAPH_MAX_DEPTH, max_nodes=CURATION_MAX_GRAPH_NODES
    )
    raw_nodes = getattr(graph, "nodes", None) or []
    nodes = [_node_to_dict(n) for n in raw_nodes]
    # AGE 返回的 edge.source/target 是内部节点 id;映射回实体名,UI 才看得懂(用全图节点建映射)。
    id_to_name = {n["id"]: n["name"] for n in nodes if n.get("id") is not None}
    edges = []
    for e in (getattr(graph, "edges", None) or []):
        d = _edge_to_dict(e)
        d["source"] = id_to_name.get(d["source"], d["source"])
        d["target"] = id_to_name.get(d["target"], d["target"])
        edges.append(d)
    nodes.sort(key=lambda n: (n["name"] or "").lower())
    # 013 AM-1306(FR-343 / AC-6):治理台侧 weight 分层——默认按 weight 降序 + 低置信具名阈值
    # 标 low_confidence + 高/中/低分档。阈值全具名常量(禁散落魔法数);检索侧不硬过滤(owner=011)。
    from graph_rag.core.curation import apply_weight_layering
    apply_weight_layering(edges)
    return source, nodes, edges, bool(getattr(graph, "is_truncated", False))


async def graph_detail(
    user: UserContext,
    source_id: str,
    *,
    page: int = 0,
    page_size: int = CURATION_PAGE_SIZE,
) -> dict:
    """列出某 source 图谱内的实体与关系,供 curate 工作台展示与编辑。

    013 T5(FR-355 / AM-1316):**分页替换 200 硬截断**——实体按 `page`/`page_size` 切片,
    `has_more` 显式给出"还有更多"信号(不再在 200 处终点静默丢);逐页拉取覆盖全部实体无丢。
    `page_size` 为具名常量 `CURATION_PAGE_SIZE`(禁散落魔法数)。关系不分页(随全图返回,
    供治理台按 weight 分层展示,AM-1306)。
    """
    if page < 0:
        page = 0
    if page_size <= 0:
        page_size = CURATION_PAGE_SIZE
    source, nodes, edges, truncated = await _load_full_graph(user, source_id)

    total_entities = len(nodes)
    start = page * page_size
    page_nodes = nodes[start:start + page_size]
    has_more = start + page_size < total_entities

    return {
        "source_id": source.id,
        "source_name": source.name,
        "entities": page_nodes,
        "relations": edges,
        "entity_count": len(page_nodes),
        "total_entities": total_entities,
        "relation_count": len(edges),
        "page": page,
        "page_size": page_size,
        "has_more": has_more,
        # 兼容旧字段:分页态下"截断"= 还有更多页(不再是不可达的硬截断)。
        "truncated": truncated or has_more,
    }


@guard_source_graph_operation("source_id")
async def subgraph(
    user: UserContext,
    source_id: str,
    entity_name: str,
    *,
    max_depth: int = SUBGRAPH_DEFAULT_DEPTH,
) -> dict:
    """子图下钻(FR-356 / AM-1317):以某实体"聚焦"下钻,只返回其邻域局部子图(脱离全图平铺)。

    走 `get_knowledge_graph(node_label=entity, max_depth=可配)`——返回节点数 < 全图 N(只邻域),
    含该中心实体及其邻居;`max_depth` 可调(默认 1 跳),深度越大邻域越宽。与画像邻域
    (entity_portrait)复用同一取数路径。
    """
    name = (entity_name or "").strip()
    if not name:
        from graph_rag.core.errors import GraphRagError
        raise GraphRagError("entity_name 必填", "invalid_input")
    if max_depth < 1:
        max_depth = SUBGRAPH_DEFAULT_DEPTH

    source = await get_readable_source(user, source_id)
    rag = await get_lightrag(source)
    kg = await rag.get_knowledge_graph(
        node_label=name, max_depth=max_depth, max_nodes=SUBGRAPH_MAX_NODES
    )
    raw_nodes = getattr(kg, "nodes", None) or []
    nodes = [_node_to_dict(n) for n in raw_nodes]
    id_to_name = {n["id"]: n["name"] for n in nodes if n.get("id") is not None}
    edges = []
    for e in (getattr(kg, "edges", None) or []):
        d = _edge_to_dict(e)
        d["source"] = id_to_name.get(d["source"], d["source"])
        d["target"] = id_to_name.get(d["target"], d["target"])
        edges.append(d)

    return {
        "source_id": source.id,
        "source_name": source.name,
        "center": name,
        "max_depth": max_depth,
        "nodes": nodes,
        "edges": edges,
        "node_count": len(nodes),
        "edge_count": len(edges),
        "is_truncated": bool(getattr(kg, "is_truncated", False)),
    }


@guard_source_graph_operation("source_id")
async def merge_entities(user: UserContext, source_id: str, source_entities: list[str], target_entity: str) -> dict:
    """把多个实体合并成一个(典型:把抽取碎片/中英别名合并)。真改图谱。"""
    source = await get_manageable_source(user, source_id)
    rag = await get_lightrag(source)
    result = await rag.amerge_entities(source_entities=source_entities, target_entity=target_entity)
    return {"ok": True, "target": target_entity, "merged": source_entities, "result": _safe(result)}


@guard_source_graph_operation("source_id")
async def edit_entity(user: UserContext, source_id: str, entity_name: str, updated_data: dict) -> dict:
    """编辑实体名称/类型/描述。真改图谱。"""
    source = await get_manageable_source(user, source_id)
    rag = await get_lightrag(source)
    result = await rag.aedit_entity(entity_name=entity_name, updated_data=updated_data, allow_rename=True)
    return {"ok": True, "entity": entity_name, "result": _safe(result)}


@guard_source_graph_operation("source_id")
async def delete_entity(user: UserContext, source_id: str, entity_name: str) -> dict:
    """删除实体(及其关联关系)。真改图谱。"""
    source = await get_manageable_source(user, source_id)
    rag = await get_lightrag(source)
    result = await rag.adelete_by_entity(entity_name)
    return {"ok": True, "entity": entity_name, "result": _safe(result)}


@guard_source_graph_operation("source_id")
async def edit_relation(user: UserContext, source_id: str, src: str, target: str, updated_data: dict) -> dict:
    source = await get_manageable_source(user, source_id)
    rag = await get_lightrag(source)
    result = await rag.aedit_relation(source_entity=src, target_entity=target, updated_data=updated_data)
    return {"ok": True, "source": src, "target": target, "result": _safe(result)}


@guard_source_graph_operation("source_id")
async def delete_relation(user: UserContext, source_id: str, src: str, target: str) -> dict:
    source = await get_manageable_source(user, source_id)
    rag = await get_lightrag(source)
    result = await rag.adelete_by_relation(src, target)
    return {"ok": True, "source": src, "target": target, "result": _safe(result)}


def _safe(result) -> dict:
    """LightRAG 返回 dict 或 DeletionResult,统一成可序列化 dict,且不外泄内部异常细节。"""
    if isinstance(result, dict):
        return {k: v for k, v in result.items() if isinstance(v, (str, int, float, bool, list)) or v is None}
    status = getattr(result, "status", None)
    message = getattr(result, "message", None)
    return {"status": str(status) if status is not None else "ok", "message": str(message) if message else ""}
