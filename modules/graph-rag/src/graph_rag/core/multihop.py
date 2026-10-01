"""013 · GraphRAG 治理 · T6 簇:多跳编排(FR-420)。

验收哲学(spec §9.5 / AM-1319/1320):对"关系链"型问题做**子问题分解 → 逐跳检索(≤MAX_HOP)
→ 遍历合并**。

- 可达性由编排侧在 **011 结构化出参 `relationships`**(实体对 + 关系)上**遍历**——
  LightRAG 无 paths 出参,故不依赖库 paths,自己在结构化边上 BFS。
- 第 k 跳起点 = 第 k-1 跳命中实体(seed 前沿再检索,合并去重)。
- 跳数上限**具名常量** `MAX_HOP=2`(非通用 N 跳、非魔法数字面量);超上限 → 回退 / 告知
  深度不足(`depth_exhausted`)。
- 单跳即可答 / 子问题分解失败 → **回退单跳**(`fallback_single_hop`)不崩。
- **环路(A→B→A)**:每条路径带 `visited` 集,已访问节点不再入 → **有限步终止**防死循环。

与 016 E-1 多跳评测口径共享 golden(AM-1320)。`retrieve_hop` 是 011 检索接缝——确定性遍历
测试(AM-1319)patch 本函数投喂 canned relationships,不触真检索;端到端 golden(AM-1320)
走真 011 检索链。
"""

from __future__ import annotations

from graph_rag.core.search import search
from graph_rag.core.types import UserContext

# ── 具名常量(反 Replace Magic Literal:禁散落魔法数字面量作跳数上限)────────────────────
# FR-420:多跳跳数上限——2 跳(A→B→C),非通用 N 跳。魔法数 `2` 作阈值一律走本常量。
MAX_HOP = 2


def _edge_from_relationship(rel: dict) -> dict | None:
    """从 011 结构化 relationship 项抽 (source, target, description) 边。
    兼容 aquery_data 原生键(src_id/tgt_id)与结构化投影键(source/target)。"""
    src = rel.get("src_id") or rel.get("source") or rel.get("src")
    tgt = rel.get("tgt_id") or rel.get("target") or rel.get("tgt")
    if not src or not tgt:
        return None
    return {
        "source": str(src),
        "target": str(tgt),
        "description": rel.get("description") or rel.get("keywords") or "",
    }


def _extract_edges(relationships: list[dict] | None) -> list[dict]:
    edges: list[dict] = []
    for rel in relationships or []:
        edge = _edge_from_relationship(rel)
        if edge is not None:
            edges.append(edge)
    return edges


def _entity_names(entities: list[dict] | None) -> list[str]:
    names: list[str] = []
    for entity in entities or []:
        name = entity.get("entity_name") or entity.get("name")
        if name:
            names.append(str(name))
    return names


def _dedup_edges(edges: list[dict]) -> list[dict]:
    """按 (source, target) 去重(逐跳合并后同边不重复遍历)。"""
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    for edge in edges:
        key = (edge["source"], edge["target"])
        if key in seen:
            continue
        seen.add(key)
        out.append(edge)
    return out


async def retrieve_hop(
    user: UserContext, query: str, *, source_id: str | None = None, mode: str = "mix"
) -> tuple[list[dict], list[str]]:
    """单跳检索接缝(011 结构化检索链):返回 (edges, entity_names)。

    多跳编排逐跳调本函数——第 1 跳用原问题、第 2 跳用第 1 跳命中实体名再检索。确定性遍历测试
    (AM-1319)patch 本函数投喂 canned relationships,不触真检索;端到端 golden(AM-1320)走真检索。
    """
    result = await search(user, query, source_id=source_id, mode=mode)
    edges: list[dict] = []
    names: list[str] = []
    for item in result.get("results", []):
        edges.extend(_extract_edges(item.get("relationships")))
        names.extend(_entity_names(item.get("entities")))
    return _dedup_edges(edges), names


def _select_seeds(query: str, entity_names: list[str]) -> list[str]:
    """子问题分解 → seed 实体:检索命中实体中**被问题文本提及者**为遍历起点。

    无 seed(问题未提及任何检索命中实体)→ 分解失败信号(上层回退单跳)。保序去重。
    """
    seeds: list[str] = []
    for name in entity_names:
        if name and name in query and name not in seeds:
            seeds.append(name)
    return seeds


def traverse_paths(
    edges: list[dict], seeds: list[str], *, max_hop: int = MAX_HOP
) -> tuple[list[dict], bool]:
    """在关系边上 BFS 构造 ≤max_hop 跳路径。

    - **环路防护**:每条路径携带 `visited` 集,下一跳目标已在 visited 内则不再入 →
      有限步终止(A→B→A 不无限循环)。
    - **MAX_HOP 截断**:路径达 max_hop 跳即停;若截断处仍有指向未访问节点的出边 →
      `depth_exhausted=True`(超跳数,告知深度不足)。

    返回 (paths, depth_exhausted);path = {"entities": [...], "relations": [...], "hops": n}。

    可达性口径 = **无向**:KG 关系(合作/供货/运输…)用于"关系链走两步"的可达遍历,非有向流;
    且 LightRAG 结构化 relationships 的 (src,tgt) 方向不保证与建边一致(实测常反向),故按无向
    邻接遍历——每条边正反两向都可走,visited 集仍逐路径拦环。
    """
    adjacency: dict[str, list[tuple[str, dict]]] = {}
    for edge in edges:
        adjacency.setdefault(edge["source"], []).append((edge["target"], edge))
        adjacency.setdefault(edge["target"], []).append((edge["source"], edge))

    paths: list[dict] = []
    depth_exhausted = False
    for seed in seeds:
        # 栈项:(当前节点, 实体路径, 关系路径, 已访问集合)。DFS + visited 集 = 有限步。
        stack: list[tuple[str, list[str], list[dict], set[str]]] = [
            (seed, [seed], [], {seed})
        ]
        while stack:
            node, epath, rpath, visited = stack.pop()
            if rpath:  # 至少走了一跳(rpath 非空)→ 记一条路径,不用裸整数比较。
                paths.append(
                    {"entities": list(epath), "relations": list(rpath), "hops": len(rpath)}
                )
            outgoing = adjacency.get(node, [])
            if len(rpath) >= max_hop:
                # 达上限:仍有指向未访问节点的邻边 → 深度不足(超 MAX_HOP 未能触达)。
                if any(neighbor not in visited for neighbor, _edge in outgoing):
                    depth_exhausted = True
                continue
            for neighbor, edge in outgoing:
                if neighbor in visited:
                    continue  # 环路防护:visited 拦截 → 有限步终止,不死循环。
                stack.append((neighbor, epath + [neighbor], rpath + [edge], visited | {neighbor}))
    return paths, depth_exhausted


async def multi_hop_search(
    user: UserContext,
    query: str,
    *,
    source_id: str | None = None,
    mode: str = "mix",
    max_hop: int = MAX_HOP,
) -> dict:
    """多跳编排主入口:子问题分解 → 逐跳检索(≤max_hop)→ 结构化边遍历合并。

    返回:{query, seeds, paths, answer_path, hops, max_hop, multi_hop,
           depth_exhausted, fallback_single_hop}。
    """
    # ── Hop 1 检索(011 结构化 relationships)──
    edges, entity_names = await retrieve_hop(user, query, source_id=source_id, mode=mode)
    seeds = _select_seeds(query, entity_names)

    if not seeds:
        # 子问题分解失败(问题未提及任何检索命中实体)→ **回退单跳**:仅一跳遍历,不崩。
        single_seeds = sorted({edge["source"] for edge in edges})
        paths, _ = traverse_paths(edges, single_seeds, max_hop=1)
        first = paths[0] if paths else None
        return {
            "query": query,
            "seeds": [],
            "paths": paths,
            "answer_path": first,
            "hops": first["hops"] if first else 0,
            "max_hop": max_hop,
            "multi_hop": False,
            "depth_exhausted": False,
            "fallback_single_hop": True,
        }

    # ── Hop 2..max_hop 逐跳检索:第 k 跳起点 = 第 k-1 跳命中实体(前沿再检索、合并去重)──
    frontier: set[str] = set(seeds)
    for _extra_hop in range(1, max_hop):  # max_hop=2 → 一次额外跳检索(range(1,2))。
        # 无向前沿:前沿节点在任一方向的邻居都作为下一跳检索起点(方向不保证)。
        next_frontier: set[str] = set()
        for edge in edges:
            if edge["source"] in frontier:
                next_frontier.add(edge["target"])
            if edge["target"] in frontier:
                next_frontier.add(edge["source"])
        next_frontier -= frontier
        if not next_frontier:
            break
        gathered: list[dict] = []
        for entity in sorted(next_frontier):
            more_edges, _names = await retrieve_hop(
                user, entity, source_id=source_id, mode=mode
            )
            gathered.extend(more_edges)
        edges = _dedup_edges(edges + gathered)
        frontier = next_frontier

    paths, depth_exhausted = traverse_paths(edges, seeds, max_hop=max_hop)
    # 答案路径 = 跳数最多者(单跳可答 → 最长即单跳,不强行编造第 2 跳)。
    answer_path = max(paths, key=lambda p: p["hops"]) if paths else None
    return {
        "query": query,
        "seeds": seeds,
        "paths": paths,
        "answer_path": answer_path,
        "hops": answer_path["hops"] if answer_path else 0,
        "max_hop": max_hop,
        "multi_hop": bool(answer_path and answer_path["hops"] >= max_hop),
        "depth_exhausted": depth_exhausted,
        "fallback_single_hop": False,
    }
