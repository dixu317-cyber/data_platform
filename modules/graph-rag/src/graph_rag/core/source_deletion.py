"""M2-A Stage 3: recoverable source deletion across graph and PostgreSQL."""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
from datetime import datetime, timezone

from graph_rag.config import get_settings
from graph_rag.core.documents import get_admission_lock, wait_for_source_ingest_quiescence
from graph_rag.core.errors import GraphRagError, GraphRagPermissionError
from graph_rag.core.lightrag_service import (
    _get_lightrag_for_deletion,
    _issue_deletion_capability,
    forget_lightrag_instance,
)
from graph_rag.core.sources import GraphSource, assert_can_manage_source, map_source
from graph_rag.core.source_operation import _release_operation_lock, _try_operation_lock
from graph_rag.core.types import UserContext
from graph_rag.db import LIGHTRAG_SCHEMA, get_connection

_LIGHTRAG_FIXED_TABLES = (
    "lightrag_doc_chunks",
    "lightrag_doc_full",
    "lightrag_doc_status",
    "lightrag_full_entities",
    "lightrag_full_relations",
    "lightrag_llm_cache",
    "lightrag_entity_chunks",
    "lightrag_relation_chunks",
)
_LIGHTRAG_VDB_TABLE_PREFIXES = (
    "lightrag_vdb_chunks_",
    "lightrag_vdb_entity_",
    "lightrag_vdb_relation_",
)
_SOURCE_COLUMNS = (
    "id, name, description, kind, workspace, owner_user_id, created_by, "
    "created_at, updated_at, archived_at, delete_state, delete_step, "
    "delete_attempts, delete_error, delete_started_at, delete_updated_at"
)
_SAFE_ERRORS = {
    "drain_timeout": "该 source 仍有文档正在写入，请稍后重试删除",
    "graph_cleanup_failed": "图数据清理失败，请重试删除",
    "postgres_cleanup_failed": "关系数据清理失败，请重试删除",
}
_LOGGER = logging.getLogger("graph_rag")


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _lightrag_table_reference(table: str) -> str:
    return f"{_quote_identifier(LIGHTRAG_SCHEMA)}.{_quote_identifier(table)}"


def _find_vdb_tables(cursor, prefix: str) -> list[str]:
    cursor.execute(
        "SELECT table_name FROM information_schema.tables "
        f"WHERE table_schema = '{LIGHTRAG_SCHEMA}' AND table_name LIKE %s",
        (prefix + "%",),
    )
    return [row["table_name"] for row in cursor.fetchall()]


def _existing_tables(cursor, candidates: tuple[str, ...]) -> list[str]:
    existing: list[str] = []
    for table in candidates:
        cursor.execute("SELECT to_regclass(%s) IS NOT NULL AS exists", (f"{LIGHTRAG_SCHEMA}.{table}",))
        if cursor.fetchone()["exists"]:
            existing.append(table)
    return existing


def _try_advisory_lock(connection, source_id: str) -> bool:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_try_advisory_lock(hashtextextended('ff:m2a:source-delete:' || %s, 0)) AS locked",
            (source_id,),
        )
        locked = bool(cursor.fetchone()["locked"])
    connection.commit()
    return locked


def _release_advisory_lock(connection, source_id: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_advisory_unlock(hashtextextended('ff:m2a:source-delete:' || %s, 0)) AS unlocked",
            (source_id,),
        )
        unlocked = bool(cursor.fetchone()["unlocked"])
    connection.commit()
    if not unlocked:
        raise RuntimeError("delete advisory lock ownership was lost")


def _assert_lock_session_alive(connection) -> None:
    """A PostgreSQL session lock survives while this exact session survives."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1 AS alive")
        if cursor.fetchone()["alive"] != 1:
            raise RuntimeError("delete advisory lock session is unavailable")


def _claim_source(user: UserContext, source_id: str) -> GraphSource:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"SELECT {_SOURCE_COLUMNS} FROM public.graph_sources "
                "WHERE id = %s AND archived_at IS NULL FOR UPDATE",
                (source_id,),
            )
            row = cursor.fetchone()
            if row is None:
                raise GraphRagError("source 不存在", "not_found")
            source = map_source(row)
            assert_can_manage_source(user, source)
            step = "drain" if source.delete_state == "active" else source.delete_step
            if source.delete_state not in {"active", "deleting", "delete_failed"} or step is None:
                raise GraphRagError("source 删除状态非法", "source_unavailable")
            cursor.execute(
                f"""
                UPDATE public.graph_sources
                SET delete_state = 'deleting',
                    delete_step = %s,
                    delete_attempts = delete_attempts + 1,
                    delete_error = NULL,
                    delete_started_at = COALESCE(delete_started_at, now()),
                    delete_updated_at = now()
                WHERE id = %s
                RETURNING {_SOURCE_COLUMNS}
                """,
                (step, source_id),
            )
            claimed = map_source(cursor.fetchone())
        connection.commit()
        return claimed


def _transition(source_id: str, current_step: str, next_step: str, attempt: int) -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE public.graph_sources
                SET delete_step = %s, delete_updated_at = now()
                WHERE id = %s AND delete_state = 'deleting' AND delete_step = %s
                  AND delete_attempts = %s
                """,
                (next_step, source_id, current_step, attempt),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("delete Saga transition lost its claimed source row")
        connection.commit()


def _safe_error_payload(code: str) -> dict[str, str]:
    return {
        "code": code,
        "message": _SAFE_ERRORS[code],
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }


def _mark_failed(source_id: str, step: str, code: str, attempt: int) -> None:
    payload = _safe_error_payload(code)
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE public.graph_sources
                SET delete_state = 'delete_failed', delete_step = %s,
                    delete_error = %s::jsonb, delete_updated_at = now()
                WHERE id = %s AND delete_state = 'deleting' AND delete_step = %s
                  AND delete_attempts = %s
                """,
                (step, json.dumps(payload, ensure_ascii=False), source_id, step, attempt),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("delete Saga failure state lost its claimed source row")
        connection.commit()


async def _cleanup_graph(source: GraphSource, capability) -> None:
    backend = "neo4j"
    rag = await _get_lightrag_for_deletion(source, capability)
    marker = getattr(rag, "_ff_delete_drop_succeeded", None)
    if marker != (backend, source.workspace):
        storage = getattr(rag, "chunk_entity_relation_graph", None)
        drop = getattr(storage, "drop", None)
        if drop is None:
            raise RuntimeError("Neo4JStorage.drop is unavailable")
        result = drop()
        if inspect.isawaitable(result):
            result = await result
        if isinstance(result, dict) and result.get("status") != "success":
            raise RuntimeError("Neo4JStorage.drop reported failure")
        await _drop_workspace_indexes(storage, source.workspace)
        setattr(rag, "_ff_delete_drop_succeeded", (backend, source.workspace))
    await forget_lightrag_instance(source.workspace)


async def _drop_workspace_indexes(storage: object, workspace: str) -> None:
    """Remove indexes owned solely by a deleted LightRAG workspace label."""
    driver = getattr(storage, "_driver", None)
    database = getattr(storage, "_DATABASE", None)
    if driver is None or not database:
        raise RuntimeError("Neo4JStorage index cleanup boundary is unavailable")

    async with driver.session(database=database) as session:
        result = await session.run(
            "SHOW INDEXES YIELD name, labelsOrTypes "
            "WHERE labelsOrTypes = [$workspace] RETURN name ORDER BY name",
            workspace=workspace,
        )
        rows = await result.data()
        for row in rows:
            name = row.get("name")
            if not isinstance(name, str) or not name:
                raise RuntimeError("Neo4j returned an invalid workspace index name")
            escaped_name = name.replace("`", "``")
            dropped = await session.run(f"DROP INDEX `{escaped_name}` IF EXISTS")
            await dropped.consume()


def _delete_postgres_sync(workspace: str, source_id: str, attempt: int) -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            for table in _existing_tables(cursor, _LIGHTRAG_FIXED_TABLES):
                cursor.execute(f"DELETE FROM {_lightrag_table_reference(table)} WHERE workspace = %s", (workspace,))
            for prefix in _LIGHTRAG_VDB_TABLE_PREFIXES:
                for table in _find_vdb_tables(cursor, prefix):
                    cursor.execute(f"DELETE FROM {_lightrag_table_reference(table)} WHERE workspace = %s", (workspace,))
            cursor.execute("DELETE FROM public.graph_documents WHERE source_id = %s", (source_id,))
            cursor.execute(
                """
                DELETE FROM public.graph_sources
                WHERE id = %s AND delete_state = 'deleting'
                  AND delete_step = 'postgres' AND delete_attempts = %s
                """,
                (source_id, attempt),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("delete Saga PostgreSQL step lost its source row")
        connection.commit()


async def _run_blocking_to_completion(function, *args):
    """Do not release the Saga lock while an uncancellable worker still mutates PG."""
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        try:
            await task
        except Exception:
            _LOGGER.exception("cancelled delete worker failed before reaching a stable boundary")
        raise


async def _wait_for_operation_exclusive_lock(connection, source_id: str, timeout: float) -> bool:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + max(0.0, timeout)
    while True:
        if _try_operation_lock(connection, source_id, shared=False):
            return True
        remaining = deadline - loop.time()
        if remaining <= 0:
            return False
        await asyncio.sleep(min(0.05, remaining))


async def delete_source_cascade(
    user: UserContext,
    source_id: str,
    *,
    wait_seconds: float | None = None,
) -> None:
    wait_budget = get_settings().delete_wait_seconds if wait_seconds is None else wait_seconds
    admission_lock = get_admission_lock(source_id)

    lock_context = None
    lock_connection = None
    locked = False
    operation_locked = False
    try:
        async with admission_lock:
            lock_context = get_connection()
            lock_connection = lock_context.__enter__()
            locked = _try_advisory_lock(lock_connection, source_id)
            if not locked:
                raise GraphRagError("该 source 正在执行删除，请稍后重试", "conflict")
            operation_locked = await _wait_for_operation_exclusive_lock(
                lock_connection, source_id, wait_budget
            )
            if not operation_locked:
                raise GraphRagError("该 source 仍有图操作正在执行，请稍后重试删除", "conflict")
            source = await _run_blocking_to_completion(_claim_source, user, source_id)
            _assert_lock_session_alive(lock_connection)

        capability = _issue_deletion_capability(source, lock_connection)
        attempt = source.delete_attempts
        step = source.delete_step
        if step == "drain":
            _assert_lock_session_alive(lock_connection)
            drained = await wait_for_source_ingest_quiescence(
                source.id, source.workspace, wait_budget
            )
            if not drained:
                await _run_blocking_to_completion(
                    _mark_failed, source.id, "drain", "drain_timeout", attempt
                )
                raise GraphRagError(_SAFE_ERRORS["drain_timeout"], "conflict")
            _assert_lock_session_alive(lock_connection)
            await _run_blocking_to_completion(_transition, source.id, "drain", "graph", attempt)
            step = "graph"

        if step == "graph":
            try:
                _assert_lock_session_alive(lock_connection)
                await _cleanup_graph(source, capability)
                _assert_lock_session_alive(lock_connection)
            except asyncio.CancelledError:
                raise
            except Exception:
                await _run_blocking_to_completion(
                    _mark_failed, source.id, "graph", "graph_cleanup_failed", attempt
                )
                raise GraphRagError(_SAFE_ERRORS["graph_cleanup_failed"], "graph_cleanup_failed") from None
            await _run_blocking_to_completion(_transition, source.id, "graph", "postgres", attempt)
            step = "postgres"

        if step == "postgres":
            try:
                _assert_lock_session_alive(lock_connection)
                await _run_blocking_to_completion(
                    _delete_postgres_sync, source.workspace, source.id, attempt
                )
                _assert_lock_session_alive(lock_connection)
            except asyncio.CancelledError:
                raise
            except Exception:
                await _run_blocking_to_completion(
                    _mark_failed, source.id, "postgres", "postgres_cleanup_failed", attempt
                )
                raise GraphRagError(_SAFE_ERRORS["postgres_cleanup_failed"], "postgres_cleanup_failed") from None
    except asyncio.CancelledError:
        raise
    except (GraphRagError, GraphRagPermissionError):
        raise
    except Exception:
        _LOGGER.exception("source deletion failed outside a persisted Saga step: source_id=%s", source_id)
        raise GraphRagError("source 删除暂时不可用，请稍后重试", "conflict") from None
    finally:
        release_failed = False
        if operation_locked and lock_connection is not None:
            try:
                _release_operation_lock(lock_connection, source_id, shared=False)
            except Exception:
                release_failed = True
                _LOGGER.exception("failed to release source deletion operation lock: source_id=%s", source_id)
        if locked and lock_connection is not None and not release_failed:
            try:
                _release_advisory_lock(lock_connection, source_id)
            except Exception:
                release_failed = True
                _LOGGER.exception("failed to release source deletion advisory lock: source_id=%s", source_id)
        if release_failed and lock_connection is not None:
            try:
                lock_connection.close()
            except Exception:
                _LOGGER.exception("failed to close poisoned deletion lock session: source_id=%s", source_id)
        if lock_context is not None:
            try:
                lock_context.__exit__(None, None, None)
            except Exception:
                _LOGGER.exception("failed to return source deletion lock connection: source_id=%s", source_id)
