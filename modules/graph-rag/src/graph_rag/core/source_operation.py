"""Cross-process admission guard for ordinary source-bound graph operations."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from contextvars import ContextVar
from functools import wraps
from inspect import signature

from graph_rag.core.errors import GraphRagError
from graph_rag.core.sources import GraphSource
from graph_rag.db import get_connection

_LOGGER = logging.getLogger("graph_rag")
_OPERATION_LOCK_NAMESPACE = "ff:m2a:source-operation:"
_ACTIVE_SOURCE_GUARDS: ContextVar[frozenset[str]] = ContextVar(
    "active_source_graph_guards", default=frozenset()
)


def _try_operation_lock(connection, source_id: str, *, shared: bool) -> bool:
    function = "pg_try_advisory_lock_shared" if shared else "pg_try_advisory_lock"
    with connection.cursor() as cursor:
        cursor.execute(
            f"SELECT {function}(hashtextextended(%s || %s, 0)) AS locked",
            (_OPERATION_LOCK_NAMESPACE, source_id),
        )
        locked = bool(cursor.fetchone()["locked"])
    connection.commit()
    return locked


def _release_operation_lock(connection, source_id: str, *, shared: bool) -> None:
    function = "pg_advisory_unlock_shared" if shared else "pg_advisory_unlock"
    with connection.cursor() as cursor:
        cursor.execute(
            f"SELECT {function}(hashtextextended(%s || %s, 0)) AS unlocked",
            (_OPERATION_LOCK_NAMESPACE, source_id),
        )
        unlocked = bool(cursor.fetchone()["unlocked"])
    connection.commit()
    if not unlocked:
        raise RuntimeError("source operation advisory lock ownership was lost")


def _assert_active_on_guard_connection(connection, source_id: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT delete_state FROM public.graph_sources "
            "WHERE id = %s AND archived_at IS NULL",
            (source_id,),
        )
        row = cursor.fetchone()
    connection.commit()
    if row is None:
        raise GraphRagError("source 不存在", "not_found")
    if row["delete_state"] != "active":
        raise GraphRagError("source 正在删除或删除失败，当前不可用", "source_unavailable")


@asynccontextmanager
async def source_graph_operation(source: GraphSource | str):
    """Hold a cross-process shared lock through one ordinary graph operation.

    Deletion owns the exclusive form of the same lock before it claims the
    source row. Therefore an operation admitted first completes before claim,
    while deletion-first callers cannot reach a graph side effect.
    """

    source_id = source if isinstance(source, str) else source.id
    active = _ACTIVE_SOURCE_GUARDS.get()
    if source_id in active:
        yield
        return

    context = get_connection()
    connection = context.__enter__()
    locked = False
    token = None
    try:
        locked = _try_operation_lock(connection, source_id, shared=True)
        if not locked:
            # The deletion executor may be between acquiring the exclusive
            # operation lock and persisting `deleting`. Distinguish the stable
            # non-active state when visible; otherwise return a safe conflict.
            try:
                _assert_active_on_guard_connection(connection, source_id)
            except GraphRagError:
                raise
            raise GraphRagError("source 正在切换删除状态，请稍后重试", "conflict")
        _assert_active_on_guard_connection(connection, source_id)
        token = _ACTIVE_SOURCE_GUARDS.set(active | {source_id})
        yield
    finally:
        if token is not None:
            _ACTIVE_SOURCE_GUARDS.reset(token)
        if locked:
            try:
                _release_operation_lock(connection, source_id, shared=True)
            except Exception:
                _LOGGER.exception("failed to release source operation lock: source_id=%s", source_id)
                try:
                    connection.close()
                except Exception:
                    _LOGGER.exception("failed to close poisoned operation lock session: source_id=%s", source_id)
        try:
            context.__exit__(None, None, None)
        except Exception:
            _LOGGER.exception("failed to return source operation connection: source_id=%s", source_id)


def guard_source_graph_operation(parameter: str):
    """Decorate an async source-bound operation for cross-process admission."""

    def decorate(function):
        function_signature = signature(function)

        @wraps(function)
        async def guarded(*args, **kwargs):
            bound = function_signature.bind_partial(*args, **kwargs)
            source = bound.arguments[parameter]
            async with source_graph_operation(source):
                return await function(*args, **kwargs)

        return guarded

    return decorate
