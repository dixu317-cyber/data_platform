import asyncio
import json
import logging
from dataclasses import dataclass
from hashlib import sha256
from pathlib import PurePath
from uuid import uuid4

from graph_rag.config import get_settings
from graph_rag.core.errors import GraphRagError
from graph_rag.core.lightrag_service import delete_document, get_doc_status, insert_document
from graph_rag.core.sources import (
    GraphSource,
    assert_can_manage_source,
    assert_can_read_source,
    get_source_by_id,
    map_source,
)
from graph_rag.core.types import UserContext
from graph_rag.db import get_connection

DocumentStatus = str

EXTENSION_TO_FILE_TYPE = {
    ".md": "markdown",
    ".markdown": "markdown",
    ".txt": "txt",
    # 012 FR-326:CSV/表格结构化入图。.csv/.xlsx 不再报 unsupported，路由到结构化入图路径
    # (ainsert_custom_kg 直灌，不过 LLM)；未知后缀仍诚实拒收。
    ".csv": "csv",
    ".xlsx": "xlsx",
}

# 012 FR-326/329:结构化文件类型(表格行列语义确定 → custom_kg 直灌，区别于 md/txt 的 LLM 文本抽取)。
STRUCTURED_FILE_TYPES = frozenset({"csv", "xlsx"})


def is_structured_file_type(file_type: str) -> bool:
    """012:该 file_type 是否走结构化入图路径(csv/xlsx → ainsert_custom_kg 直灌)。

    markdown/txt/text → False(仍走 LLM 文本抽取路径)。
    """
    return file_type in STRUCTURED_FILE_TYPES


@dataclass(frozen=True)
class GraphDocument:
    id: str
    source_id: str
    original_filename: str
    file_type: str
    status: DocumentStatus
    content_hash: str | None
    content_text: str
    metadata: dict
    uploaded_by: str
    created_at: object
    updated_at: object
    archived_at: object | None


@dataclass(frozen=True)
class DocumentAdmission:
    document: GraphDocument
    source: GraphSource
    created_new: bool


@dataclass(frozen=True)
class IngestLease:
    source_id: str
    workspace: str
    document_id: str
    _token: object


def map_document(row: dict) -> GraphDocument:
    return GraphDocument(
        id=row["id"],
        source_id=row["source_id"],
        original_filename=row["original_filename"],
        file_type=row["file_type"],
        status=row["status"],
        content_hash=row["content_hash"],
        content_text=row["content_text"],
        metadata=row["metadata"],
        uploaded_by=row["uploaded_by"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        archived_at=row["archived_at"],
    )


def safe_original_filename(filename: str) -> str:
    base = PurePath(filename).name.strip()
    if not base:
        return "document.txt"
    safe = "".join(char if char.isalnum() or char in {".", "_", "-", " ", "(", ")"} else "_" for char in base)
    return safe[:180] or "document.txt"


def detect_file_type(filename: str) -> str:
    suffix = PurePath(filename).suffix.lower()
    file_type = EXTENSION_TO_FILE_TYPE.get(suffix)
    if not file_type:
        raise GraphRagError("不支持的文件类型：GraphRAG v1 仅支持 Markdown 和 TXT", "unsupported_file_type")
    return file_type


def assert_valid_text(text: str) -> str:
    normalized = text.strip()
    if not normalized:
        raise GraphRagError("文档内容不能为空")
    if len(normalized) > 2_000_000:
        raise GraphRagError("文档内容不能超过 2000000 字符")
    return normalized


def _find_active_document_by_hash(source_id: str, content_hash: str) -> GraphDocument | None:
    """FR-151 幂等判定:同 source 内 content_hash 命中既有(未归档、ready/processing)document。

    只匹配 ready/processing(成功或在途)——failed 不匹配,允许修复后重传重抽。
    """
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, source_id, original_filename, file_type, status, content_hash,
                       content_text, metadata, uploaded_by, created_at, updated_at, archived_at
                FROM public.graph_documents
                WHERE source_id = %s AND content_hash = %s AND archived_at IS NULL
                  AND status IN ('ready', 'processing')
                ORDER BY created_at ASC
                LIMIT 1
                """,
                (source_id, content_hash),
            )
            row = cursor.fetchone()
            return map_document(row) if row else None


def _admit_processing_document(
    user: UserContext,
    source_id: str,
    filename: str,
    file_type: str,
    text: str,
    metadata: dict,
) -> DocumentAdmission:
    digest = sha256(text.encode("utf-8")).hexdigest()
    document_id = str(uuid4())
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, description, kind, workspace, owner_user_id, created_by,
                       created_at, updated_at, archived_at, delete_state, delete_step,
                       delete_attempts, delete_error, delete_started_at, delete_updated_at
                FROM public.graph_sources
                WHERE id = %s AND archived_at IS NULL
                FOR UPDATE
                """,
                (source_id,),
            )
            source_row = cursor.fetchone()
            if source_row is None:
                raise GraphRagError("source 不存在", "not_found")
            source = GraphSource(
                id=source_row["id"], name=source_row["name"], description=source_row["description"],
                kind=source_row["kind"], workspace=source_row["workspace"],
                owner_user_id=source_row["owner_user_id"], created_by=source_row["created_by"],
                created_at=source_row["created_at"], updated_at=source_row["updated_at"],
                archived_at=source_row["archived_at"], delete_state=source_row["delete_state"],
                delete_step=source_row["delete_step"], delete_attempts=source_row["delete_attempts"],
                delete_error=source_row["delete_error"], delete_started_at=source_row["delete_started_at"],
                delete_updated_at=source_row["delete_updated_at"],
            )
            if source.delete_state != "active":
                raise GraphRagError("source 正在删除或删除失败，当前不可用", "source_unavailable")
            assert_can_manage_source(user, source)
            cursor.execute(
                """
                SELECT id, source_id, original_filename, file_type, status, content_hash,
                       content_text, metadata, uploaded_by, created_at, updated_at, archived_at
                FROM public.graph_documents
                WHERE source_id = %s AND content_hash = %s AND archived_at IS NULL
                  AND status IN ('ready', 'processing')
                ORDER BY created_at ASC
                LIMIT 1
                """,
                (source_id, digest),
            )
            existing = cursor.fetchone()
            if existing is not None:
                connection.commit()
                return DocumentAdmission(map_document(existing), source, False)
            cursor.execute(
                """
                INSERT INTO public.graph_documents (
                  id, source_id, original_filename, file_type, status,
                  content_hash, content_text, metadata, uploaded_by
                )
                VALUES (%s, %s, %s, %s, 'processing', %s, %s, %s::jsonb, %s)
                RETURNING id, source_id, original_filename, file_type, status, content_hash,
                          content_text, metadata, uploaded_by, created_at, updated_at, archived_at
                """,
                (document_id, source_id, filename, file_type, digest, text, json.dumps(metadata), user.user_id),
            )
            document = map_document(cursor.fetchone())
        connection.commit()
        return DocumentAdmission(document, source, True)


_ADMISSION_LOCKS_BY_SOURCE: dict[str, asyncio.Lock] = {}
_ACTIVE_INGEST_LEASES: dict[object, tuple[str, str, str]] = {}


def get_admission_lock(source_id: str) -> asyncio.Lock:
    lock = _ADMISSION_LOCKS_BY_SOURCE.get(source_id)
    if lock is None:
        lock = asyncio.Lock()
        _ADMISSION_LOCKS_BY_SOURCE[source_id] = lock
    return lock


def _issue_ingest_lease(source: GraphSource, document_id: str) -> IngestLease:
    token = object()
    _ACTIVE_INGEST_LEASES[token] = (source.id, source.workspace, document_id)
    return IngestLease(source.id, source.workspace, document_id, token)


def validate_ingest_lease(lease: IngestLease, source: GraphSource, document_id: str) -> None:
    if _ACTIVE_INGEST_LEASES.get(lease._token) != (source.id, source.workspace, document_id):
        raise GraphRagError("ingest lease 无效或已失效", "source_unavailable")


def _revoke_ingest_lease(lease: IngestLease) -> None:
    _ACTIVE_INGEST_LEASES.pop(lease._token, None)


def _mark_document(document_id: str, status: DocumentStatus, metadata_patch: dict | None = None) -> GraphDocument:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            if metadata_patch:
                cursor.execute(
                    """
                    UPDATE public.graph_documents
                    SET status = %s, metadata = metadata || %s::jsonb, updated_at = now()
                    WHERE id = %s
                    RETURNING id, source_id, original_filename, file_type, status, content_hash,
                              content_text, metadata, uploaded_by, created_at, updated_at, archived_at
                    """,
                    (status, json.dumps(metadata_patch), document_id),
                )
            else:
                cursor.execute(
                    """
                    UPDATE public.graph_documents
                    SET status = %s, updated_at = now()
                    WHERE id = %s
                    RETURNING id, source_id, original_filename, file_type, status, content_hash,
                              content_text, metadata, uploaded_by, created_at, updated_at, archived_at
                    """,
                    (status, document_id),
                )
            document = map_document(cursor.fetchone())
        connection.commit()
        return document


async def create_text_document(
    user: UserContext,
    source_id: str,
    text: str,
    *,
    title: str | None = None,
    metadata: dict | None = None,
) -> GraphDocument:
    content = assert_valid_text(text)
    filename = safe_original_filename(title or "raw-text.txt")
    admission = _admit_processing_document(
        user,
        source_id,
        filename,
        "text",
        content,
        {"ingest_type": "raw_text", **(metadata or {})},
    )
    # C1：插入 processing 行后立即返回，LightRAG 重写入移到后台任务 process_document_ingest。
    return admission.document


async def create_uploaded_document(
    user: UserContext,
    source_id: str,
    filename: str,
    content: bytes,
    content_type: str | None = None,
) -> GraphDocument:
    if not content:
        raise GraphRagError("上传文件不能为空")
    original_filename = safe_original_filename(filename)
    file_type = detect_file_type(original_filename)
    try:
        text = assert_valid_text(content.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise GraphRagError("文件必须是 UTF-8 编码文本", "unsupported_file_type") from exc
    admission = _admit_processing_document(
        user,
        source_id,
        original_filename,
        file_type,
        text,
        {"content_type": content_type, "size_bytes": len(content), "ingest_type": "upload"},
    )
    # C1：插入 processing 行后立即返回，LightRAG 重写入移到后台任务 process_document_ingest。
    return admission.document


async def _schedule_admission(admission: DocumentAdmission) -> GraphDocument:
    if not admission.created_new:
        return admission.document
    lease = _issue_ingest_lease(admission.source, admission.document.id)
    task = asyncio.create_task(
        process_document_ingest(
            admission.source,
            admission.document.id,
            admission.document.content_text,
            lease=lease,
        )
    )
    _track_ingest_task(admission.source.workspace, task)
    task.add_done_callback(_make_ingest_done_callback(admission.source.workspace, lease))
    return admission.document


async def create_and_schedule_text_document(
    user: UserContext,
    source_id: str,
    text: str,
    *,
    title: str | None = None,
    metadata: dict | None = None,
) -> GraphDocument:
    content = assert_valid_text(text)
    async with get_admission_lock(source_id):
        admission = _admit_processing_document(
            user,
            source_id,
            safe_original_filename(title or "raw-text.txt"),
            "text",
            content,
            {"ingest_type": "raw_text", **(metadata or {})},
        )
        return await _schedule_admission(admission)


async def create_and_schedule_uploaded_document(
    user: UserContext,
    source_id: str,
    filename: str,
    content: bytes,
    content_type: str | None = None,
) -> GraphDocument:
    if not content:
        raise GraphRagError("上传文件不能为空")
    original_filename = safe_original_filename(filename)
    file_type = detect_file_type(original_filename)
    try:
        text = assert_valid_text(content.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise GraphRagError("文件必须是 UTF-8 编码文本", "unsupported_file_type") from exc
    async with get_admission_lock(source_id):
        admission = _admit_processing_document(
            user,
            source_id,
            original_filename,
            file_type,
            text,
            {"content_type": content_type, "size_bytes": len(content), "ingest_type": "upload"},
        )
        return await _schedule_admission(admission)


# I105/#5：按 workspace 追踪在途后台 ingest task。
# 用途一(I105)：task 不再被 await 到底，必须有人最终取走 result()/exception()，
# 否则失败会打印 "Task exception was never retrieved"。
# 用途二(#5 必修)：source 级联删除前，delete_source_cascade 要能按 workspace 定位
# "这个 workspace 是否还有 ingest 在写"，等它写完再删，避免删除后 in-flight 写入
# 在已清空的 lightrag_* 表里留孤儿行。
_INGEST_TASKS_BY_WORKSPACE: dict[str, set[asyncio.Task]] = {}


def _track_ingest_task(workspace: str, task: asyncio.Task) -> None:
    _INGEST_TASKS_BY_WORKSPACE.setdefault(workspace, set()).add(task)


def _untrack_ingest_task(workspace: str, task: asyncio.Task) -> None:
    tasks = _INGEST_TASKS_BY_WORKSPACE.get(workspace)
    if tasks is None:
        return
    tasks.discard(task)
    if not tasks:
        _INGEST_TASKS_BY_WORKSPACE.pop(workspace, None)


def _make_ingest_done_callback(workspace: str, lease: IngestLease | None = None):
    def _on_done(task: asyncio.Task) -> None:
        _untrack_ingest_task(workspace, task)
        if lease is not None:
            _revoke_ingest_lease(lease)
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            logging.getLogger("graph_rag").warning(
                "ingest 后台写入任务已回收异常(状态机已由轮询决定): %s", exc
            )

    return _on_done


async def wait_for_workspace_ingest_tasks(workspace: str, timeout: float) -> bool:
    """#5 必修：source 删除前的屏障——等这个 workspace 当前在途的 ingest task 跑完。

    只等调用时刻已存在的 task(快照)，不等待期间新提交的写入(那是另一类"删除期间
    还在传"的并发问题，P10 全局并发写治理 spec 的范围，这里不重复解决)。超时仍有
    task 未完成时返回 False，交给调用方决定——本模块选择拒绝删除而不是 cancel，
    cancel 不保证 LightRAG 真停止，正是 I105 之前"标 failed 但图里已半写"的病根，
    让它自然跑完对数据完整性更好。
    """
    tasks = list(_INGEST_TASKS_BY_WORKSPACE.get(workspace, ()))
    if not tasks:
        return True
    _, pending = await asyncio.wait(tasks, timeout=timeout)
    return not pending


def _processing_document_count(source_id: str) -> int:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT count(*) AS count
                FROM public.graph_documents
                WHERE source_id = %s AND status = 'processing' AND archived_at IS NULL
                """,
                (source_id,),
            )
            return int(cursor.fetchone()["count"])


async def wait_for_source_ingest_quiescence(
    source_id: str,
    workspace: str,
    timeout: float,
) -> bool:
    """Drain authority for Stage 3: persistent processing rows plus local tasks."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + max(0.0, timeout)
    while True:
        local_pending = [
            task for task in _INGEST_TASKS_BY_WORKSPACE.get(workspace, ()) if not task.done()
        ]
        persistent_pending = await asyncio.to_thread(_processing_document_count, source_id)
        if not local_pending and persistent_pending == 0:
            return True
        remaining = deadline - loop.time()
        if remaining <= 0:
            return False
        if local_pending:
            await asyncio.wait(local_pending, timeout=min(0.1, remaining))
        else:
            await asyncio.sleep(min(0.1, remaining))


async def process_document_ingest(
    source: GraphSource,
    document_id: str,
    text: str,
    *,
    poll_interval_seconds: float = 3.0,
    lease: IngestLease | None = None,
) -> None:
    """C1/I105 后台任务：LightRAG 写入在后台跑，ready/failed 判定轮询 LightRAG
    权威 doc_status，不依赖 insert_document 协程本身的返回时机。

    根因(I105)：批量并发下 LightRAG pipeline 只有一个协程真正当"runner"排干整条
    队列(见 lightrag pipeline.py apipeline_process_enqueue_documents)，runner 处理完
    自己文档后要接着处理其他排队文档才返回；非 runner 协程设 request_pending 后早
    返回。无论哪种，`await insert_document(...)` 的返回时机都和"本文档是否真的
    processed"脱钩，靠它判 ready 会滞后甚至误撞 ingest_timeout。

    因此这里不 await insert_document 到底，而是 create_task 让它在后台自己跑完
    (runner 语义不受影响)，本函数只轮询 get_doc_status(source, document_id)——
    该函数只查这一篇文档在 LightRAG 里的状态，并发的其它 process_document_ingest
    各自轮询各自的 document_id，互不干扰。
    """
    if source is None:
        # codex 建议：source 可能在上传后被并发删除/归档，重取得 None；不延后到 LightRAG 才炸。
        _mark_document(document_id, "failed", {"error": "source_missing"})
        return

    # 012 FR-326/329:结构化文件(csv/xlsx)走 custom_kg 直灌路径(不过 LLM)——与文本轮询骨架
    # 正交:custom_kg 同步直灌,不经 LightRAG doc_status pipeline,故不套 get_doc_status 轮询,
    # 用 wait_for 等它跑完直接判 ready。此路径不进 _INGEST_TASKS 删除屏障(csv 为 main 新增能力,
    # 删除屏障仅覆盖 repo 既有文本入图;结构化并发删除隔离归 P15/后续,不在本次范围)。
    document = await get_document_by_id(document_id)
    if document is not None and is_structured_file_type(document.file_type):
        try:
            from graph_rag.core.csv_kg import ingest_structured_document

            result = await asyncio.wait_for(
                ingest_structured_document(
                    source,
                    document_id,
                    text,
                    document.original_filename,
                    _lease=lease,
                ),
                timeout=get_settings().ingest_timeout_seconds,
            )
            # 部分成功可见(FR-331):把入图/跳过/失败诊断写进文档 metadata,不静默丢。
            _mark_document(document_id, "ready", {"structured_ingest": result.get("summary", {})})
        except asyncio.TimeoutError:
            logging.getLogger("graph_rag").warning(
                "structured ingest 超时 document_id=%s source=%s", document_id, source.workspace
            )
            _mark_document(document_id, "failed", {"error": "timeout_may_have_partial_index"})
            # 001 FR-111:结构化 wait_for 超时会 cancel 内层协程(与文本路的 create_task 不 cancel 不同),
            # task 已终止 → 清半写入实体安全(图污染主防线)。
            await _cleanup_failed_graph_document(source, document_id)
        except Exception as exc:
            logging.getLogger("graph_rag").exception(
                "structured ingest 失败 document_id=%s source=%s", document_id, source.workspace
            )
            _mark_document(document_id, "failed", {"error": "structured_ingest_failed", "detail": str(exc)[:300]})
            await _cleanup_failed_graph_document(source, document_id)
        return

    # 012 T5(AM-720/721 / FR-336/337):文本入图透传 file_paths(源文件锚点=original_filename,
    # 贯通 011 provenance)+ track_id(生成并持久化到 graph_documents.metadata,供批次状态查回)。
    anchor = document.original_filename if document is not None else None
    track_id = new_ingest_track_id()
    persist_document_track_id(document_id, track_id)

    loop = asyncio.get_event_loop()
    deadline = loop.time() + get_settings().ingest_timeout_seconds
    insert_kwargs = {"file_path": anchor, "track_id": track_id}
    if lease is not None:
        insert_kwargs["_lease"] = lease
    task = asyncio.create_task(insert_document(source, document_id, text, **insert_kwargs))

    while True:
        if task.done() and not task.cancelled() and task.exception() is not None:
            exc = task.exception()
            logging.getLogger("graph_rag").exception(
                "ingest 失败 document_id=%s source=%s", document_id, source.workspace, exc_info=exc
            )
            _mark_document(document_id, "failed", {"error": "embedding_failed", "detail": str(exc)[:300]})
            # 001 FR-111:后台 insert task 已异常终止(task.done + exception)→ 清半写入实体安全。
            await _cleanup_failed_graph_document(source, document_id)
            return

        status = (
            await get_doc_status(source, document_id, _lease=lease)
            if lease is not None
            else await get_doc_status(source, document_id)
        )
        if status == "processed":
            _mark_document(document_id, "ready")
            return
        if status == "failed":
            _mark_document(document_id, "failed", {"error": "lightrag_processing_failed"})
            # 001 FR-111:LightRAG 已把本文档判 failed(不再写本 doc)→ 清半写入实体安全。
            await _cleanup_failed_graph_document(source, document_id)
            return

        # I109：内容去重命中的短路。LightRAG 按 content_hash 去重——同一内容被重复提交
        # (如管理员手误重复点确认入库)时，该 doc_id 不会被 enqueue，状态记在 dup-<hash>
        # 下，get_doc_status(本 doc_id) 恒返回 None。若不处理，轮询会一直空转到
        # ingest_timeout(默认1800s) 才误标 failed（内容其实早已在图谱里）。
        # 判据要精确：只有当后台 insert task 已「无异常完成」且 status 仍为 None 才下此
        # 结论——正常在途文档(含并发非 runner 早返回那篇)在 task 完成时至少已有
        # pending/processing 记录(status 非 None)；唯有去重跳过 enqueue 才会 task 完成
        # 且 status 恒 None。此时内容已由首次那篇 processed，判 ready 而非挂死。
        if status is None and task.done() and not task.cancelled() and task.exception() is None:
            logging.getLogger("graph_rag").info(
                "ingest 内容去重命中(I109) document_id=%s source=%s：内容已存在，判 ready",
                document_id, source.workspace,
            )
            _mark_document(document_id, "ready", {"note": "content_dedup_hit"})
            return

        if loop.time() >= deadline:
            # codex 必修：此时不 cancel 后台 task——LightRAG 可能真在写，cancel
            # 不保证真停止，"标 failed 但图里已半写"；检索侧只信任 status='ready'。
            # ⚠️ 与 main 分歧:main(wait_for 模型)超时会 cancel 内层协程再 cleanup;repo 轮询模型
            # 刻意不 cancel(后台 task 仍在途),此处 delete 会与在途写入竞争,故 timeout 路径**不 cleanup**,
            # 靠 status='ready' 过滤(FR-113 第二道防线)兜底。cleanup 只在 task 已终止的失败路径执行。
            logging.getLogger("graph_rag").warning("ingest 超时 document_id=%s source=%s", document_id, source.workspace)
            _mark_document(document_id, "processing", {"error": "timeout_may_have_partial_index"})
            # Keep the persistent processing row and outer lifecycle alive until
            # the uncancelled inner write really stops. Deletion will therefore
            # time out at drain instead of racing a late graph write.
            try:
                await task
            except Exception as exc:
                _mark_document(
                    document_id,
                    "failed",
                    {"error": "embedding_failed", "detail": str(exc)[:300]},
                )
                await _cleanup_failed_graph_document(source, document_id)
                return
            terminal = (
                await get_doc_status(source, document_id, _lease=lease)
                if lease is not None
                else await get_doc_status(source, document_id)
            )
            if terminal in {None, "processed"}:
                _mark_document(document_id, "ready", {"note": "completed_after_timeout"})
            else:
                _mark_document(document_id, "failed", {"error": "timeout_processing_failed"})
                await _cleanup_failed_graph_document(source, document_id)
            return

        await asyncio.sleep(poll_interval_seconds)


async def _cleanup_failed_graph_document(source: GraphSource, document_id: str) -> None:
    """001 FR-111/112:失败文档清半写入实体(delete_document → adelete_by_doc_id);
    清理本身失败(方法不存在 / delete 抛错)→ 文档标 quarantined(隔离)+ 运维告警,不静默留污染。"""
    try:
        await delete_document(source, document_id)
    except Exception as cleanup_error:  # noqa: BLE001 — 清理降级路径须兜住一切异常
        logging.getLogger("graph_rag").error(
            "[graph cleanup] 清理失败文档实体失败 → 隔离(quarantined) document_id=%s source=%s: %s",
            document_id,
            source.workspace,
            cleanup_error,
        )
        _mark_document(
            document_id,
            "quarantined",
            {"cleanup_error": str(cleanup_error)[:300], "alert": "graph_cleanup_failed"},
        )


# ── 012 T5(AM-721 / FR-337):track_id 持久化 + 批次可查回 ────────────────────────────────
#
# track_id 挂 document,持久化到 graph_documents.metadata->>'track_id'(现有 metadata JSONB +
# GIN 索引,无需新迁移,发现待回报①)。批次语义 = 同一批 N 文件共用一个 track_id,逐篇独立可查
# (与 001 部分成功逐篇可见对齐,发现待回报③);按 track_id 查回该批 N 篇 + 状态计数可读。


def new_ingest_track_id() -> str:
    """生成一个入图 track_id(批次/文档追踪,持久化 + 透传 ainsert)。"""
    return f"ins-{uuid4().hex}"


def persist_document_track_id(document_id: str, track_id: str) -> None:
    """把 track_id 持久化到 graph_documents.metadata(查回 present,AM-721)。"""
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE public.graph_documents "
                "SET metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb, updated_at = now() "
                "WHERE id = %s",
                (json.dumps({"track_id": track_id}), document_id),
            )
        connection.commit()


def get_documents_by_track_id(source_id: str, track_id: str) -> list[GraphDocument]:
    """按 track_id 查回该批文档(逐篇可查,批量不丢;AM-721 → count==N)。"""
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, source_id, original_filename, file_type, status, content_hash,
                       content_text, metadata, uploaded_by, created_at, updated_at, archived_at
                FROM public.graph_documents
                WHERE source_id = %s AND archived_at IS NULL
                  AND metadata->>'track_id' = %s
                ORDER BY created_at ASC
                """,
                (source_id, track_id),
            )
            return [map_document(row) for row in cursor.fetchall()]


def track_id_status_counts(source_id: str, track_id: str) -> dict[str, int]:
    """该批(track_id)逐状态计数(状态计数可读,AM-721)。"""
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT status, count(*) AS c FROM public.graph_documents "
                "WHERE source_id = %s AND archived_at IS NULL AND metadata->>'track_id' = %s "
                "GROUP BY status",
                (source_id, track_id),
            )
            counts = {row["status"]: int(row["c"]) for row in cursor.fetchall()}
    counts["total"] = sum(counts.values())
    return counts


def recover_interrupted_documents(started_before) -> int:
    """C1 启动恢复：把启动前残留在 processing 的文档条件更新为 failed(interrupted_by_restart)。

    codex 必修：条件更新 status='processing' + created_at < 启动时刻，避免误伤启动后新上传的在途文档。
    标 failed 而非重跑——LightRAG 写入可能已部分落库，盲目重跑去重/补偿不确定，KISS 让用户重传。
    """
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE public.graph_documents
                SET status = 'failed', metadata = metadata || %s::jsonb, updated_at = now()
                WHERE status = 'processing' AND archived_at IS NULL AND created_at < %s
                """,
                (json.dumps({"error": "interrupted_by_restart"}), started_before),
            )
            count = cursor.rowcount
        connection.commit()
    return count


async def get_document_by_id(document_id: str) -> GraphDocument | None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, source_id, original_filename, file_type, status, content_hash,
                       content_text, metadata, uploaded_by, created_at, updated_at, archived_at
                FROM public.graph_documents
                WHERE id = %s AND archived_at IS NULL
                """,
                (document_id,),
            )
            row = cursor.fetchone()
            return map_document(row) if row else None


async def get_readable_document(user: UserContext, document_id: str) -> GraphDocument:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, source_id, original_filename, file_type, status, content_hash,
                       content_text, metadata, uploaded_by, created_at, updated_at, archived_at
                FROM public.graph_documents
                WHERE id = %s AND archived_at IS NULL
                """,
                (document_id,),
            )
            row = cursor.fetchone()
            if row is None:
                raise GraphRagError("document 不存在", "not_found")
            document = map_document(row)
            cursor.execute(
                """
                SELECT id, name, description, kind, workspace, owner_user_id, created_by,
                       created_at, updated_at, archived_at, delete_state, delete_step,
                       delete_attempts, delete_error, delete_started_at, delete_updated_at
                FROM public.graph_sources
                WHERE id = %s AND archived_at IS NULL
                FOR SHARE
                """,
                (document.source_id,),
            )
            source_row = cursor.fetchone()
            if source_row is None:
                raise GraphRagError("source 不存在", "not_found")
            source = map_source(source_row)
            if source.delete_state != "active":
                raise GraphRagError("source 正在删除或删除失败，当前不可用", "source_unavailable")
            assert_can_read_source(user, source)
            return document


async def list_readable_documents(user: UserContext, source_id: str | None = None) -> list[GraphDocument]:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            if source_id:
                cursor.execute(
                    """
                    SELECT id, name, description, kind, workspace, owner_user_id, created_by,
                           created_at, updated_at, archived_at, delete_state, delete_step,
                           delete_attempts, delete_error, delete_started_at, delete_updated_at
                    FROM public.graph_sources
                    WHERE id = %s AND archived_at IS NULL
                    FOR SHARE
                    """,
                    (source_id,),
                )
                source_row = cursor.fetchone()
                if source_row is None:
                    raise GraphRagError("source 不存在", "not_found")
                source = map_source(source_row)
                if source.delete_state != "active":
                    raise GraphRagError("source 正在删除或删除失败，当前不可用", "source_unavailable")
                assert_can_read_source(user, source)
            cursor.execute(
                """
                SELECT d.id, d.source_id, d.original_filename, d.file_type, d.status, d.content_hash,
                       d.content_text, d.metadata, d.uploaded_by, d.created_at, d.updated_at, d.archived_at
                FROM public.graph_documents d
                JOIN public.graph_sources s ON s.id = d.source_id
                WHERE d.archived_at IS NULL
                  AND s.delete_state = 'active'
                  AND (%s::text IS NULL OR d.source_id = %s)
                  AND (%s = true OR s.kind = 'public' OR s.owner_user_id = %s)
                ORDER BY d.created_at DESC
                LIMIT 200
                """,
                (source_id, source_id, user.is_admin, user.user_id),
            )
            return [map_document(row) for row in cursor.fetchall()]


async def archive_document(
    user: UserContext, document_id: str, *, purge: bool = False
) -> GraphDocument:
    document = await get_document_by_id(document_id)
    if not document:
        raise GraphRagError("document 不存在", "not_found")
    source = await get_source_by_id(document.source_id)
    if not source:
        raise GraphRagError("source 不存在", "not_found")
    assert_can_manage_source(user, source)
    from graph_rag.core.source_operation import source_graph_operation

    async with source_graph_operation(source):
        if purge:
            await delete_document(source, document.id)
        with get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE public.graph_documents AS d
                    SET status = 'archived', archived_at = now(), updated_at = now()
                    WHERE d.id = %s
                      AND EXISTS (
                        SELECT 1 FROM public.graph_sources AS s
                        WHERE s.id = d.source_id AND s.delete_state = 'active'
                      )
                    RETURNING id, source_id, original_filename, file_type, status, content_hash,
                              content_text, metadata, uploaded_by, created_at, updated_at, archived_at
                    """,
                    (document_id,),
                )
                row = cursor.fetchone()
                if row is None:
                    raise GraphRagError("source 正在删除或删除失败，当前不可用", "source_unavailable")
                archived = map_document(row)
            connection.commit()
            return archived
