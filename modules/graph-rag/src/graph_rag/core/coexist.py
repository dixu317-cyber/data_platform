"""012 · GraphRAG 领域建图 · T5 簇(文本+CSV 共存合并:同实体名两来源 → 单节点、多 file_path 锚点)。

FR-339 / AC-14(AM-725/726):同一 source 里,同 `entity_name` 由**两条入图路径**(文本 LLM 抽取
路径 与 CSV 结构化直灌路径)贡献 → 图里应为**单一节点**(upsert 合并),且 provenance **保留两个
file_path 锚点**(两来源都可溯源),质量指标 distinct 实体总数**合并计数不 double-count**。

**为何需要显式合并**:LightRAG `ainsert_custom_kg` 的实体 upsert 走 `upsert_nodes_batch`
(`MERGE ... SET n += props`)——`file_path` 属性被**新值覆盖**而非累积。故当 CSV 路径灌入一个
文本路径已建的实体时,若不干预,文本来源的 file_path 锚点会被 CSV 的覆盖丢失。本模块在
结构化灌入前**快照既有 provenance**、灌入后把"既有来源 ∪ 本次来源"**合并回节点 file_path**
(按 `GRAPH_FIELD_SEP`,复刻文本抽取的多来源累积语义,operate.py:1427),保住两锚点。

与 T4 `ingest_structured_document`(单来源、file_path=本表)的区别:本函数**跨路径共存**时才用,
保留多来源;单来源首次灌入(无既有 provenance)退化为等价单锚点(零回归)。
"""

from __future__ import annotations

from lightrag.constants import GRAPH_FIELD_SEP

from graph_rag.core.csv_kg import build_custom_kg, parse_table_bytes
from graph_rag.core.incremental import _provenance_files
from graph_rag.core.lightrag_service import get_lightrag
from graph_rag.core.source_operation import guard_source_graph_operation


async def _snapshot_provenance(rag, entity_names: list[str]) -> dict[str, set[str]]:
    """灌入前快照:每个待写实体既有的 file_path provenance 集(新实体 → 空集)。"""
    prior: dict[str, set[str]] = {}
    for name in entity_names:
        info = await rag.get_entity_info(name)
        graph_data = info.get("graph_data") or {}
        prior[name] = _provenance_files(graph_data) if graph_data else set()
    return prior


async def _merge_provenance(rag, entity_names: list[str], prior: dict[str, set[str]]) -> None:
    """灌入后把"既有来源 ∪ 本次来源"合并回节点 file_path(保住多锚点,防覆盖丢失)。"""
    for name in entity_names:
        info = await rag.get_entity_info(name)
        graph_data = dict(info.get("graph_data") or {})
        if not graph_data:
            continue
        files = _provenance_files(graph_data) | prior.get(name, set())
        merged = GRAPH_FIELD_SEP.join(sorted(files))
        if merged and merged != graph_data.get("file_path"):
            graph_data["file_path"] = merged
            graph_data["entity_id"] = name
            await rag.chunk_entity_relation_graph.upsert_node(name, graph_data)


@guard_source_graph_operation("source")
async def ingest_coexisting_structured(
    source,
    doc_id: str,
    content: bytes | str,
    filename: str,
) -> dict:
    """AM-725:CSV 结构化灌入 + **共存 provenance 合并**——同名实体保单节点、保留既有+本次两来源锚点。

    对既有实体(另一路径已建,如文本抽取)不覆盖其 file_path 锚点,而是并入(多来源溯源);
    对新实体退化为单来源锚点(= 本表,零回归)。返回结构化灌入 summary + 合并的实体名。
    """
    rag = await get_lightrag(source)
    headers, records = parse_table_bytes(content)
    build = build_custom_kg(headers, records, filename=filename, doc_id=doc_id)
    entity_names = list(build.entity_names)

    prior = await _snapshot_provenance(rag, entity_names)
    if build.custom_kg["entities"]:
        await rag.ainsert_custom_kg(build.custom_kg)
    await _merge_provenance(rag, entity_names, prior)

    result = build.summary()
    result["mode"] = "coexist_merge"
    result["wrote_graph"] = True
    result["entity_names"] = entity_names
    return result


@guard_source_graph_operation("source")
async def entity_provenance_files(source, entity_name: str) -> list[str]:
    """读某实体当前 provenance 的全部 file_path 锚点(去重排序)——AM-725/726 共存断言用。"""
    rag = await get_lightrag(source)
    info = await rag.get_entity_info(entity_name)
    graph_data = info.get("graph_data") or {}
    return sorted(_provenance_files(graph_data))
