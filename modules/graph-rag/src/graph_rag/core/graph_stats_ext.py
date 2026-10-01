"""012 · GraphRAG 领域建图 · T5 簇(建图质量观测:per-source 隔离 / 孤立节点 / 失败率 / 图规模告警)。

FR-338 / §7.4 / FR-425 / AC-12/13:在 006 已落的 workspace-scoped `graph_stats`(租户隔离)之上
**叠加**建图质量指标——**不重复造 workspace 过滤**、**不回退全库聚合**(AM-722 显式断隔离不回退)。

- **per-source 质量指标 workspace 隔离(AM-722)**:按 `source.workspace` 出数——A 库指标不含 B 库
  数据(每 source 一 workspace,LightRAG `lightrag_vdb_entity/relation` 按 workspace 列隔离)。
- **孤立节点 degree-0(AM-723 / 发现待回报⑤)**:无任何关系边的实体——经 `get_knowledge_graph`
  遍历(观测层**读路径**,不改引擎写路径):节点 id 不出现在任何 edge 端点即 degree-0。
- **pipeline 失败率(AM-724 / 部分成功)**:failed 文档数 / 总文档数——从 `graph_documents` 按
  source_id 出数(source_id ↔ workspace 1:1,即 workspace 隔离),"N 篇入 M 篇"的部分失败对管理员可见。
- **图规模软阈值告警(AM-727 / FR-425)**:总实体/总关系/平均度数 + 超**具名常量软阈值**告警——
  达阈值出黄字告警文案且**入图不阻断**(软阈值 vs 硬配额),未达阈值无告警。
"""

from __future__ import annotations

from neo4j import GraphDatabase

from graph_rag.config import get_settings
from graph_rag.core.neo4j_boundary import assert_neo4j_config_valid
from graph_rag.db import get_connection
from graph_rag.core.source_operation import guard_source_graph_operation

# ── 图规模软阈值(具名常量,SSOT,防魔法数)──────────────────────────────────────────────
#
# 软阈值 = 提醒关注,**非硬配额**(达阈值仍入图成功)。默认建议实体 10k / 关系 50k;
# 测试可传低阈值逼出告警(AM-727)。

SCALE_ALERT_ENTITY_THRESHOLD = 10_000
SCALE_ALERT_RELATION_THRESHOLD = 50_000
SCALE_ALERT_MESSAGE = "图谱规模较大，建议关注检索性能与治理成本"


def _workspace_graph_counts(workspace: str) -> tuple[list[str], int]:
    """Read the authoritative Neo4j graph for exactly one workspace label."""
    settings = assert_neo4j_config_valid(get_settings())
    with GraphDatabase.driver(
        settings.neo4j_uri,
        auth=(settings.neo4j_username, settings.neo4j_password),
        max_connection_pool_size=settings.neo4j_max_connection_pool_size,
        connection_timeout=settings.neo4j_connection_timeout_seconds,
    ) as driver:
        record = driver.execute_query(
            "MATCH (n) "
            "WHERE $workspace IN labels(n) "
            "WITH collect(DISTINCT trim(toString(n.entity_id))) AS names "
            "OPTIONAL MATCH (source)-[relation]->(target) "
            "WHERE $workspace IN labels(source) AND $workspace IN labels(target) "
            "RETURN names, count(DISTINCT relation) AS relations",
            workspace=workspace,
            database_=settings.neo4j_database,
        ).records[0]
    names = sorted(name for name in record["names"] if name)
    return names, int(record["relations"])


def per_source_graph_stats(source) -> dict:
    """AM-722:per-source 建图质量指标,**按 source.workspace 隔离**(A 不含 B)。

    只统计本 source workspace 的实体/关系——叠在 006 workspace 过滤语义之上(单 source 粒度),
    绝不回退全库聚合。返回 distinct 实体数 + 实体名集(供隔离断言 B 名不出现在 A)+ 关系数。
    """
    workspace = source.workspace
    names, relations = _workspace_graph_counts(workspace)
    return {
        "workspace": workspace,
        "source_id": getattr(source, "id", None),
        "entities": len(names),
        "entity_rows": len(names),
        "entity_names": names,
        "relations": relations,
    }


@guard_source_graph_operation("source")
async def count_isolated_nodes(source) -> dict:
    """AM-723:孤立节点(degree-0)计数——经 `get_knowledge_graph` 遍历(读路径,不改引擎写路径)。

    孤立 = 节点 id 不出现在任何 edge 的 source/target 端点。返回计数 + 孤立节点名集
    (供"有边实体不被误计孤立"断言)。
    """
    from graph_rag.core.lightrag_service import get_lightrag

    rag = await get_lightrag(source)
    kg = await rag.get_knowledge_graph("*", max_nodes=100_000)
    endpoints: set[str] = set()
    for edge in kg.edges:
        endpoints.add(edge.source)
        endpoints.add(edge.target)

    isolated: list[str] = []
    for node in kg.nodes:
        node_id = node.id
        if node_id not in endpoints:
            props = node.properties or {}
            name = props.get("entity_id") or props.get("entity_name") or node_id
            isolated.append(str(name))
    return {
        "isolated_count": len(isolated),
        "isolated_names": isolated,
        "total_nodes": len(kg.nodes),
        "total_edges": len(kg.edges),
    }


def pipeline_failure_rate(source) -> dict:
    """AM-724:per-source pipeline 失败率 = failed 文档数 / 总文档数(部分失败可见)。

    从 graph_documents 按 source_id 出数(source_id ↔ workspace 1:1,即 workspace 隔离)。
    total = 非归档文档数;failure_rate = failed/total(total==0 → 0.0)。
    """
    source_id = getattr(source, "id", None)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT status, count(*) AS c FROM public.graph_documents "
                "WHERE source_id = %s AND archived_at IS NULL GROUP BY status",
                (source_id,),
            )
            counts = {row["status"]: int(row["c"]) for row in cursor.fetchall()}
    total = sum(counts.values())
    failed = counts.get("failed", 0)
    ready = counts.get("ready", 0)
    failure_rate = (failed / total) if total else 0.0
    return {
        "source_id": source_id,
        "total": total,
        "failed": failed,
        "ready": ready,
        "status_counts": counts,
        "failure_rate": failure_rate,
    }


def graph_scale_metrics(
    source,
    *,
    entity_threshold: int = SCALE_ALERT_ENTITY_THRESHOLD,
    relation_threshold: int = SCALE_ALERT_RELATION_THRESHOLD,
) -> dict:
    """AM-727 / FR-425:图规模指标(总实体/总关系/平均度数)+ **软阈值告警(不阻断)**。

    达软阈值(实体≥entity_threshold 或 关系≥relation_threshold)→ `scale_alert` present
    (含建议文案),但入图不被阻断(软阈值 vs 硬配额,本函数只观测不拦截);未达 → scale_alert None。
    """
    stats = per_source_graph_stats(source)
    total_entities = stats["entities"]
    total_relations = stats["relations"]
    # 无向图平均度数 = 2 * 边数 / 节点数(节点=0 → 0.0)。
    avg_degree = (2.0 * total_relations / total_entities) if total_entities else 0.0

    scale_alert = None
    if total_entities >= entity_threshold or total_relations >= relation_threshold:
        scale_alert = {
            "message": SCALE_ALERT_MESSAGE,
            "total_entities": total_entities,
            "total_relations": total_relations,
            "entity_threshold": entity_threshold,
            "relation_threshold": relation_threshold,
            "blocking": False,  # 软阈值:告警不阻断入图(硬拦截命中=0)。
        }
    return {
        "workspace": stats["workspace"],
        "source_id": stats["source_id"],
        "total_entities": total_entities,
        "total_relations": total_relations,
        "avg_degree": avg_degree,
        "scale_alert": scale_alert,
    }
