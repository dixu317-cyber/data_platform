"""GraphRAG database access boundary.

This module may use graph, vector, relational, or hybrid storage, but it must
not be accessed directly by apps/api or apps/agent-gateway.
"""
"""GraphRAG database access boundary.

Only the GraphRAG module may access this database directly. Platform API and
Agent Gateway must use the module HTTP API or MCP tools.
"""
import threading
from collections.abc import Iterator
from contextlib import contextmanager

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from graph_rag.config import get_settings


# Must remain aligned with deploy/database/migrate/topology.ts.  Project tables
# live in public; LightRAG's external PostgreSQL storage lives separately so
# its generated table names never collide with application metadata.
LIGHTRAG_SCHEMA = "lightrag"


class GraphRagDatabaseError(RuntimeError):
    pass


def get_database_url() -> str:
    database_url = get_settings().database_url
    if not database_url:
        raise GraphRagDatabaseError("GRAPH_RAG_DATABASE_URL is not configured")
    return database_url


_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()


def _get_pool() -> ConnectionPool:
    # C3：模块级懒加载连接池单例，复用连接、避免每次 connect 握手开销与连接膨胀。
    # codex 必修：双重检查锁——C2 后多线程(threadpool/recovery)冷启并发会创建多个池、孤儿泄漏。
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                settings = get_settings()
                _pool = ConnectionPool(
                    conninfo=get_database_url(),
                    min_size=settings.db_pool_min_size,
                    max_size=settings.db_pool_max_size,
                    kwargs={"row_factory": dict_row},
                    check=ConnectionPool.check_connection,
                    open=True,
                )
    return _pool


@contextmanager
def get_connection() -> Iterator[Connection]:
    # 契约不变：调用方仍 `with get_connection() as connection`，仅底层换成池借还。
    with _get_pool().connection() as connection:
        yield connection


def close_pool() -> None:
    # C3：shutdown 时关闭池（释放后台维护线程与连接）。与 _get_pool 共用锁，避免与首次创建交错。
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.close()
            _pool = None
