"""013 · GraphRAG 画像 T3 簇:实体画像聚合端点 + role 双投影 + 三降级态。

验收哲学(spec §5 / §7.3 / FR-351/353/354,考卷 AM-1310/1311):

- **数据契约(五区块 A-E)**:同一 `build_portrait` 端点真调 `get_entity_info`
  (实体属性)+ `get_knowledge_graph(node_label=entity, max_depth=1)`(邻域子图)读真图,
  聚合成五区块——A 概览 / B 属性(`entity{name,type,description,aliases[],sources[]}`)、
  C 邻域子图(`neighborhood{nodes[],edges[],is_truncated,collapsed}`)、D 关系列表
  (`relations[]`,三元组 + 置信度)、E 证据与来源锚点(`evidence[]`)。
- **role 投影分明(FR-353,双投影心脏)**:同一实体、同一端点,按 `user.is_admin` 分叉——
  **admin** 保留 `weight` 裸值 + 治理句柄(编辑 / 删除 handle)+ neighborhood 默认展开
  (`collapsed=False`);**member** 移除**所有** `weight` 裸值键(替换为 `confidence:
  high|medium|low`,分级阈值复用 T0 具名常量 `confidence_tier`)+ 移除治理句柄 +
  `neighborhood.collapsed=True`(§8.5 不强塞图)。用户心智:管理员看得到 0.87 权重和编辑
  按钮;终端用户只看到"关系很紧密"和溯源,看不到裸参数、动不了图谱。
- **三降级态**:①孤立实体(无邻域)→ 显式空态(`neighborhood.nodes` 仅中心 / 空邻域)
  **不报错**;②UNKNOWN 类型 → `type_label` 兜底"未分类"(接 012);③实体不存在 → 明确
  `not_found`(端点 404)。
- **权限**:复用 006 `get_readable_source` 把关——member 对不可读(他人 private)source
  的实体请求 → 403(越权泄露=0);member 对可读 source(public / 自己 private)可读。

存疑(见回报 #3):画像 D 关系列表 / E 证据依赖 011 结构化 `relations`/`references`/`chunks`
出参。011 结构化检索链落地前,D/E 用 `get_knowledge_graph` 邻域三元组 + `get_entity_info`
来源锚点**兜底**,`degraded=True` 标记;契约字段恒 present(占位不崩),011 落地后占位→真值
(契约零变更)。AM-1310 断"契约字段 present + 占位不崩",不断 011 真检索增益。
"""

from __future__ import annotations

from graph_rag.core.curation import confidence_tier
from graph_rag.core.errors import GraphRagError
from graph_rag.core.lightrag_service import get_lightrag
from graph_rag.core.source_operation import guard_source_graph_operation
from graph_rag.core.sources import get_readable_source
from graph_rag.core.types import UserContext

# ── 具名常量(反 Replace Magic Literal:禁散落魔法数)────────────────────────────────
# 画像邻域取数深度:1 跳邻域(中心实体 + 直接邻居),与子图下钻(AM-1317)复用同一路径。
NEIGHBORHOOD_MAX_DEPTH = 1
# 邻域取数上限(防大图平铺;分页 / 硬上限归 T5 AM-1316,此处仅画像邻域裁剪)。
NEIGHBORHOOD_MAX_NODES = 50

# UNKNOWN 类型 badge 兜底展示文案(接 012;实体类型缺失 / 未分类时的显式空态)。
UNKNOWN_ENTITY_TYPE = "UNKNOWN"
UNCLASSIFIED_TYPE_LABEL = "未分类"

# LightRAG 图字段多值分隔符(file_path / source_id 多来源用它拼接)。
_GRAPH_FIELD_SEP = "<SEP>"

# role 标识(投影分叉出参标注,供前端 T4 消费对齐)。
ROLE_ADMIN = "admin"
ROLE_MEMBER = "member"


def _split_multi(value) -> list[str]:
    """把 LightRAG 多值字段(`a<SEP>b`)拆成去重有序列表。"""
    if not value:
        return []
    parts = [p.strip() for p in str(value).split(_GRAPH_FIELD_SEP)]
    seen: list[str] = []
    for part in parts:
        if part and part not in seen:
            seen.append(part)
    return seen


def _type_label(entity_type: str | None) -> str:
    """UNKNOWN / 空类型 → 兜底"未分类"(接 012 type badge),否则原样。"""
    if not entity_type or str(entity_type).strip().upper() == UNKNOWN_ENTITY_TYPE:
        return UNCLASSIFIED_TYPE_LABEL
    return str(entity_type)


def _node_to_dict(node) -> dict:
    props = getattr(node, "properties", None) or {}
    return {
        "id": getattr(node, "id", None),
        "name": props.get("entity_id") or props.get("entity_name") or getattr(node, "id", None),
        "type": props.get("entity_type") or UNKNOWN_ENTITY_TYPE,
        "type_label": _type_label(props.get("entity_type")),
        "description": props.get("description") or "",
    }


def _edge_to_dict(edge) -> dict:
    props = getattr(edge, "properties", None) or {}
    weight = props.get("weight")
    try:
        weight = float(weight) if weight is not None else None
    except (TypeError, ValueError):
        weight = None
    return {
        "id": getattr(edge, "id", None),
        "source": getattr(edge, "source", None),
        "target": getattr(edge, "target", None),
        "description": props.get("description") or props.get("keywords") or "",
        "keywords": props.get("keywords") or "",
        "weight": weight,
    }


@guard_source_graph_operation("source_id")
async def build_portrait(user: UserContext, source_id: str, entity_name: str) -> dict:
    """聚合某实体的画像(五区块 A-E)并按 `user.is_admin` 做 role 投影。

    - 权限:`get_readable_source` 把关(member 对他人 private source → 403)。
    - 实体不存在:`get_entity_info` 无 graph_data → `GraphRagError(not_found)`(端点 404)。
    - 孤立实体:邻域空 → 显式空态不报错。
    - UNKNOWN 类型:`type_label` 兜底"未分类"。
    """
    name = (entity_name or "").strip()
    if not name:
        raise GraphRagError("entity_name 必填", "invalid_input")

    source = await get_readable_source(user, source_id)  # member 对不可读 source → forbidden(403)
    rag = await get_lightrag(source)

    # ── Block A/B:实体概览 + 属性(get_entity_info 读真图)────────────────────────────
    info = await rag.get_entity_info(name)
    graph_data = info.get("graph_data")
    if not graph_data:
        # 实体不存在 → 明确 not_found(端点 404 明确文案),非静默空画像。
        raise GraphRagError(f"实体不存在:{name}", "not_found")

    raw_type = graph_data.get("entity_type")
    sources = _split_multi(graph_data.get("file_path")) or _split_multi(graph_data.get("source_id"))
    entity_block = {
        "name": name,
        "type": raw_type or UNKNOWN_ENTITY_TYPE,
        "type_label": _type_label(raw_type),  # UNKNOWN → "未分类"
        "description": graph_data.get("description") or "",
        "aliases": _split_multi(graph_data.get("aliases")),  # 011 落地前占位(LightRAG 无原生别名)
        "sources": sources,
    }

    # ── Block C:邻域子图(get_knowledge_graph max_depth=1 读真图)──────────────────────
    kg = await rag.get_knowledge_graph(
        node_label=name, max_depth=NEIGHBORHOOD_MAX_DEPTH, max_nodes=NEIGHBORHOOD_MAX_NODES
    )
    raw_nodes = getattr(kg, "nodes", None) or []
    raw_edges = getattr(kg, "edges", None) or []
    nodes = [_node_to_dict(n) for n in raw_nodes]
    # AGE edge.source/target 是内部节点 id;映射回实体名,画像才可读。
    id_to_name = {n["id"]: n["name"] for n in nodes if n.get("id") is not None}
    edges: list[dict] = []
    for raw_edge in raw_edges:
        edge = _edge_to_dict(raw_edge)
        edge["source"] = id_to_name.get(edge["source"], edge["source"])
        edge["target"] = id_to_name.get(edge["target"], edge["target"])
        edges.append(edge)

    neighborhood = {
        "nodes": nodes,
        "edges": edges,
        "is_truncated": bool(getattr(kg, "is_truncated", False)),
        # 孤立实体(无邻居)→ 显式空态标记(前端渲染"暂无关联关系"),不报错。
        "is_isolated": len(edges) == 0,
        # collapsed 由 role 投影覆写(admin 展开 / member 折叠)。
        "collapsed": False,
    }

    # ── Block D:关系列表(011 投影,落地前用邻域三元组兜底,degraded)────────────────────
    relations = [
        {
            "source": e["source"],
            "target": e["target"],
            "description": e["description"],
            "weight": e["weight"],
        }
        for e in edges
    ]

    # ── Block E:证据与来源锚点(011 references/chunks 投影,落地前用来源锚点兜底,degraded)──
    evidence = [{"source_anchor": anchor, "kind": "source"} for anchor in entity_block["sources"]]

    portrait = {
        "source_id": source.id,
        "source_name": source.name,
        "entity": entity_block,        # A/B 概览 + 属性
        "neighborhood": neighborhood,  # C 邻域子图
        "relations": relations,        # D 关系列表(011 投影占位)
        "evidence": evidence,          # E 证据与来源锚点(011 投影占位)
        # 011 结构化检索链未落地 → D/E 用图兜底,标 degraded(契约字段恒 present,占位不崩)。
        "degraded": True,
        "role": ROLE_ADMIN if user.is_admin else ROLE_MEMBER,
    }

    if user.is_admin:
        return _project_admin(portrait, source.id)
    return _project_member(portrait)


def _governance_handle(source_id: str, src: str, target: str) -> dict:
    """治理句柄(编辑 / 删除入口标识):admin 投影专属,member 无。"""
    return {
        "can_edit": True,
        "can_delete": True,
        "edit_handle": "/graph/curation/relations/edit",
        "delete_handle": "/graph/curation/relations/delete",
        "source_id": source_id,
        "source": src,
        "target": target,
    }


def _project_admin(portrait: dict, source_id: str) -> dict:
    """admin 投影:保留 weight 裸值 + 治理句柄 + neighborhood 展开(collapsed=False)。"""
    portrait["neighborhood"]["collapsed"] = False
    for edge in portrait["neighborhood"]["edges"]:
        edge["governance"] = _governance_handle(source_id, edge["source"], edge["target"])
    for relation in portrait["relations"]:
        relation["governance"] = _governance_handle(source_id, relation["source"], relation["target"])
    return portrait


def _demote_weight(item: dict) -> None:
    """member 投影:移除 weight 裸值键 → 替换为 confidence 分级(复用 T0 具名阈值)。"""
    weight = item.pop("weight", None)
    item.pop("governance", None)  # 治理句柄不外泄给 member
    # weight 缺失(011 占位 None)→ 视为默认满权(与 T0 create_relation 默认 1.0 一致)。
    item["confidence"] = confidence_tier(float(weight) if weight is not None else 1.0)


def _project_member(portrait: dict) -> dict:
    """member 投影:移除**所有** weight 裸值键(confidence 分级替代)+ 无治理句柄 +
    neighborhood 折叠(collapsed=True,不强塞图)。"""
    portrait["neighborhood"]["collapsed"] = True
    for edge in portrait["neighborhood"]["edges"]:
        _demote_weight(edge)
    for relation in portrait["relations"]:
        _demote_weight(relation)
    return portrait
