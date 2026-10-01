"""013 · GraphRAG 治理 · T6 簇:抽取复核工作流(FR-421)。

验收哲学(spec §9.5 / AC-增2 / AM-1321,绑定 001 状态即证据):**状态即证据**——
复核开启的 source,LLM 抽取的新实体 / 关系进 `pending_review` 态**而非直接入图**;
pending 未 approved = **未入图**,故检索侧不可见(命中=0);approved 才真入图、可命中;
rejected 永不入图 + 留审计。

状态机:`extracted → pending_review → {approved | rejected}`。

**pending 不被检索命中怎么做到的(最小侵入,零 011 回归)**:pending 项存 `graph_extraction_review`
待审队列表,**根本不写进 LightRAG 图存储**。检索(011/004)读的是图存储 → pending 不在图里 →
天然命中=0。**无需改 011 检索侧 filter**,不碰入图-检索边界(回报编排者存疑 #4 的落地取舍:
选"pending 存队列外挂、approve 才入图"而非"入图后打 pending 标 + 检索侧排除",后者要侵入 011)。

**复核开关默认关 = 零回归**:`is_review_enabled` 默认 False;`submit_extraction` 复核关时
直接 `ainsert_custom_kg` 入图(= 现有入图行为),开时才进待审队列。本模块**纯新增**,现有
ingest 路径(documents.py / csv_kg.py)不改动 → 现有入图行为逐字不变。

存储载体(回报编排者存疑 #2/#4):专表 `graph_extraction_review`(per-item status 队列比
metadata JSONB 更贴队列语义);AM-1321 按**行为**(pending 不入图 / approved 可读回 /
rejected 永不入图 / 幂等)断言,不绑存储路径。
"""

from __future__ import annotations

import json
from uuid import uuid4

from graph_rag.core.errors import GraphRagError
from graph_rag.core.lightrag_service import get_lightrag
from graph_rag.core.source_operation import guard_source_graph_operation
from graph_rag.core.sources import get_manageable_source, get_readable_source
from graph_rag.core.types import UserContext
from graph_rag.db import get_connection

# ── 状态机常量(禁散落魔法串)──────────────────────────────────────────────────────────
REVIEW_STATE_EXTRACTED = "extracted"        # 抽取产出(入队前的逻辑态)。
REVIEW_STATUS_PENDING = "pending_review"    # 待审(未入图 → 检索命中=0)。
REVIEW_STATUS_APPROVED = "approved"         # 已审通过(真入图 → 可命中)。
REVIEW_STATUS_REJECTED = "rejected"         # 已驳回(永不入图 + 留审计)。

REVIEW_ITEM_ENTITY = "entity"
REVIEW_ITEM_RELATION = "relation"

# 复核开关持久化载体键(graph_sources.metadata JSONB;默认缺失 = False = 零回归)。
_REVIEW_ENABLED_METADATA_KEY = "extraction_review_enabled"

# 复核直灌种子锚点(复核关 = 直接入图路径的 chunk 锚点)。
_REVIEW_CHUNK_SOURCE_ID = "review#0"
_REVIEW_CHUNK_FILE_PATH = "review.md"
_DEFAULT_ENTITY_TYPE = "UNKNOWN"
_DEFAULT_RELATION_WEIGHT = 1.0


# ── 复核开关(per-source,默认关 = 零回归)───────────────────────────────────────────────


def is_review_enabled(source_id: str) -> bool:
    """该 source 是否开启抽取复核。**默认关**(metadata 无该键 → False → 直接入图,零回归)。"""
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT COALESCE(metadata->>%s, 'false') AS v FROM public.graph_sources "
                "WHERE id = %s AND delete_state = 'active'",
                (_REVIEW_ENABLED_METADATA_KEY, source_id),
            )
            row = cursor.fetchone()
    if not row:
        return False
    return str(row.get("v")).strip().lower() == "true"


@guard_source_graph_operation("source_id")
async def set_review_enabled(user: UserContext, source_id: str, enabled: bool) -> dict:
    """开 / 关某 source 的抽取复核(manageable 把关,member → 403)。"""
    source = await get_manageable_source(user, source_id)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE public.graph_sources SET metadata = "
                "jsonb_set(COALESCE(metadata, '{}'::jsonb), %s, %s::jsonb), updated_at = now() "
                "WHERE id = %s AND delete_state = 'active'",
                ("{" + _REVIEW_ENABLED_METADATA_KEY + "}", json.dumps(bool(enabled)), source.id),
            )
            if cursor.rowcount != 1:
                raise GraphRagError("source 正在删除或删除失败，当前不可用", "source_unavailable")
        connection.commit()
    return {"ok": True, "source_id": source.id, "review_enabled": bool(enabled)}


# ── 入图门控接入点:复核关 → 直接入图(零回归);复核开 → 进待审队列(不入图)──────────────


def _build_custom_kg(entities: list[dict], relations: list[dict]) -> dict:
    """把抽取候选组装成 ainsert_custom_kg 直灌载荷(复核关 = 直接入图,现有行为)。"""
    chunks = [
        {
            "content": "复核直灌",
            "source_id": _REVIEW_CHUNK_SOURCE_ID,
            "file_path": _REVIEW_CHUNK_FILE_PATH,
            "chunk_order_index": 0,
        }
    ]
    ents = [
        {
            "entity_name": e["entity_name"],
            "entity_type": e.get("entity_type") or _DEFAULT_ENTITY_TYPE,
            "description": e.get("description") or "",
            "source_id": _REVIEW_CHUNK_SOURCE_ID,
            "file_path": _REVIEW_CHUNK_FILE_PATH,
        }
        for e in entities
    ]
    rels = [
        {
            "src_id": r["src_id"],
            "tgt_id": r["tgt_id"],
            "description": r.get("description") or "",
            "keywords": r.get("keywords") or "",
            "weight": r.get("weight", _DEFAULT_RELATION_WEIGHT),
            "source_id": _REVIEW_CHUNK_SOURCE_ID,
            "file_path": _REVIEW_CHUNK_FILE_PATH,
        }
        for r in relations
    ]
    return {"chunks": chunks, "entities": ents, "relationships": rels}


def _insert_review_item(source_id: str, kind: str, payload: dict) -> str:
    """把一条抽取候选写入待审队列(pending_review 态,不入图)。"""
    item_id = str(uuid4())
    audit = [{"action": "进入待审", "from": REVIEW_STATE_EXTRACTED, "status": REVIEW_STATUS_PENDING}]
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO public.graph_extraction_review (id, source_id, kind, payload, status, audit) "
                "SELECT %s, %s, %s, %s::jsonb, %s, %s::jsonb "
                "FROM public.graph_sources WHERE id = %s AND delete_state = 'active' "
                "RETURNING id",
                (
                    item_id, source_id, kind, json.dumps(payload), REVIEW_STATUS_PENDING,
                    json.dumps(audit), source_id,
                ),
            )
            if cursor.fetchone() is None:
                raise GraphRagError("source 正在删除或删除失败，当前不可用", "source_unavailable")
        connection.commit()
    return item_id


@guard_source_graph_operation("source_id")
async def submit_extraction(
    user: UserContext,
    source_id: str,
    entities: list[dict] | None = None,
    relations: list[dict] | None = None,
) -> dict:
    """抽取入图门控:复核关 → **直接入图**(现有行为,零回归);复核开 → 进 **pending 待审队列**
    (不入图 → 检索命中=0,状态即证据)。

    entities=[{entity_name, entity_type, description}];
    relations=[{src_id, tgt_id, description, keywords, weight}]。
    """
    source = await get_manageable_source(user, source_id)
    entities = entities or []
    relations = relations or []

    if not is_review_enabled(source.id):
        # 复核关(默认)= 直接入图,保持现有 ainsert 行为(零回归)。
        rag = await get_lightrag(source)
        await rag.ainsert_custom_kg(_build_custom_kg(entities, relations))
        return {
            "reviewed": False,
            "ingested_direct": True,
            "entity_count": len(entities),
            "relation_count": len(relations),
        }

    # 复核开 → 抽取结果进 pending 队列(绝不入图):未 approved = 未入图 = 检索命中=0。
    pending_ids: list[str] = []
    for entity in entities:
        pending_ids.append(_insert_review_item(source.id, REVIEW_ITEM_ENTITY, entity))
    for relation in relations:
        pending_ids.append(_insert_review_item(source.id, REVIEW_ITEM_RELATION, relation))
    return {
        "reviewed": True,
        "ingested_direct": False,
        "pending_ids": pending_ids,
        "pending_count": len(pending_ids),
    }


# ── 待审队列读 / 状态计数 ──────────────────────────────────────────────────────────────


def _row_to_item(row: dict) -> dict:
    return {
        "id": row["id"],
        "source_id": row["source_id"],
        "kind": row["kind"],
        "payload": row["payload"],
        "status": row["status"],
        "audit": row["audit"],
    }


@guard_source_graph_operation("source_id")
async def list_pending_reviews(user: UserContext, source_id: str) -> list[dict]:
    """治理台待审队列:某 source 的 pending_review 项(可读把关)。"""
    source = await get_readable_source(user, source_id)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, source_id, kind, payload, status, audit "
                "FROM public.graph_extraction_review WHERE source_id = %s AND status = %s "
                "ORDER BY created_at ASC",
                (source.id, REVIEW_STATUS_PENDING),
            )
            return [_row_to_item(row) for row in cursor.fetchall()]


def review_status_counts(source_id: str) -> dict[str, int]:
    """某 source 复核队列逐状态计数(审计 / 队列可见性)。"""
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT status, count(*) AS c FROM public.graph_extraction_review "
                "WHERE source_id = %s GROUP BY status",
                (source_id,),
            )
            counts = {row["status"]: int(row["c"]) for row in cursor.fetchall()}
    counts["total"] = sum(counts.values())
    return counts


def _get_item(source_id: str, item_id: str) -> dict | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT id, source_id, kind, payload, status, audit "
                "FROM public.graph_extraction_review WHERE source_id = %s AND id = %s",
                (source_id, item_id),
            )
            row = cursor.fetchone()
    return _row_to_item(row) if row else None


def _set_status_with_audit(source_id: str, item_id: str, status: str, action: str) -> None:
    """状态推进 + 追加审计条目(每次复核决策留痕)。"""
    entry = [{"action": action, "status": status}]
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE public.graph_extraction_review "
                "SET status = %s, audit = audit || %s::jsonb, updated_at = now() "
                "WHERE source_id = %s AND id = %s AND EXISTS ("
                "SELECT 1 FROM public.graph_sources s "
                "WHERE s.id = public.graph_extraction_review.source_id "
                "AND s.delete_state = 'active')",
                (status, json.dumps(entry), source_id, item_id),
            )
            if cursor.rowcount != 1:
                raise GraphRagError("source 正在删除或删除失败，当前不可用", "source_unavailable")
        connection.commit()


async def _ingest_item(rag, item: dict) -> None:
    """把一条 approved 待审项真入图(entity → acreate_entity;relation → acreate_relation)。
    relation 端点不存在 → acreate_relation raise ValueError(冲突)→ 冒泡给批量汇总(部分成功)。"""
    payload = item["payload"] or {}
    if item["kind"] == REVIEW_ITEM_ENTITY:
        await rag.acreate_entity(
            payload["entity_name"],
            {
                "entity_type": payload.get("entity_type") or _DEFAULT_ENTITY_TYPE,
                "description": payload.get("description") or "",
            },
        )
        return
    relation_data: dict[str, object] = {
        "description": payload.get("description") or "",
        "keywords": payload.get("keywords") or "",
    }
    if payload.get("weight") is not None:
        relation_data["weight"] = float(payload["weight"])
    await rag.acreate_relation(payload["src_id"], payload["tgt_id"], relation_data)


@guard_source_graph_operation("source_id")
async def approve_review_item(user: UserContext, source_id: str, item_id: str) -> dict:
    """审核通过一条待审项 → **真入图**(acreate_entity/relation)→ status=approved + 审计。

    **幂等**:已 approved → 不重复入图(reingested=False);已 rejected → 明确错误不静默复活。
    入图失败(如 relation 端点不存在)→ raise 冒泡(供批量汇总部分成功)。
    """
    source = await get_manageable_source(user, source_id)  # 写 → manageable(member 403)
    item = _get_item(source.id, item_id)
    if item is None:
        raise GraphRagError("待审项不存在", "not_found")
    if item["status"] == REVIEW_STATUS_APPROVED:
        return {"ok": True, "item_id": item_id, "status": REVIEW_STATUS_APPROVED, "reingested": False}
    if item["status"] == REVIEW_STATUS_REJECTED:
        raise GraphRagError("已驳回的抽取项不可 approve", "invalid_state")

    rag = await get_lightrag(source)
    try:
        await _ingest_item(rag, item)
    except ValueError as exc:
        # 冲突(如 relation 端点不存在)→ 明确错误,状态仍 pending(可重试);不静默入图。
        raise GraphRagError(str(exc), "conflict") from exc
    _set_status_with_audit(source.id, item_id, REVIEW_STATUS_APPROVED, "审核通过入图")
    return {"ok": True, "item_id": item_id, "status": REVIEW_STATUS_APPROVED, "reingested": True}


@guard_source_graph_operation("source_id")
async def reject_review_item(user: UserContext, source_id: str, item_id: str) -> dict:
    """驳回一条待审项 → **永不入图** + 留审计(status=rejected)。已 approved 项不可 reject。"""
    source = await get_manageable_source(user, source_id)
    item = _get_item(source.id, item_id)
    if item is None:
        raise GraphRagError("待审项不存在", "not_found")
    if item["status"] == REVIEW_STATUS_APPROVED:
        raise GraphRagError("已入图的抽取项不可 reject", "invalid_state")
    _set_status_with_audit(source.id, item_id, REVIEW_STATUS_REJECTED, "驳回不入图")
    return {"ok": True, "item_id": item_id, "status": REVIEW_STATUS_REJECTED}


@guard_source_graph_operation("source_id")
async def batch_review(user: UserContext, source_id: str, decisions: list[dict]) -> dict:
    """批量复核 K 条 → 逐条执行,**单条失败不连坐**(进汇总),部分成功 M/K 可见。

    decisions=[{"item_id": ..., "action": "approve"|"reject"}]。
    """
    approved: list[str] = []
    rejected: list[str] = []
    failures: list[dict] = []
    for decision in decisions:
        item_id = decision.get("item_id")
        action = decision.get("action", "approve")
        try:
            if action == "reject":
                await reject_review_item(user, source_id, item_id)
                rejected.append(item_id)
            else:
                await approve_review_item(user, source_id, item_id)
                approved.append(item_id)
        except Exception as exc:  # 单条失败不连坐其余项。
            failures.append({"item_id": item_id, "reason": str(exc) or type(exc).__name__})
    return {
        "ok": True,
        "approved_count": len(approved),
        "rejected_count": len(rejected),
        "failure_count": len(failures),
        "approved": approved,
        "rejected": rejected,
        "failures": failures,
        "audit": {
            "action": "批量复核",
            "source_id": source_id,
            "total": len(decisions),
            "success_count": len(approved) + len(rejected),
            "failure_count": len(failures),
        },
    }
