"""012 · GraphRAG 领域建图 · T4 簇(增量入图 → upsert 去重 / 幂等 / provenance 删除 / 增量vs重建边界)。

G-7 心脏(FR-332/333/335 / AC-8/9 / 增量 upsert 语义):

- **追加/更新走 upsert 增量,非整档重建**(AM-716/717):CSV 追加行 / 更新行 = 只构造增量
  batch 走 `ainsert_custom_kg`(LightRAG 按 `entity_name` 去重保留最后 + 关系按 sorted 端点对
  去重,`lightrag.py:1700-1748`;图存储的 upsert 语义为末次覆盖),**已有
  实体不动、不整档重建**。追加 = 新 entity_name 只加不动老;更新 = 同 entity_name 覆盖属性、
  单节点幂等(重复执行无第二节点)。
- **行删除 provenance(FR-334 / AM-718)**:删行实体若 provenance **独占本 CSV**(file_path 仅
  该来源)→ `adelete_by_entity` 可回收;若 **跨源共享**(file_path 含其他来源,LightRAG 文本抽取
  按 `GRAPH_FIELD_SEP` 累积多来源 file_path,`operate.py:1427)→ **不擅删**,归治理需人审(013)。
  provenance 真断:`get_entity_info().graph_data["file_path"]` 按 `GRAPH_FIELD_SEP` 拆出多来源集。
- **增量 vs 全量重建边界(FR-335 / AM-719)**:增量路径(`append_rows`)**不触** `delete_document`/
  `archive`(不删旧);全量重建(`rebuild_document`)先删旧(`delete_document`)再重灌(两路语义不混,
  防增量当重建跑丢老实体、防重建当增量漏删)。
"""

from __future__ import annotations

from lightrag.constants import GRAPH_FIELD_SEP
from lightrag.utils_pipeline import normalize_document_file_path

from graph_rag.core.csv_kg import ingest_structured_document
from graph_rag.core.lightrag_service import delete_document, get_lightrag
from graph_rag.core.source_operation import guard_source_graph_operation


@guard_source_graph_operation("source")
async def append_rows(
    source,
    doc_id: str,
    content: bytes | str,
    filename: str,
    *,
    batch_size: int = 1000,
) -> dict:
    """FR-332/333 / AM-716/717:增量追加/更新——纯 upsert,**不删旧、不整档重建**。

    追加新行 = 新 entity_name 只加(老实体 entity_name 集合不动);更新行 = 同 entity_name
    覆盖属性,单节点幂等(重复执行不产生第二节点)。语义靠 LightRAG `ainsert_custom_kg`
    entity_name 去重保留最后 + 图存储 upsert 末次覆盖(单节点)。
    """
    result = await ingest_structured_document(
        source, doc_id, content, filename, batch_size=batch_size
    )
    result = dict(result)
    result["mode"] = "incremental_append"
    return result


@guard_source_graph_operation("source")
async def rebuild_document(
    source,
    doc_id: str,
    content: bytes | str,
    filename: str,
    *,
    batch_size: int = 1000,
) -> dict:
    """FR-335 / AM-719:全量重建——先删旧图贡献(`delete_document`)再重灌(与增量分明)。

    与 `append_rows` 的边界:重建**触发** `delete_document`(删旧)+ 重 ingest(重灌);
    增量**不触** delete(只 upsert)。两路语义不混。
    """
    await delete_document(source, doc_id)
    result = await ingest_structured_document(
        source, doc_id, content, filename, batch_size=batch_size
    )
    result = dict(result)
    result["mode"] = "full_rebuild"
    result["rebuilt"] = True
    return result


def _provenance_files(graph_data: dict | None) -> set[str]:
    """从实体 graph_data 的 file_path 拆出**多来源**集合(按 GRAPH_FIELD_SEP)。

    LightRAG 文本抽取按 `GRAPH_FIELD_SEP.join(file_paths)` 累积一个实体的多来源
    file_path(operate.py:1427)→ 拆分即得该实体全部 provenance 来源。
    """
    raw = str((graph_data or {}).get("file_path") or "")
    return {seg.strip() for seg in raw.split(GRAPH_FIELD_SEP) if seg.strip()}


@guard_source_graph_operation("source")
async def add_entity_provenance(source, entity_name: str, extra_file_path: str) -> list[str]:
    """记录**另一来源**贡献了该实体——把 extra_file_path 并入实体 provenance(去重)。

    复刻 LightRAG 文本+结构化共存时 file_path 的多来源累积(operate.py:1427),不经
    LLM。用于把一个实体从"独占"变"跨源共享"(AM-718 共享分支的真实 provenance 状态)。
    """
    rag = await get_lightrag(source)
    info = await rag.get_entity_info(entity_name)
    graph_data = dict(info.get("graph_data") or {})
    if not graph_data:
        raise ValueError(f"实体不存在,无法追加 provenance：{entity_name}")
    files = _provenance_files(graph_data)
    files.add(normalize_document_file_path(extra_file_path))
    merged = GRAPH_FIELD_SEP.join(sorted(files))
    graph_data["file_path"] = merged
    graph_data["entity_id"] = entity_name
    await rag.chunk_entity_relation_graph.upsert_node(entity_name, graph_data)
    return sorted(files)


@guard_source_graph_operation("source")
async def delete_row_entity(source, entity_name: str, *, owning_file_path: str) -> dict:
    """FR-334 / AM-718:删行实体——provenance 独占可回收 vs 跨源共享不擅删。

    - **独占**(provenance 仅 owning_file_path)→ `adelete_by_entity` 回收(实体计数 -1)。
    - **跨源共享**(provenance 含其他来源)→ **不擅删**,返回 needs_curation/shared 标记归治理(013)。

    provenance 判定真断:读 `get_entity_info().graph_data["file_path"]` 按 GRAPH_FIELD_SEP 拆
    多来源集合,减去本 CSV 后仍有其他来源即共享。
    """
    rag = await get_lightrag(source)
    owning = normalize_document_file_path(owning_file_path)
    info = await rag.get_entity_info(entity_name)
    graph_data = info.get("graph_data") or {}
    if not graph_data:
        return {"deleted": False, "reason": "not_found", "entity_name": entity_name}

    files = _provenance_files(graph_data)
    other_sources = files - {owning}
    if other_sources:
        # 跨源共享 → 不擅删,归治理需人审(013 curation)。
        return {
            "deleted": False,
            "shared": True,
            "needs_curation": True,
            "entity_name": entity_name,
            "provenance": sorted(files),
            "other_sources": sorted(other_sources),
        }

    # 独占本 CSV → 可回收。
    result = await rag.adelete_by_entity(entity_name)
    return {
        "deleted": True,
        "shared": False,
        "needs_curation": False,
        "entity_name": entity_name,
        "provenance": sorted(files),
        "result": result,
    }
