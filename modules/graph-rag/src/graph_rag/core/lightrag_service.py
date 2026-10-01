import asyncio
import inspect
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse

from graph_rag.config import get_settings
from graph_rag.core.errors import GraphRagError
from graph_rag.core.graph_limits import MAX_GRAPH_NODES
from graph_rag.core.neo4j_boundary import (
    assert_neo4j_config_valid,
    project_neo4j_environment,
)
from graph_rag.core.sources import GraphSource, _get_source_by_id_raw
from graph_rag.core.source_operation import guard_source_graph_operation
from graph_rag.db import get_database_url

logger = logging.getLogger("graph_rag")

_instances: dict[str, object] = {}
_DELETION_CAPABILITY = object()


@dataclass(frozen=True)
class _DeletionCapability:
    token: object
    source_id: str
    workspace: str
    attempt: int
    lock_connection: object

# 023 迁移·HNSW 维度守卫:pgvector HNSW 索引对 vector 类型有 2000 维上限,超限会导致向量表
# 建不出 HNSW 索引、检索退化成全表扫("入库成功但检索废")。fail-loud,越早拦截越好。
_PGVECTOR_HNSW_MAX_DIM = 2000


def _assert_hnsw_dimension_supported(dimensions: int) -> None:
    if dimensions > _PGVECTOR_HNSW_MAX_DIM:
        raise RuntimeError(
            f"EMBEDDING_DIMENSIONS={dimensions} 超过 pgvector HNSW 上限 {_PGVECTOR_HNSW_MAX_DIM} 维:"
            f"向量表将无法建 HNSW 索引(检索退化全表扫)。请降维(EMBEDDING_DIMENSIONS<=2000,推荐 1024)后重嵌。"
        )

# 013 T5(FR-357 / AM-1318):per-workspace 冷启动锁——锁字典 key=workspace,取代原全局单锁。
# 同 workspace 并发冷启动仍双检串行(建单实例防重复);不同 workspace 冷启动**可并发**
# (各自锁,不再全局串行);热路径(已缓存)提前返回,**不进锁**(锁 acquire=0)。
_workspace_locks: dict[str, asyncio.Lock] = {}
# A lock-free hot lookup must not hand out an instance after its close has
# started. Membership is checked before the normal cache return. The marker is
# deliberately retained after a close failure, quarantining the cached object
# until an explicit forget/finalize retry succeeds.
_evicting_workspaces: set[str] = set()

# LightRAG 1.5.0's aggregate finalizer catches and logs each storage exception,
# then returns success. Keep the locked version's exact storage inventory here
# so application lifecycle code can observe failures and retry only unfinished
# members. This tuple is covered by a lock-version regression test.
_LIGHTRAG_STORAGE_ATTRS = (
    "full_docs",
    "text_chunks",
    "full_entities",
    "full_relations",
    "entity_chunks",
    "relation_chunks",
    "entities_vdb",
    "relationships_vdb",
    "chunks_vdb",
    "chunk_entity_relation_graph",
    "llm_response_cache",
    "doc_status",
)


def _get_workspace_lock(workspace: str) -> asyncio.Lock:
    """取(或惰性建)某 workspace 的冷启动锁。**仅冷启动路径调用**——热路径缓存命中在
    `get_lightrag` 入口提前返回,不进本函数=不 acquire 任何锁(AM-1318 热路径锁 acquire=0)。

    单线程 asyncio 下 dict 的 get-then-set 之间无 await 不被抢占,故取/建锁本身天然原子、
    无需再套 guard 锁(也避免模块级 guard 跨 event loop 复用报错);per-ws 锁在其所属 loop 内
    首次 acquire 时才绑定 loop。构造串行只发生在同 workspace(共享同一把锁),不同 workspace
    各自锁 → 冷启动不再全局串行。"""
    lock = _workspace_locks.get(workspace)
    if lock is None:
        lock = asyncio.Lock()
        _workspace_locks[workspace] = lock
    return lock


def _require(value: str | None, name: str) -> str:
    if not value:
        raise GraphRagError(f"{name} is not configured", "config_error")
    return value


def _configure_postgres_env() -> None:
    parsed = urlparse(get_database_url())
    os.environ["POSTGRES_HOST"] = parsed.hostname or "127.0.0.1"
    os.environ["POSTGRES_PORT"] = str(parsed.port or 5432)
    os.environ["POSTGRES_USER"] = unquote(parsed.username or "")
    os.environ["POSTGRES_PASSWORD"] = unquote(parsed.password or "")
    os.environ["POSTGRES_DATABASE"] = unquote(parsed.path.lstrip("/"))
    os.environ.setdefault("POSTGRES_VECTOR_INDEX_TYPE", "HNSW")


def _load_lightrag_symbols():
    try:
        from lightrag import LightRAG, QueryParam
        from lightrag.llm.openai import openai_complete_if_cache, openai_embed
        from lightrag.utils import EmbeddingFunc
    except Exception as exc:
        raise GraphRagError(
            "LightRAG Core 未安装或不可用，请安装 lightrag-hku 并确认 Python 环境",
            "config_error",
        ) from exc
    return LightRAG, QueryParam, openai_complete_if_cache, openai_embed, EmbeddingFunc


def _working_dir() -> str:
    path = Path(os.getenv("GRAPH_RAG_WORKING_DIR", ".graph-rag-workdir")).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def _resolve_source_addon_params(source: GraphSource) -> dict | None:
    """012 FR-320/322:解析 source 绑定的 schema profile → LightRAG addon_params。

    未绑定 / generic(出厂 fallback)/ 未知 profile → None(不注入 addon_params,出厂默认)。
    绑定 domain profile → {"entity_types_guidance": ..., "entity_extraction_examples": [...]}。
    """
    from graph_rag.core.domain_profiles import (
        build_addon_params,
        get_source_schema_profile_id,
    )

    source_id = getattr(source, "id", None)
    if not source_id:
        return None
    profile_id = get_source_schema_profile_id(source_id)
    return build_addon_params(profile_id)


async def _llm_model_func(prompt: str, system_prompt: str | None = None, history_messages: list | None = None, **kwargs):
    settings = get_settings()
    _, _, openai_complete_if_cache, _, _ = _load_lightrag_symbols()
    return await openai_complete_if_cache(
        _require(settings.agent_model, "AGENT_MODEL"),
        prompt,
        system_prompt=system_prompt,
        history_messages=history_messages or [],
        api_key=_require(settings.agent_api_key, "AGENT_API_KEY"),
        base_url=_require(settings.agent_base_url, "AGENT_BASE_URL"),
        **kwargs,
    )


async def _embedding_func(texts: list[str]):
    settings = get_settings()
    _, _, _, openai_embed, _ = _load_lightrag_symbols()
    return await openai_embed.func(
        texts,
        model=_require(settings.embedding_model, "EMBEDDING_MODEL"),
        api_key=_require(settings.embedding_api_key, "EMBEDDING_API_KEY"),
        base_url=_require(settings.embedding_base_url, "EMBEDDING_BASE_URL"),
        embedding_dim=settings.embedding_dimensions,
        max_token_size=8192,
    )


async def _assert_persisted_source_active(source: GraphSource) -> None:
    persisted = await _get_source_by_id_raw(source.id)
    if persisted is None:
        raise GraphRagError("source 不存在", "not_found")
    if persisted.delete_state != "active":
        raise GraphRagError("source 正在删除或删除失败，当前不可用", "source_unavailable")


async def get_lightrag(source: GraphSource):
    # Preserve the pre-existing entry contract: an invalid vector dimension is
    # rejected even before a cache hit or source-state database access.
    _assert_hnsw_dimension_supported(get_settings().embedding_dimensions)
    await _assert_persisted_source_active(source)
    return await _get_lightrag_unchecked(source)


async def _get_lightrag_unchecked(source: GraphSource):
    settings = get_settings()
    # 023 迁移:维度是全局配置,越早 fail 越好;缓存命中也不该绕过守卫。
    _assert_hnsw_dimension_supported(settings.embedding_dimensions)
    # Stage 1: this boundary is intentionally before the cache lookup.  A warm
    # instance must never bypass a forbidden LightRAG workspace override.
    assert_neo4j_config_valid(settings)
    project_neo4j_environment(settings)

    cached = _instances.get(source.workspace)
    if cached is not None and source.workspace not in _evicting_workspaces:
        return cached  # 热路径:缓存命中提前返回,不进任何锁(AM-1318 锁 acquire=0)。

    # C-A2 必修（codex·高）：无锁 check-then-set 在并发冷启动同一 workspace 会建多个实例、
    # 缓存赋值竞争。013 T5(FR-357):改 per-workspace 锁字典双检——同 workspace 冷启动串行
    # (建单实例),不同 workspace 冷启动各自锁**可并发**(不再全局串行);热路径不进锁。
    lock = _get_workspace_lock(source.workspace)
    async with lock:
        cached = _instances.get(source.workspace)
        if cached is not None:
            if source.workspace in _evicting_workspaces:
                raise GraphRagError(
                    "LightRAG workspace finalization is incomplete; retry cleanup before reuse",
                    "lightrag_finalization_incomplete",
                )
            return cached

        LightRAG, _, _, _, EmbeddingFunc = _load_lightrag_symbols()
        _configure_postgres_env()

        kwargs: dict[str, object] = dict(
            working_dir=_working_dir(),
            workspace=source.workspace,
            llm_model_func=_llm_model_func,
            llm_model_name=_require(settings.agent_model, "AGENT_MODEL"),
            embedding_func=EmbeddingFunc(
                embedding_dim=settings.embedding_dimensions,
                max_token_size=8192,
                func=_embedding_func,
                model_name=_require(settings.embedding_model, "EMBEDDING_MODEL"),
            ),
            kv_storage="PGKVStorage",
            vector_storage="PGVectorStorage",
            doc_status_storage="PGDocStatusStorage",
            graph_storage="Neo4JStorage",
            max_graph_nodes=MAX_GRAPH_NODES,
        )
        # 012 FR-320/322:按 source 绑定的 schema profile 注入 addon_params(领域类型集 + few-shot)。
        # 未绑定 / generic(出厂 fallback)→ 无 domain 参数。
        # 语言约束(补):LightRAG 默认 DEFAULT_SUMMARY_LANGUAGE=None，抽取 prompt 的 {language} 无约束时，
        # LLM 对中文文档会中英混抽(实体名中文、部分关系描述抽成英文)，致中文 query 检索中英边不一致、
        # 答案时对时错。无条件把抽取语言锁为简体中文(不管有无 domain profile)，消除中英混抽。
        # domain 参数若显式设了 language 则以其为准(当前 build_addon_params 不设，故恒为简体中文)。
        addon_params = {"language": "简体中文", **(_resolve_source_addon_params(source) or {})}
        kwargs["addon_params"] = addon_params

        rag = LightRAG(**kwargs)
        await rag.initialize_storages()
        _instances[source.workspace] = rag
        return rag


async def get_lightrag_for_ingest(source: GraphSource, document_id: str, lease):
    from graph_rag.core.documents import validate_ingest_lease

    validate_ingest_lease(lease, source, document_id)
    return await _get_lightrag_unchecked(source)


def _issue_deletion_capability(
    source: GraphSource,
    lock_connection: object,
) -> _DeletionCapability:
    """Mint a deletion capability bound to one claimed source generation/session."""
    return _DeletionCapability(
        token=_DELETION_CAPABILITY,
        source_id=source.id,
        workspace=source.workspace,
        attempt=source.delete_attempts,
        lock_connection=lock_connection,
    )


async def _get_lightrag_for_deletion(source: GraphSource, capability):
    if (
        not isinstance(capability, _DeletionCapability)
        or capability.token is not _DELETION_CAPABILITY
        or capability.source_id != source.id
        or capability.workspace != source.workspace
        or capability.attempt != source.delete_attempts
        or capability.lock_connection is None
    ):
        raise GraphRagError("非法的删除存储访问", "source_unavailable")
    try:
        with capability.lock_connection.cursor() as cursor:
            cursor.execute("SELECT 1 AS alive")
            alive = cursor.fetchone()["alive"]
        capability.lock_connection.commit()
    except Exception:
        raise GraphRagError("删除执行器锁会话已失效", "source_unavailable") from None
    if alive != 1:
        raise GraphRagError("删除执行器锁会话已失效", "source_unavailable")
    cached = _instances.get(source.workspace)
    if cached is not None:
        # A graph-step retry must be able to finish a quarantined, partially
        # finalized identity. Ordinary callers remain blocked by the sentinel.
        return cached
    return await _get_lightrag_unchecked(source)


def _build_query_param(
    QueryParam,
    *,
    mode: str,
    top_k: int,
    chunk_top_k: int | None = None,
    max_total_tokens: int | None = None,
    enable_rerank: bool | None = None,
    conversation_history: list | None = None,
):
    """011 T4(FR-313/314/315/316/317):把精细化旋钮接线进 LightRAG `QueryParam`。

    - top_k 承接 009「取证范围」(= search 的 limit),每源检索深度(语义声明·存疑登记)。
    - chunk_top_k 缺省**派生自 top_k**(未单独配 → chunk_top_k==top_k),配了则覆盖(FR-313)。
    - max_total_tokens **可配**;max_entity_tokens/max_relation_tokens **定死取库默认**——
      011 刻意不覆盖(不在此构造 kwargs 出现),QueryParam 用库默认值(FR-314)。
    - enable_rerank 可配(None=库默认);告警不静默的判定在 query_source 里(FR-315)。
    - conversation_history 结构 passthrough(FR-316,仅供 LLM 生成、不评测检索增益)。
    - **user_prompt 刻意不构造**——检索端点不接受 user_prompt 注入(FR-317 防提示注入)。
    """
    kwargs: dict[str, object] = {"mode": mode, "top_k": top_k}
    # FR-313:chunk_top_k 未单独配 → 派生自 top_k(非取库默认 20,随取证范围联动)。
    kwargs["chunk_top_k"] = chunk_top_k if chunk_top_k is not None else top_k
    if max_total_tokens is not None:
        kwargs["max_total_tokens"] = max_total_tokens
    # max_entity_tokens / max_relation_tokens:011 不设 → 保留 QueryParam 库默认(FR-314 判决)。
    if enable_rerank is not None:
        kwargs["enable_rerank"] = enable_rerank
    if conversation_history is not None:
        kwargs["conversation_history"] = conversation_history
    return QueryParam(**kwargs)


@guard_source_graph_operation("source")
async def query_source(
    source: GraphSource,
    query: str,
    *,
    mode: str = "mix",
    limit: int = 10,
    chunk_top_k: int | None = None,
    max_total_tokens: int | None = None,
    enable_rerank: bool | None = None,
    conversation_history: list | None = None,
) -> dict:
    """011 T1(G-1 结构化切换)：走 `aquery_data` 返回 LightRAG 原生结构化 dict
    `{status, message, data:{entities[],relationships[],chunks[],references[]}, metadata}`，
    停在 LLM 生成之前(纯检索)。**不再走 `aquery(only_need_context=True)` 文本 blob 路径**——
    该旧路径返回不可枚举的文本 blob，与结构化契约(§5 schema v2)相悖，故彻底替换、不作降级回退。

    011 T4:精细化 QueryParam 接线(top_k/chunk_top_k/max_total_tokens/enable_rerank/
    conversation_history);user_prompt 不暴露(FR-317)。"""
    rag = await get_lightrag(source)
    _, QueryParam, _, _, _ = _load_lightrag_symbols()
    param = _build_query_param(
        QueryParam,
        mode=mode,
        top_k=limit,
        chunk_top_k=chunk_top_k,
        max_total_tokens=max_total_tokens,
        enable_rerank=enable_rerank,
        conversation_history=conversation_history,
    )
    # 011 AC-7 / FR-315:enable_rerank 生效为 True 但该实例未配 rerank 模型 →
    # **显式告警不静默**(明确态:请求重排但无模型 → 本次不重排、显式降级),
    # 与第一轮 P1-6 韧性可见一致;绝不静默忽略把"没做重排"藏起来。
    if param.enable_rerank and getattr(rag, "rerank_model_func", None) is None:
        logger.warning(
            "graph rerank requested but no rerank model configured: source=%s "
            "(enable_rerank=True, rerank_model_func unset) — retrieval proceeds WITHOUT rerank (explicit degrade, not silent)",
            getattr(source, "id", "?"),
        )
    return await rag.aquery_data(query, param=param)


async def insert_document(
    source: GraphSource,
    document_id: str,
    text: str,
    *,
    file_path: str | None = None,
    track_id: str | None = None,
    _lease=None,
) -> str | None:
    """012 T5(AM-720 / FR-336):文本入图侧透传 `file_paths` + `track_id` 到 LightRAG `ainsert`。

    - **file_paths(贯通 011)**:传入源文件锚点(= 文档 original_filename),非空非占位——
      落地 011 AC-11/FR-336"实体带 file_path 锚点可溯源"的入图侧兑现(011 AM-316 占位可空的对偶)。
      **缺省/空则不传该 kwarg**(命中=0),不硬塞占位串。
    - **track_id(FR-337)**:传入批次/文档追踪 id,透传到 ainsert 供处理状态追踪(AM-721 持久化)。
    - 旧版 LightRAG 不接受 file_paths/track_id → TypeError 降级为最小签名(向后兼容,不静默丢)。
    """
    rag = (
        await get_lightrag_for_ingest(source, document_id, _lease)
        if _lease is not None
        else await get_lightrag(source)
    )
    kwargs: dict[str, object] = {"ids": [document_id]}
    if file_path:
        kwargs["file_paths"] = [file_path]
    if track_id:
        kwargs["track_id"] = track_id
    try:
        return await rag.ainsert(text, **kwargs)
    except TypeError:
        return await rag.ainsert(text)


async def get_doc_status(source: GraphSource, document_id: str, *, _lease=None) -> str | None:
    """I105：查询单篇文档在 LightRAG 内的权威处理状态(pending/processing/processed/failed)。

    ainsert() 的返回时机不等于本文档处理完成——批量并发下抢到 runner 的协程要排干
    整条队列才返回，其他协程设 pending 后早返回。调用方(process_document_ingest)
    必须轮询这里判断 ready/failed，不能依赖 insert_document 协程本身的返回。
    """
    rag = (
        await get_lightrag_for_ingest(source, document_id, _lease)
        if _lease is not None
        else await get_lightrag(source)
    )
    statuses = await rag.aget_docs_by_ids([document_id])
    status_doc = statuses.get(document_id)
    if status_doc is None:
        return None
    # PGDocStatusStorage.get_by_id 实际返回 plain dict(见 lightrag postgres_impl.py)，
    # 尽管 aget_docs_by_ids 的类型注解写的是 DocProcessingStatus 对象；两种形态都接住。
    status = status_doc.get("status") if isinstance(status_doc, dict) else getattr(status_doc, "status", None)
    return status.value if hasattr(status, "value") else status


@guard_source_graph_operation("source")
async def delete_document(source: GraphSource, document_id: str) -> None:
    rag = await get_lightrag(source)
    delete = getattr(rag, "adelete_by_doc_id", None)
    if not delete:
        raise GraphRagError("当前 LightRAG 版本不支持按 document id 删除", "config_error")
    await delete(document_id)


async def _finalize_storage_members(rag: object) -> None:
    """Finalize each LightRAG storage without the 1.5.0 swallowing wrapper.

    Successful member identities are retained on the instance so a retry after
    partial failure does not double-close them. If the object is a lightweight
    test double without real storage members, fall back to its aggregate
    ``finalize_storages`` method.
    """
    completed = getattr(rag, "_ff_finalized_storage_ids", None)
    if completed is None:
        completed = set()
        try:
            setattr(rag, "_ff_finalized_storage_ids", completed)
        except AttributeError:
            # Lightweight immutable sentinels have no storage members and no
            # aggregate finalizer; they can be evicted without inventing state.
            pass

    seen: set[int] = set()
    found_member = False
    failures: list[Exception] = []
    for attr_name in _LIGHTRAG_STORAGE_ATTRS:
        storage = getattr(rag, attr_name, None)
        finalize = getattr(storage, "finalize", None)
        if storage is None or finalize is None:
            continue
        storage_id = id(storage)
        if storage_id in seen or storage_id in completed:
            continue
        seen.add(storage_id)
        found_member = True
        try:
            result = finalize()
            if inspect.isawaitable(result):
                await result
        except Exception as exc:
            failure = RuntimeError(f"LightRAG storage finalize failed: {attr_name}")
            failure.__cause__ = exc
            failures.append(failure)
        else:
            completed.add(storage_id)

    if failures:
        raise ExceptionGroup("one or more LightRAG storages failed to finalize", failures)
    if found_member:
        return

    finalize = getattr(rag, "finalize_storages", None)
    if finalize is not None:
        result = finalize()
        if inspect.isawaitable(result):
            await result


async def _shutdown_instance_queues(rag: object) -> None:
    """Stop the per-instance LightRAG worker queues before evicting it.

    LightRAG 1.5.0 finalizes storages but does not shut down its embedding,
    rerank, or role-specific LLM priority workers. Leaving those tasks bound to
    a closing event loop produces noisy shutdown failures and retains instance
    resources after the Neo4j Driver has been closed.
    """
    completed = getattr(rag, "_ff_shutdown_queue_ids", None)
    if completed is None:
        completed = set()
        try:
            setattr(rag, "_ff_shutdown_queue_ids", completed)
        except AttributeError:
            pass

    candidates: list[object] = []
    embedding = getattr(rag, "embedding_func", None)
    if embedding is not None:
        candidates.append(getattr(embedding, "func", embedding))
    rerank = getattr(rag, "rerank_model_func", None)
    if rerank is not None:
        candidates.append(rerank)
    role_states = getattr(rag, "_role_llm_states", None)
    if isinstance(role_states, dict):
        candidates.extend(
            wrapped
            for state in role_states.values()
            if (wrapped := getattr(state, "wrapped", None)) is not None
        )

    failures: list[Exception] = []
    for candidate in candidates:
        candidate_id = id(candidate)
        shutdown = getattr(candidate, "shutdown", None)
        if candidate_id in completed or not callable(shutdown):
            continue
        try:
            result = shutdown(graceful=True)
            if inspect.isawaitable(result):
                await result
        except Exception as exc:
            failure = RuntimeError("LightRAG async queue shutdown failed")
            failure.__cause__ = exc
            failures.append(failure)
        else:
            completed.add(candidate_id)

    retired_waiter = getattr(rag, "wait_for_retired_llm_queues", None)
    if callable(retired_waiter):
        try:
            result = retired_waiter()
            if inspect.isawaitable(result):
                await result
        except Exception as exc:
            failure = RuntimeError("LightRAG retired LLM queue shutdown failed")
            failure.__cause__ = exc
            failures.append(failure)

    if failures:
        raise ExceptionGroup("one or more LightRAG queues failed to shut down", failures)


async def _finalize_instance_resources(rag: object) -> None:
    failures: list[Exception] = []
    for finalizer in (_finalize_storage_members, _shutdown_instance_queues):
        try:
            await finalizer(rag)
        except Exception as exc:
            failures.append(exc)
    if len(failures) == 1:
        raise failures[0]
    if failures:
        raise ExceptionGroup("one or more LightRAG resources failed to finalize", failures)


async def _finalize_cached_instance_locked(workspace: str) -> bool:
    """Finalize one cached instance while its caller owns the workspace lock.

    The cache entry remains reachable until finalization succeeds.  A close
    failure is therefore fail-loud and retryable instead of silently losing
    the only handle to a live Neo4j driver.
    """
    rag = _instances.get(workspace)
    if rag is None:
        _evicting_workspaces.discard(workspace)
        return False

    _evicting_workspaces.add(workspace)
    try:
        await _finalize_instance_resources(rag)

        # The workspace lock makes replacement through get_lightrag/forget
        # paths impossible. Keep the identity guard for defensive correctness.
        if _instances.get(workspace) is rag:
            _instances.pop(workspace, None)
        _evicting_workspaces.discard(workspace)
        return True
    except BaseException:
        # Keep the marker set: the object may own a live/partially closed
        # Driver and must not re-enter the lock-free hot path. A later explicit
        # forget/finalize call retries this same cached identity.
        raise


async def forget_lightrag_instance(workspace: str) -> bool:
    """Finalize and evict one workspace instance, idempotently.

    This lock is shared with the cold-start path, so an in-flight constructor
    cannot write an obsolete instance back after eviction. Concurrent evictors
    serialize and only the first one finalizes the cached instance.
    """
    async with _get_workspace_lock(workspace):
        return await _finalize_cached_instance_locked(workspace)


@guard_source_graph_operation("source_id")
async def set_schema_profile_and_forget(workspace: str, source_id: str, profile_id: str | None) -> None:
    """Validate, finalize/evict, then persist a schema-profile rebinding.

    The whole state transition owns the workspace cold-start lock. An eviction
    sentinel diverts new hot-cache callers to that lock while finalization is
    running. A finalize failure retains the old instance and leaves the DB
    binding unchanged; a DB failure happens only after the old instance has
    been safely closed and removed.

    profile_id=None 解绑（落回出厂默认）；未知 profile 在任何生命周期变更前抛出
    invalid_schema_profile.
    """
    from graph_rag.core.domain_profiles import get_profile, set_source_schema_profile

    # Validate without mutating the database.  This avoids closing a healthy
    # instance for a request that can never be committed.
    if profile_id is not None and get_profile(profile_id) is None:
        raise GraphRagError(f"未知的 schema profile: {profile_id}", "invalid_schema_profile")

    async with _get_workspace_lock(workspace):
        # Close first, remove only on success, then commit the new binding. If
        # the DB write fails, the next request safely reconstructs from the old
        # persisted binding rather than reusing an obsolete live instance.
        await _finalize_cached_instance_locked(workspace)
        set_source_schema_profile(source_id, profile_id)


async def finalize_lightrag_instances() -> None:
    failures: list[Exception] = []
    # Snapshot keys, then reuse the same per-workspace lock and idempotent
    # helper as targeted eviction.  Every snapshot entry is attempted even if
    # another one fails; failed entries remain cached for diagnosis/retry.
    for workspace in tuple(_instances):
        try:
            await forget_lightrag_instance(workspace)
        except Exception as exc:
            failure = RuntimeError(f"LightRAG workspace finalize failed: {workspace}")
            failure.__cause__ = exc
            failures.append(failure)
    if failures:
        raise ExceptionGroup("one or more LightRAG instances failed to finalize", failures)
