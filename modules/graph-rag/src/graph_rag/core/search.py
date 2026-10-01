import asyncio
import logging

from graph_rag.config import get_settings
from graph_rag.core.documents import get_readable_document
from graph_rag.core.errors import GraphRagError
from graph_rag.core.lightrag_service import query_source
from graph_rag.core.mode_router import resolve_mode
from graph_rag.core.sources import get_readable_source, list_readable_sources
from graph_rag.core.types import UserContext

logger = logging.getLogger("graph_rag")

SUPPORTED_QUERY_MODES = {"local", "global", "hybrid", "naive", "mix"}


def normalize_query(query: str) -> str:
    normalized = query.strip()
    if not normalized:
        raise ValueError("query 不能为空")
    if len(normalized) > 2000:
        raise ValueError("query 长度不能超过 2000 字符")
    return normalized


def _as_list(value: object) -> list:
    return list(value) if isinstance(value, list) else []


def _unwrap_structured(data: object) -> dict:
    """把 `aquery_data` 原生 envelope(`{status, message, data:{...}, metadata}`)
    解包为四结构化数组 + metadata。失败态(`data == {}`)与空结果均归一为空数组。"""
    envelope = data if isinstance(data, dict) else {}
    inner = envelope.get("data")
    inner = inner if isinstance(inner, dict) else {}
    return {
        "entities": _as_list(inner.get("entities")),
        "relationships": _as_list(inner.get("relationships")),
        "chunks": _as_list(inner.get("chunks")),
        "references": _as_list(inner.get("references")),
        "metadata": envelope.get("metadata") if isinstance(envelope.get("metadata"), dict) else {},
    }


SCHEMA_VERSION = 2


def _synthesize_context_shim(structured: dict) -> str:
    """011 AC-3 兼容 shim(§5.2,**deprecated**)：由结构化数组(entities/relationships/
    chunks)合成可读文本 `context`，仅供旧调用方(`platform-store.ts:3049` `item.context`)
    过渡。**非证据来源**——证据是结构化数组;编排层迁移到结构化消费后单开收尾移除(§13-2)。
    file_path 可空(012 接缝)不参与合成、不崩。"""
    lines: list[str] = []
    for entity in structured["entities"]:
        name = entity.get("entity_name") or entity.get("name") or ""
        description = entity.get("description") or ""
        text = f"[实体] {name}：{description}".strip("：").rstrip()
        if name or description:
            lines.append(text)
    for relationship in structured["relationships"]:
        src = relationship.get("src_id") or relationship.get("source") or ""
        tgt = relationship.get("tgt_id") or relationship.get("target") or ""
        description = relationship.get("description") or ""
        if src or tgt or description:
            lines.append(f"[关系] {src} → {tgt}：{description}".rstrip("：").rstrip())
    for chunk in structured["chunks"]:
        content = chunk.get("content") or ""
        if content:
            lines.append(f"[片段] {content}")
    return "\n".join(lines)


def has_structured_evidence(structured: dict) -> bool:
    """011 G-1 空证据判定(去魔法串)：证据 = **结构化三数组合取**——
    entities/relationships/chunks 任一非空即有证据（§7.2：naive 纯向量下
    entities/relationships 为空、chunks 非空仍算有证据，故用合取而非只看 entities）。
    不再靠 LightRAG 内部返回文案的字符串包含判断来猜空(旧 has_evidence_context 魔法串已删)。"""
    return bool(structured["entities"] or structured["relationships"] or structured["chunks"])


async def search(
    user: UserContext,
    query: str,
    limit: int = 10,
    *,
    source_id: str | None = None,
    mode: str = "mix",
    mode_source: str = "request",
    conversation_history: list | None = None,
    chunk_top_k: int | None = None,
    max_total_tokens: int | None = None,
    enable_rerank: bool | None = None,
) -> dict:
    normalized_query = normalize_query(query)
    normalized_limit = max(1, min(int(limit), 30))
    settings = get_settings()
    # 011 T4(FR-313/314/315):精细化 QueryParam 旋钮从管理员高级配置读取。
    #   None = 不覆盖库默认(chunk_top_k 则派生自 top_k=limit;max_total_tokens/enable_rerank 用库默认)。
    #   max_entity_tokens/max_relation_tokens **无配置项**——定死取库默认(FR-314 判决)。
    #   生成端领域指令(注入生成 prompt 的旋钮)**不在检索路径构造**——检索端点无生成语义,防提示注入(FR-317)。
    #   仅当旋钮/入参非 None 时才透传给 query_source(None = 不覆盖库默认;也保持既有调用契约稳定)。
    # P22-P2:入参优先——入参非 None 用入参(平台 per-engine config),否则落 settings.graph_*(011 T4 env 兜底),再落库默认。
    query_param_overrides: dict = {}
    _chunk_top_k = chunk_top_k if chunk_top_k is not None else getattr(settings, "graph_chunk_top_k", None)
    if _chunk_top_k is not None:
        query_param_overrides["chunk_top_k"] = _chunk_top_k
    _max_total_tokens = max_total_tokens if max_total_tokens is not None else getattr(settings, "graph_max_total_tokens", None)
    if _max_total_tokens is not None:
        query_param_overrides["max_total_tokens"] = _max_total_tokens
    _enable_rerank = enable_rerank if enable_rerank is not None else getattr(settings, "graph_enable_rerank", None)
    if _enable_rerank is not None:
        query_param_overrides["enable_rerank"] = _enable_rerank
    if conversation_history is not None:
        query_param_overrides["conversation_history"] = conversation_history
    # 011 T3(FR-308/309/312):mode 路由最小接线。admin 旋钮(graph_query_mode)非 auto → 覆盖;
    # 调用方传 mode=="auto" → 按问题路由。否则(存量显式 mode)保持既有行为不变(不触网络/LLM)。
    admin_mode = getattr(settings, "graph_query_mode", "auto")
    if admin_mode != "auto" or mode == "auto":
        mode, mode_source, _matched_rule = await resolve_mode(
            normalized_query, request_mode=mode, admin_mode=admin_mode
        )
    normalized_mode = mode if mode in SUPPORTED_QUERY_MODES else "mix"
    sources = [await get_readable_source(user, source_id)] if source_id else await list_readable_sources(user)
    sources = sources[: settings.query_max_sources]  # C-A2：全域 fan-out 硬上限

    sem = asyncio.Semaphore(settings.query_concurrency)
    degraded: list[str] = []

    async def _query_one(source):
        # C-A2：单 source wait_for 超时守卫 + 失败降级（fail-open），一个坏 source 不拖垮整个全域问答。
        # 011 AC-9：降级 = 该 source 计入 degraded + 返回结构化空集(不进 results)，
        # **绝不回退到 only_need_context 文本 blob**——那会复辟被替换的旧路径。
        async with sem:
            try:
                raw = await asyncio.wait_for(
                    query_source(
                        source,
                        normalized_query,
                        mode=normalized_mode,
                        limit=normalized_limit,
                        **query_param_overrides,
                    ),
                    timeout=settings.query_timeout_seconds,
                )
            except asyncio.TimeoutError:
                logger.warning("graph query timeout: source=%s", source.id)
                degraded.append(source.id)
                return None
            except GraphRagError as exc:
                if source_id and exc.code in {"source_unavailable", "conflict", "not_found"}:
                    raise
                logger.exception("graph query failed: source=%s", source.id)
                degraded.append(source.id)
                return None
            except Exception:
                logger.exception("graph query failed: source=%s", source.id)
                degraded.append(source.id)
                return None
            structured = _unwrap_structured(raw)
            if has_structured_evidence(structured):
                return {
                    "source_id": source.id,
                    "source_name": source.name,
                    "source_kind": source.kind,
                    "workspace": source.workspace,
                    "mode": normalized_mode,
                    "entities": structured["entities"],
                    "relationships": structured["relationships"],
                    "chunks": structured["chunks"],
                    "references": structured["references"],
                    "metadata": structured["metadata"],
                    # AC-3 兼容 shim(deprecated)：由结构化数组合成，旧调用方读 context 不崩。
                    "context": _synthesize_context_shim(structured),
                }
            return None

    # 异源审(deepseek)三验后定案：gather 故意不用 return_exceptions=True。_query_one 已 except Exception
    # 兜住 source 级失败(fail-open 记 degraded)；唯一能逃逸的 BaseException=CancelledError 只在整个 search 被
    # 外部取消时出现，此时传播取消、取消其它 source 正是正确语义。return_exceptions=True 反会吞掉取消。
    gathered = await asyncio.gather(*[_query_one(source) for source in sources])
    results = [item for item in gathered if item is not None][:normalized_limit]
    # 011 G-1 空态结构化判定(去魔法串)：results 空 → 给结构化 empty_reason 区分「都空」与「都降级」。
    empty_reason = None
    if not results:
        empty_reason = "all_degraded" if sources and len(degraded) == len(sources) else "all_sources_empty"
    return {
        "query": normalized_query,
        "results": results,
        "limit": normalized_limit,
        "schema_version": SCHEMA_VERSION,  # AC-3：消费方据此择路(v2 结构化数组)。
        "mode": normalized_mode,  # 生效 mode(路由/配置后)。
        "mode_source": mode_source,  # request/admin_fixed/rule/llm/fallback(FR-311)。
        "degraded_sources": degraded,
        "empty_reason": empty_reason,
    }


async def ask(
    user: UserContext,
    query: str,
    limit: int = 10,
    *,
    source_id: str | None = None,
    mode: str = "mix",
    mode_source: str = "request",
    conversation_history: list | None = None,
    chunk_top_k: int | None = None,
    max_total_tokens: int | None = None,
    enable_rerank: bool | None = None,
) -> dict:
    result = await search(
        user, query, limit, source_id=source_id, mode=mode, mode_source=mode_source,
        conversation_history=conversation_history,
        chunk_top_k=chunk_top_k,
        max_total_tokens=max_total_tokens,
        enable_rerank=enable_rerank,
    )
    return {
        "query": result["query"],
        "answer": "",
        "citations": result["results"],
        "schema_version": result["schema_version"],
        "mode": result["mode"],
        "mode_source": result["mode_source"],
        "empty_reason": result["empty_reason"],
        "degraded_sources": result.get("degraded_sources", []),
        "note": "GraphRAG MCP/HTTP 返回检索依据；最终回答由 Agent 基于依据生成。",
    }


async def get_document_context(user: UserContext, document_id: str) -> dict:
    document = await get_readable_document(user, document_id)
    return {
        "id": document.id,
        "source_id": document.source_id,
        "original_filename": document.original_filename,
        "file_type": document.file_type,
        "status": document.status,
        "metadata": document.metadata,
        "content_text": document.content_text,
        "created_at": document.created_at.isoformat(),
        "updated_at": document.updated_at.isoformat(),
    }
