from __future__ import annotations

from graph_rag.core.types import UserContext
from graph_rag.db import LIGHTRAG_SCHEMA, get_connection


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _lightrag_table_reference(table: str) -> str:
    return f"{_quote_identifier(LIGHTRAG_SCHEMA)}.{_quote_identifier(table)}"


def _find_table(connection, prefix: str) -> str | None:
    row = connection.execute(
        "SELECT table_name FROM information_schema.tables "
        f"WHERE table_schema = '{LIGHTRAG_SCHEMA}' AND table_name LIKE %s "
        "ORDER BY table_name LIMIT 1",
        (prefix + "%",),
    ).fetchone()
    return row["table_name"] if row else None


def _readable_workspaces(connection, user: UserContext) -> list[str]:
    if user.is_admin:
        rows = connection.execute(
            "SELECT workspace FROM public.graph_sources "
            "WHERE archived_at IS NULL AND delete_state = 'active'"
        ).fetchall()
    else:
        rows = connection.execute(
            """
            SELECT workspace FROM public.graph_sources
            WHERE archived_at IS NULL AND delete_state = 'active'
              AND (kind = 'public' OR owner_user_id = %s)
            """,
            (user.user_id,),
        ).fetchall()
    return [row["workspace"] for row in rows]


def graph_stats(user: UserContext) -> dict:
    """真实图谱健康统计:实体/关系规模、来源、重复实体候选、样例。供后台图谱型监控面板用。

    I103：非 admin 只能看到自己可读 source(自己的 private + 全部 public)对应 workspace
    的实体/关系/来源统计，不再暴露跨 workspace 的全局样本；admin 保持看全局。

    重复实体候选:LightRAG 抽取常把同一实体抽成多个(中英/大小写/包含),
    用「一个名是另一个名的子串(忽略大小写)」做朴素检测,作为 curate 信号。
    """
    with get_connection() as connection:
        entity_table = _find_table(connection, "lightrag_vdb_entity")
        relation_table = _find_table(connection, "lightrag_vdb_relation")

        workspace_filter = _readable_workspaces(connection, user)

        entity_names: list[str] = []
        sources_seen: set[str] = set()
        if entity_table and workspace_filter:
            rows = connection.execute(
                f"SELECT entity_name, file_path FROM {_lightrag_table_reference(entity_table)} "
                f'WHERE workspace = ANY(%s) ORDER BY create_time DESC',
                (workspace_filter,),
            ).fetchall()
            for row in rows:
                name = (row.get("entity_name") or "").strip()
                if name:
                    entity_names.append(name)
                if row.get("file_path"):
                    sources_seen.add(str(row["file_path"]))

        relations = 0
        if relation_table and workspace_filter:
            relation_row = connection.execute(
                f"SELECT count(*) AS c FROM {_lightrag_table_reference(relation_table)} WHERE workspace = ANY(%s)",
                (workspace_filter,),
            ).fetchone()
            relations = int(relation_row["c"]) if relation_row else 0

        if user.is_admin:
            source_row = connection.execute(
                "SELECT count(*) AS c FROM public.graph_sources "
                "WHERE archived_at IS NULL AND delete_state = 'active'"
            ).fetchone()
        else:
            source_row = connection.execute(
                """
                SELECT count(*) AS c FROM public.graph_sources
                WHERE archived_at IS NULL AND delete_state = 'active'
                  AND (kind = 'public' OR owner_user_id = %s)
                """,
                (user.user_id,),
            ).fetchone()
        sources = int(source_row["c"]) if source_row else 0

    # 重复实体候选(curate 信号),输出人类可读字符串:
    # ① 同名实体出现多次(跨 source/workspace,典型 entity-resolution 目标)→「名字 ×N」
    # ② 不同名但一个是另一个的子串(中英/全简称,典型抽取碎片)→「A ≈ B」
    duplicate_candidates: list[str] = []
    name_counts: dict[str, int] = {}
    for name in entity_names:
        name_counts[name] = name_counts.get(name, 0) + 1
    for name, count in sorted(name_counts.items(), key=lambda kv: -kv[1]):
        if count > 1:
            duplicate_candidates.append(f"{name} ×{count}")

    distinct_names = sorted(set(entity_names))
    seen_pairs: set[tuple[str, str]] = set()
    for i, name_a in enumerate(distinct_names):
        low_a = name_a.lower()
        for name_b in distinct_names[i + 1 :]:
            low_b = name_b.lower()
            if low_a != low_b and len(low_a) >= 2 and len(low_b) >= 2 and (low_a in low_b or low_b in low_a):
                key = tuple(sorted((name_a, name_b)))
                if key not in seen_pairs:
                    seen_pairs.add(key)
                    duplicate_candidates.append(f"{name_a} ≈ {name_b}")

    return {
        "entities": len(set(entity_names)),
        "entity_rows": len(entity_names),
        "relations": relations,
        "sources": sources,
        "sample_entities": distinct_names[:24],
        "duplicate_candidates": duplicate_candidates[:24],
    }
