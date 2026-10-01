"""013 · GraphRAG 治理 · T2 簇:半自动实体消歧(disambiguation)。

验收哲学(spec §9 / AC-3 / FR-347/348/349):**人闸不可绕过**。
- 候选生成(`disambiguation_candidates`)**只生成候选组,绝不调 `amerge_entities`**——系统给
  人证据与候选,合不合由人说了算(非全自动合并,对账表 §2.4 OUT)。
- 真合只在 `confirm_disambiguation`(人工显式确认)发生 → 调 `amerge_entities` 合成单节点。
- 假阳性 `dismiss_disambiguation` **持久化**(graph_sources.metadata->'disambig_dismissed'),
  重跑候选生成不再复现该组(重算不复现)。
- 幂等:re-confirm 已合并组 / re-dismiss 已忽略组 → 无重复副作用。
- 批量确认 K 组 = K 次**显式** merge(逐组 confirm,无"一键全合"路径)。

两路候选(合并去重):
- ①**归一化管线**(确定性,AM-1308):去空白 / 大小写折叠 / 全半角(NFKC)/ Levenshtein≤k,
  传递闭包成组;不依赖 LLM / embedding。
- ②**embedding 近邻**(能用级,AM-1315,RUN_GRAPH_LLM_TESTS 门控):对 source 内实体走真
  embedding,余弦相似度 ≥ τ_sim 且类型兼容(同类或一方 UNKNOWN)成对入候选,evidence.sim_score
  记录判定依据。

阈值 τ_sim / k(topk)/ Levenshtein 上限一律**具名常量**(反 Replace Magic Literal,
禁散落魔法数字面量作阈值)。持久化载体存疑(spec §13-2 未定 graph-rag 新表 vs platform),
本实现挂 `graph_sources.metadata` JSONB(012 已加该列),AM-1309 按**行为**("重算不复现")
断言、不绑存储路径。
"""

from __future__ import annotations

import hashlib
import json
import unicodedata

from graph_rag.core.lightrag_service import get_lightrag
from graph_rag.core.source_operation import guard_source_graph_operation
from graph_rag.core.sources import get_manageable_source, get_readable_source
from graph_rag.core.types import UserContext
from graph_rag.db import get_connection

# ── 具名常量(FR-347/348 / spec §8:禁散落魔法数字面量作阈值)──────────────────────────
# τ_sim:2026-07-21 按当前 text-embedding-v4 真实样本校准；目标别名对
# cosine=0.852879，无关对最高约 0.48，类型门禁仍独立生效。
DISAMBIG_SIM_THRESHOLD = 0.85
# k:embedding 近邻每实体取 topk 个候选邻居(限制近邻扇出,防全对爆炸)。
DISAMBIG_TOPK = 10
# 归一化路 Levenshtein 距离上限(spec §8 建议默认 1):norm 后编辑距离 ≤ 此值视为近名候选。
DISAMBIG_LEVENSHTEIN_MAX = 1
# 归一化路模糊匹配的最短 norm 长度(过短字符串禁模糊,防 "甲"/"乙" 误配)。
DISAMBIG_MIN_FUZZY_LEN = 4
# sim_score 证据保留小数位(展示精度,非阈值)。
_SIM_SCORE_PRECISION = 4

# 候选状态。
CANDIDATE_STATUS_PENDING = "pending"
CANDIDATE_STATUS_DISMISSED = "dismissed"
CANDIDATE_STATUS_MERGED = "merged"

# 候选生成方法(证据来源)。
CANDIDATE_METHOD_NORMALIZATION = "normalization"
CANDIDATE_METHOD_EMBEDDING = "embedding"

# dismiss 持久化载体键(graph_sources.metadata JSONB)。
_DISMISSED_METADATA_KEY = "disambig_dismissed"

_UNKNOWN_TYPE = "UNKNOWN"


# ── 归一化与相似度基元 ──────────────────────────────────────────────────────────────


def normalize_name(name: str) -> str:
    """归一化:NFKC(全半角折叠)→ 去所有空白 → casefold(大小写折叠)。"""
    text = unicodedata.normalize("NFKC", name or "")
    text = "".join(ch for ch in text if not ch.isspace())
    return text.casefold()


def _levenshtein(a: str, b: str) -> int:
    """标准编辑距离(无外部依赖)。"""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            insert = current[j - 1] + 1
            delete = previous[j] + 1
            substitute = previous[j - 1] + (ca != cb)
            current.append(min(insert, delete, substitute))
        previous = current
    return previous[-1]


def _norm_similar(norm_a: str, norm_b: str) -> bool:
    """两归一化名是否近似:完全相等,或长度足够且 Levenshtein ≤ 具名上限。"""
    if norm_a == norm_b:
        return True
    if len(norm_a) < DISAMBIG_MIN_FUZZY_LEN or len(norm_b) < DISAMBIG_MIN_FUZZY_LEN:
        return False
    return _levenshtein(norm_a, norm_b) <= DISAMBIG_LEVENSHTEIN_MAX


def _type_compatible(type_a: str | None, type_b: str | None) -> bool:
    """类型兼容:同类,或一方 UNKNOWN(未分类不阻断消歧)。"""
    ta = (type_a or _UNKNOWN_TYPE).strip().upper()
    tb = (type_b or _UNKNOWN_TYPE).strip().upper()
    return ta == tb or ta == _UNKNOWN_TYPE or tb == _UNKNOWN_TYPE


# ── 候选组构造 ──────────────────────────────────────────────────────────────────────


def _group_signature(names: list[str]) -> str:
    """候选组稳定签名(成员名有序 → sha1);dismiss 持久化 / 去重 / 幂等均以此为键。"""
    joined = "".join(sorted((n or "").strip() for n in names))
    return hashlib.sha1(joined.encode("utf-8")).hexdigest()


def _pick_canonical(members: list[dict]) -> str:
    """建议规范名:度数最高 → 名字最长 → 字典序最小。"""
    return sorted(
        members,
        key=lambda m: (-(m.get("degree") or 0), -len(m.get("name") or ""), m.get("name") or ""),
    )[0]["name"]


def _make_group(members: list[dict], method: str, evidence: dict, strength: float) -> dict:
    names = [m["name"] for m in members]
    signature = _group_signature(names)
    return {
        "candidate_id": signature[:16],
        "signature": signature,
        "suggested_canonical": _pick_canonical(members),
        "members": members,
        "evidence": {"method": method, **evidence},
        "status": CANDIDATE_STATUS_PENDING,
        "strength": float(strength),
    }


def _degree(name: str, relations: list[dict]) -> int:
    return sum(1 for r in relations if r.get("source") == name or r.get("target") == name)


# ── 归一化路(确定性,AM-1308)──────────────────────────────────────────────────────


def _normalization_groups(entities: list[dict]) -> list[dict]:
    """归一化 + Levenshtein 传递闭包成组(union-find);members≥2 的组入候选队列。"""
    n = len(entities)
    if n < 2:
        return []
    norms = [normalize_name(e["name"]) for e in entities]
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x: int, y: int) -> None:
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[max(rx, ry)] = min(rx, ry)

    exact = True
    for i in range(n):
        for j in range(i + 1, n):
            if _norm_similar(norms[i], norms[j]):
                if norms[i] != norms[j]:
                    exact = False  # 组内含模糊(Levenshtein)边 → 证据略弱。
                union(i, j)

    clusters: dict[int, list[int]] = {}
    for idx in range(n):
        clusters.setdefault(find(idx), []).append(idx)

    groups: list[dict] = []
    for members_idx in clusters.values():
        if len(members_idx) < 2:
            continue
        members = [entities[i] for i in members_idx]
        # 组内是否全同归一化(全精确)决定证据强度。
        member_norms = {norms[i] for i in members_idx}
        all_exact = len(member_norms) == 1
        groups.append(
            _make_group(
                members,
                method=CANDIDATE_METHOD_NORMALIZATION,
                evidence={"normalized_match": sorted(member_norms)},
                # 精确归一化组强于含模糊组;成员越多证据越强。
                strength=(1.0 if all_exact else 0.8) + len(members) / 100.0,
            )
        )
    return groups


# ── embedding 近邻路(能用级,AM-1315,门控)────────────────────────────────────────


async def _embedding_groups(rag, entities: list[dict]) -> list[dict]:
    """真 embedding 近邻:每实体取 topk 最相似邻居,相似度 ≥ τ_sim 且类型兼容成对入候选。"""
    names = [e["name"] for e in entities]
    if len(names) < 2:
        return []
    by_name = {e["name"]: e for e in entities}

    import numpy as np

    raw = await rag.embedding_func(names)
    emb = np.asarray(raw, dtype=float)
    row_norms = np.linalg.norm(emb, axis=1)

    groups: list[dict] = []
    seen: set[str] = set()
    for i in range(len(names)):
        # 该实体对所有其它实体的相似度,取 topk 邻居。
        sims: list[tuple[int, float]] = []
        for j in range(len(names)):
            if j == i:
                continue
            denom = row_norms[i] * row_norms[j]
            if denom == 0:
                continue
            sims.append((j, float(emb[i] @ emb[j] / denom)))
        sims.sort(key=lambda t: t[1], reverse=True)
        for j, sim in sims[:DISAMBIG_TOPK]:
            if sim < DISAMBIG_SIM_THRESHOLD:
                break  # 已按相似度降序,后续更低。
            name_i, name_j = names[i], names[j]
            # 归一化相同的交给归一化路(避免两路重复)。
            if normalize_name(name_i) == normalize_name(name_j):
                continue
            if not _type_compatible(by_name[name_i]["type"], by_name[name_j]["type"]):
                continue
            signature = _group_signature([name_i, name_j])
            if signature in seen:
                continue
            seen.add(signature)
            members = [by_name[name_i], by_name[name_j]]
            groups.append(
                _make_group(
                    members,
                    method=CANDIDATE_METHOD_EMBEDDING,
                    evidence={"sim_score": round(sim, _SIM_SCORE_PRECISION)},
                    strength=sim,
                )
            )
    return groups


def _dedup_groups(groups: list[dict]) -> list[dict]:
    """两路合并去重(同 signature 保留证据更强者)。"""
    best: dict[str, dict] = {}
    for group in groups:
        sig = group["signature"]
        if sig not in best or group["strength"] > best[sig]["strength"]:
            best[sig] = group
    return list(best.values())


# ── dismiss 持久化载体(graph_sources.metadata JSONB;行为口径,非绑定路径)────────────


def _load_dismissed(source_id: str) -> set[str]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT COALESCE(metadata->%s, '[]'::jsonb) AS d FROM public.graph_sources WHERE id = %s",
                (_DISMISSED_METADATA_KEY, source_id),
            )
            row = cursor.fetchone()
    if not row or not row.get("d"):
        return set()
    return {str(sig) for sig in row["d"]}


def _add_dismissed(source_id: str, signature: str) -> None:
    """把候选组签名登记为已忽略(幂等:已存在不重复追加)。"""
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT COALESCE(metadata->%s, '[]'::jsonb) AS d FROM public.graph_sources "
                "WHERE id = %s AND delete_state = 'active' FOR UPDATE",
                (_DISMISSED_METADATA_KEY, source_id),
            )
            row = cursor.fetchone()
            if row is None:
                raise GraphRagError("source 正在删除或删除失败，当前不可用", "source_unavailable")
            current = list(row["d"]) if row and row.get("d") else []
            if signature not in current:
                current.append(signature)
                cursor.execute(
                    "UPDATE public.graph_sources SET metadata = "
                    "jsonb_set(COALESCE(metadata, '{}'::jsonb), %s, %s::jsonb), updated_at = now() "
                    "WHERE id = %s AND delete_state = 'active'",
                    ("{" + _DISMISSED_METADATA_KEY + "}", json.dumps(current), source_id),
                )
                if cursor.rowcount != 1:
                    raise GraphRagError("source 正在删除或删除失败，当前不可用", "source_unavailable")
        connection.commit()


# ── 公共 API:候选生成(人闸左侧,绝不 amerge)/ confirm(人闸右侧,真合)/ dismiss ────────


@guard_source_graph_operation("source_id")
async def disambiguation_candidates(
    user: UserContext, source_id: str, *, include_embedding: bool = False
) -> list[dict]:
    """生成消歧候选组队列——**只生成候选,绝不调 amerge_entities**(人闸不可绕过)。

    - 归一化路始终跑(确定性);embedding 近邻路 include_embedding=True 时叠加(门控慢)。
    - 已 dismiss 的组不复现(重算不复现);队列按证据强度降序。
    """
    source = await get_readable_source(user, source_id)
    from graph_rag.core import graph_curation

    detail = await graph_curation.graph_detail(user, source_id)
    relations = detail.get("relations", [])
    entities = [
        {"name": e["name"], "type": e.get("type") or _UNKNOWN_TYPE, "degree": _degree(e["name"], relations)}
        for e in detail.get("entities", [])
        if e.get("name")
    ]

    groups = _normalization_groups(entities)
    if include_embedding:
        rag = await get_lightrag(source)
        groups = _dedup_groups(groups + await _embedding_groups(rag, entities))

    dismissed = _load_dismissed(source.id)
    groups = [g for g in groups if g["signature"] not in dismissed]
    groups.sort(key=lambda g: (g["strength"], g["candidate_id"]), reverse=True)
    return groups


@guard_source_graph_operation("source_id")
async def confirm_disambiguation(
    user: UserContext, source_id: str, members: list[str], canonical: str | None = None
) -> dict:
    """人工确认合并一组候选 → **真调 `amerge_entities`** 合成单节点(人闸右侧)。

    幂等:仅对图中仍存在的成员合并;若除 canonical 外已无存活成员(已合并)→ 无第二次 merge。
    """
    source = await get_manageable_source(user, source_id)  # 写 → manageable(member 403)
    rag = await get_lightrag(source)

    existing: list[str] = []
    for name in members:
        info = await rag.get_entity_info(name)
        if info.get("graph_data"):
            existing.append(name)

    canonical = canonical or (existing[0] if existing else (members[0] if members else ""))
    source_entities = [n for n in existing if n != canonical]

    signature = _group_signature(members)
    audit = {"action": "确认消歧合并", "source_id": source.id, "target": canonical}

    if not source_entities:
        # 幂等:无可合并成员(已合并 / 组已不成立)→ 不触发第二次 merge。
        return {
            "ok": True,
            "merged": False,
            "canonical": canonical,
            "merged_members": [],
            "signature": signature,
            "audit": audit,
        }

    result = await rag.amerge_entities(source_entities=source_entities, target_entity=canonical)
    return {
        "ok": True,
        "merged": True,
        "canonical": canonical,
        "merged_members": source_entities,
        "signature": signature,
        "result": _safe(result),
        "audit": audit,
    }


@guard_source_graph_operation("source_id")
async def dismiss_disambiguation(user: UserContext, source_id: str, members: list[str]) -> dict:
    """标记一组候选为假阳性 → **持久化**(重算不复现);幂等(重复 dismiss 无累积)。"""
    source = await get_manageable_source(user, source_id)
    signature = _group_signature(members)
    _add_dismissed(source.id, signature)
    return {
        "ok": True,
        "dismissed": True,
        "signature": signature,
        "status": CANDIDATE_STATUS_DISMISSED,
        "audit": {"action": "忽略消歧候选", "source_id": source.id, "target": signature[:16]},
    }


@guard_source_graph_operation("source_id")
async def batch_confirm_disambiguation(user: UserContext, source_id: str, groups: list[dict]) -> dict:
    """批量确认 K 组 → **逐组显式** confirm(K 次 merge,无"一键全合"路径)。

    groups:[{"members": [...], "canonical": <可选>}, ...]。单组失败不连坐,进汇总。
    """
    results: list[dict] = []
    failures: list[dict] = []
    for group in groups:
        try:
            results.append(
                await confirm_disambiguation(
                    user, source_id, group["members"], group.get("canonical")
                )
            )
        except Exception as exc:  # 单组失败不连坐其余组。
            failures.append({"members": group.get("members"), "reason": str(exc) or type(exc).__name__})
    return {
        "ok": True,
        "confirmed_count": len(results),
        "failure_count": len(failures),
        "results": results,
        "failures": failures,
        "audit": {
            "action": "批量确认消歧",
            "source_id": source_id,
            "total": len(groups),
            "success_count": len(results),
            "failure_count": len(failures),
        },
    }


def _safe(result) -> dict:
    if isinstance(result, dict):
        return {k: v for k, v in result.items() if isinstance(v, (str, int, float, bool, list)) or v is None}
    status = getattr(result, "status", None)
    message = getattr(result, "message", None)
    return {"status": str(status) if status is not None else "ok", "message": str(message) if message else ""}
