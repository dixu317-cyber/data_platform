"""013 · GraphRAG 治理(curation)写路径 T0:手动建实体 / 建关系、编辑生效、批量删除
部分成功、导出、weight 分层。

验收哲学(spec §1/§9/§12):治理的"完整"不是"保存成功",而是**真调 LightRAG 原语后从图
存储读回验证变化**(编辑生效非回显)。故每个增 / 改写操作都在写后 `get_entity_info` /
`get_relation_info` 读回,把读回值(而非请求回显)当返回真相。

- manageable(admin / owner)权限把关:member 对不可管理的 source → 403(复用 006 范式)。
- 建关系端点存在校验由 LightRAG `acreate_relation` 在 upsert **之前** raise 兜底 → 端点缺失
  绝不产生幽灵实体节点。
- 批量删除:M/N 部分成功,单条失败不连坐整批,失败项进汇总;批量作为**一条**审计事件。
- weight 分层阈值一律**具名常量**(反 Replace Magic Literal / FR-343);检索侧不硬过滤
  (owner=011),此处只做治理台侧排序 / 标灰 / 分档投影。
"""

from __future__ import annotations

import os
import tempfile

from graph_rag.core.errors import GraphRagError
from graph_rag.core.lightrag_service import get_lightrag
from graph_rag.core.source_operation import guard_source_graph_operation
from graph_rag.core.sources import get_manageable_source
from graph_rag.core.types import UserContext

# ── 具名常量(FR-343 / spec §13:禁散落魔法数字面量作阈值)─────────────────────────
# ⚠ weight 分层阈值默认值 spec §13 标"待校准"(LightRAG 抽取 weight 分布未取样),此处为占位,
#   待 012 真实建图分布校准后由编排者定值。检索侧是否按 weight 硬过滤 owner=011,013 不定义。
HIGH_CONFIDENCE_WEIGHT_THRESHOLD = 0.7
LOW_CONFIDENCE_WEIGHT_THRESHOLD = 0.3
DEFAULT_RELATION_WEIGHT = 1.0

CONFIDENCE_TIER_HIGH = "high"
CONFIDENCE_TIER_MEDIUM = "medium"
CONFIDENCE_TIER_LOW = "low"

# 导出格式 → 临时文件扩展名。
_EXPORT_EXTENSIONS = {"csv": "csv", "excel": "xlsx", "md": "md", "txt": "txt"}


def _coerce_weight(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return DEFAULT_RELATION_WEIGHT


def confidence_tier(weight: float) -> str:
    """高 / 中 / 低三档分层——阈值全具名常量(魔法数字面量作阈值命中=0)。"""
    if weight >= HIGH_CONFIDENCE_WEIGHT_THRESHOLD:
        return CONFIDENCE_TIER_HIGH
    if weight >= LOW_CONFIDENCE_WEIGHT_THRESHOLD:
        return CONFIDENCE_TIER_MEDIUM
    return CONFIDENCE_TIER_LOW


def apply_weight_layering(relations: list[dict]) -> list[dict]:
    """治理台侧 weight 分层:①默认按 weight 降序;②低置信(< 具名阈值)标 `low_confidence`;
    ③高 / 中 / 低分档 `confidence_tier`。就地改写并返回同一 list。"""
    for relation in relations:
        weight = _coerce_weight(relation.get("weight"))
        relation["weight"] = weight
        relation["confidence_tier"] = confidence_tier(weight)
        relation["low_confidence"] = weight < LOW_CONFIDENCE_WEIGHT_THRESHOLD
    relations.sort(key=lambda r: _coerce_weight(r.get("weight")), reverse=True)
    return relations


@guard_source_graph_operation("source_id")
async def create_entity(user: UserContext, source_id: str, entity_name: str, data: dict) -> dict:
    """手动建实体:类型必填校验 → 真调 `acreate_entity` → 从图读回 type/description(非回显)。"""
    data = data or {}
    entity_type = data.get("entity_type")
    if not entity_type or not str(entity_type).strip():
        # 类型必填:缺 entity_type → 明确错误,不静默建 UNKNOWN 空类型实体。
        raise GraphRagError("entity_type 必填,不可创建空类型实体", "invalid_input")
    name = (entity_name or "").strip()
    if not name:
        raise GraphRagError("entity_name 必填", "invalid_input")

    source = await get_manageable_source(user, source_id)  # member → forbidden(403)
    rag = await get_lightrag(source)
    entity_data = {
        "entity_type": str(entity_type).strip(),
        "description": (data.get("description") or "").strip(),
    }
    try:
        await rag.acreate_entity(name, entity_data)
    except ValueError as exc:
        raise GraphRagError(str(exc), "invalid_input") from exc

    info = await rag.get_entity_info(name)
    graph_data = info.get("graph_data") or {}
    return {
        "ok": True,
        "entity": name,
        "entity_type": graph_data.get("entity_type"),
        "description": graph_data.get("description"),
        "audit": {"action": "建实体", "source_id": source.id, "target": name},
    }


@guard_source_graph_operation("source_id")
async def create_relation(user: UserContext, source_id: str, src: str, target: str, data: dict) -> dict:
    """手动建关系:端点存在校验(缺失 → 明确错误无幽灵实体)→ 真调 `acreate_relation` →
    从图读回 description/weight(非回显);未指定 weight → 默认 1.0。"""
    data = data or {}
    source = await get_manageable_source(user, source_id)
    rag = await get_lightrag(source)
    relation_data: dict[str, object] = {
        "description": (data.get("description") or "").strip(),
        "keywords": (data.get("keywords") or "").strip(),
    }
    if data.get("weight") is not None:
        relation_data["weight"] = _coerce_weight(data.get("weight"))
    # 端点存在校验:acreate_relation 在 upsert 之前 has_node 检查并 raise ValueError
    # ("Source/Target entity ... does not exist")→ 不产生幽灵实体节点。转明确错误。
    try:
        await rag.acreate_relation(src, target, relation_data)
    except ValueError as exc:
        raise GraphRagError(str(exc), "invalid_input") from exc

    info = await rag.get_relation_info(src, target)
    graph_data = info.get("graph_data") or {}
    return {
        "ok": True,
        "source": src,
        "target": target,
        "description": graph_data.get("description"),
        "weight": _coerce_weight(graph_data.get("weight")),
        "audit": {"action": "建关系", "source_id": source.id, "target": f"{src}→{target}"},
    }


@guard_source_graph_operation("source_id")
async def edit_relation(user: UserContext, source_id: str, src: str, target: str, updated_data: dict) -> dict:
    """编辑关系:先读回(不存在 → 明确错误不静默)→ 真调 `aedit_relation` → 再读回验证变化
    (改前 != 改后,编辑生效非回显)。"""
    source = await get_manageable_source(user, source_id)
    rag = await get_lightrag(source)
    before = await rag.get_relation_info(src, target)
    if not before.get("graph_data"):
        raise GraphRagError(f"关系不存在:{src}→{target}", "not_found")

    payload = dict(updated_data or {})
    if payload.get("weight") is not None:
        payload["weight"] = _coerce_weight(payload.get("weight"))
    await rag.aedit_relation(source_entity=src, target_entity=target, updated_data=payload)

    after = await rag.get_relation_info(src, target)
    graph_data = after.get("graph_data") or {}
    return {
        "ok": True,
        "source": src,
        "target": target,
        "description": graph_data.get("description"),
        "weight": _coerce_weight(graph_data.get("weight")),
        "audit": {"action": "编辑关系", "source_id": source.id, "target": f"{src}→{target}"},
    }


@guard_source_graph_operation("source_id")
async def edit_entity(user: UserContext, source_id: str, entity_name: str, updated_data: dict) -> dict:
    """编辑实体:先读回(不存在 / 已被并发删除 → 明确"实体不存在"错误不静默)→ 真调
    `aedit_entity` → 再读回验证变化(后写生效)。"""
    source = await get_manageable_source(user, source_id)
    rag = await get_lightrag(source)
    before = await rag.get_entity_info(entity_name)
    if not before.get("graph_data"):
        raise GraphRagError(f"实体不存在:{entity_name}", "not_found")

    await rag.aedit_entity(
        entity_name=entity_name,
        updated_data=dict(updated_data or {}),
        allow_rename=False,
    )
    after = await rag.get_entity_info(entity_name)
    graph_data = after.get("graph_data") or {}
    return {
        "ok": True,
        "entity": entity_name,
        "entity_type": graph_data.get("entity_type"),
        "description": graph_data.get("description"),
        "audit": {"action": "编辑实体", "source_id": source.id, "target": entity_name},
    }


@guard_source_graph_operation("source_id")
async def batch_delete_entities(user: UserContext, source_id: str, entity_names: list[str]) -> dict:
    """批量删除实体:M/N 部分成功——单条失败(如已被并发删除 / 不存在)进汇总、不连坐其余项、
    不整批回滚、不静默丢;批量作为**一条**审计事件(含 M/N 计数)。"""
    source = await get_manageable_source(user, source_id)
    rag = await get_lightrag(source)

    deleted: list[str] = []
    failures: list[dict] = []
    for name in entity_names:
        try:
            info = await rag.get_entity_info(name)
            if not info.get("graph_data"):
                failures.append({"entity": name, "reason": "实体不存在"})
                continue
            await rag.adelete_by_entity(name)
            deleted.append(name)
        except Exception as exc:  # 单条失败不连坐:记入汇总,继续处理其余项。
            failures.append({"entity": name, "reason": str(exc) or type(exc).__name__})

    summary = {
        "action": "批量删除实体",
        "source_id": source.id,
        "total": len(entity_names),
        "success_count": len(deleted),
        "failure_count": len(failures),
        "deleted": deleted,
        "failures": failures,
    }
    # 批量一条审计事件:audit 是单个 dict(非 N 条),含操作项清单 + 成功/失败计数。
    return {"ok": True, **summary, "audit": summary}


def _render_export(detail: dict) -> str:
    """从真图读回(实体 + 关系)渲染导出文本,含 Entities / Relations 两部分。
    空图谱仍写两区块表头 → 字节 present、不报错。"""
    lines = ["# 图谱导出 · GraphRAG Data Export", "", "## Entities", ""]
    lines.append("| name | type | description |")
    lines.append("| --- | --- | --- |")
    for entity in detail.get("entities", []):
        lines.append(f"| {entity.get('name', '')} | {entity.get('type', '')} | {entity.get('description', '')} |")
    lines += ["", "## Relations", ""]
    lines.append("| source | target | weight | description |")
    lines.append("| --- | --- | --- | --- |")
    for relation in detail.get("relations", []):
        lines.append(
            f"| {relation.get('source', '')} | {relation.get('target', '')} | "
            f"{relation.get('weight', '')} | {relation.get('description', '')} |"
        )
    return "\n".join(lines) + "\n"


async def export_graph(user: UserContext, source_id: str, fmt: str = "md") -> dict:
    """导出图谱:manageable 把关(member → 403)→ 从图**读回**实体 + 关系(真改图读回口径)→
    渲染导出文本 → 写临时文件 → 读回字节 → 用后即删。admin 得非空字节(含实体 + 关系两部分);
    空图谱导出合法(不报错,写两区块表头)。

    注:LightRAG 库 `aexport_data` 依赖 `relationships_vdb.client_storage`(仅 NanoVectorDB 有),
    与本项目 PGVectorStorage 不兼容,故不走库导出,改从真图读回自渲染(不失真改图读回哲学)。
    """
    if fmt not in _EXPORT_EXTENSIONS:
        raise GraphRagError(f"不支持的导出格式:{fmt}", "invalid_input")
    source = await get_manageable_source(user, source_id)  # member → forbidden(403)

    from graph_rag.core import graph_curation  # 惰性导入避免与 curation 循环依赖。

    # 导出需**全量**实体 + 关系:走 _load_full_graph(不经分页切片,否则只导出第 1 页 → 丢数据)。
    _source, nodes, edges, _truncated = await graph_curation._load_full_graph(user, source_id)
    text = _render_export({"entities": nodes, "relations": edges})

    ext = _EXPORT_EXTENSIONS[fmt]
    handle, path = tempfile.mkstemp(suffix=f".{ext}", prefix="graph_export_")
    os.close(handle)
    try:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        with open(path, "rb") as fh:
            content = fh.read()
    finally:
        if os.path.exists(path):  # 临时文件用后即删(残留=0)。
            os.remove(path)

    return {
        "ok": True,
        "filename": f"graph-{source.id}.{ext}",
        "format": fmt,
        "content": content,
        "audit": {"action": "导出图谱", "source_id": source.id, "target": fmt},
    }
