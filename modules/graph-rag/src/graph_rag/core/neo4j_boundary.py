"""Narrow, fail-closed boundary for the Stage 1 Neo4j runtime contract."""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlparse

from neo4j import AsyncGraphDatabase

from graph_rag.config import Settings, get_settings
from graph_rag.core.errors import GraphRagError

_DATABASE = "neo4j"
_APOC_CORE_VERSION = "5.26.28"
_MAX_POOL_SIZE = 100
_MAX_CONNECTION_TIMEOUT_SECONDS = 60.0


@dataclass(frozen=True)
class Neo4jReadiness:
    ready: bool = True


def assert_neo4j_config_valid(settings: Settings | object | None = None) -> Settings | object:
    """Validate the mandatory Neo4j boundary without exposing credentials."""
    settings = settings or get_settings()
    if os.getenv("NEO4J_WORKSPACE"):
        raise GraphRagError(
            "NEO4J_WORKSPACE is forbidden", "neo4j_workspace_override_forbidden"
        )
    connection_values = [
        getattr(settings, field, None)
        for field in ("neo4j_uri", "neo4j_username", "neo4j_password")
    ]
    if not all(isinstance(value, str) and value.strip() for value in connection_values):
        raise GraphRagError("Neo4j configuration is incomplete", "neo4j_config_missing")

    parsed = urlparse(getattr(settings, "neo4j_uri"))
    if parsed.scheme not in {
        "bolt",
        "bolt+s",
        "bolt+ssc",
        "neo4j",
        "neo4j+s",
        "neo4j+ssc",
    } or not parsed.hostname:
        raise GraphRagError("Neo4j URI must use a supported scheme", "neo4j_uri_invalid")
    if getattr(settings, "neo4j_database", None) != _DATABASE:
        raise GraphRagError("Neo4j database must be neo4j", "neo4j_database_invalid")

    pool_size = getattr(settings, "neo4j_max_connection_pool_size", None)
    timeout = getattr(settings, "neo4j_connection_timeout_seconds", None)
    if (
        not isinstance(pool_size, int)
        or isinstance(pool_size, bool)
        or not 1 <= pool_size <= _MAX_POOL_SIZE
        or not isinstance(timeout, (int, float))
        or isinstance(timeout, bool)
        or not 0 < timeout <= _MAX_CONNECTION_TIMEOUT_SECONDS
    ):
        raise GraphRagError("Neo4j driver settings are invalid", "neo4j_driver_settings_invalid")
    return settings


# Backward-compatible local name for the first Stage 1 producer draft. New
# call sites use the frozen-spec name above.
validate_neo4j_config = assert_neo4j_config_valid


def project_neo4j_environment(settings: Settings | object | None = None) -> None:
    """Project the exact variables LightRAG reads without touching PostgreSQL."""
    settings = assert_neo4j_config_valid(settings)
    os.environ["NEO4J_URI"] = getattr(settings, "neo4j_uri")
    os.environ["NEO4J_USERNAME"] = getattr(settings, "neo4j_username")
    os.environ["NEO4J_PASSWORD"] = getattr(settings, "neo4j_password")
    os.environ["NEO4J_DATABASE"] = _DATABASE
    os.environ["NEO4J_MAX_CONNECTION_POOL_SIZE"] = str(
        getattr(settings, "neo4j_max_connection_pool_size")
    )
    os.environ["NEO4J_CONNECTION_TIMEOUT"] = str(
        getattr(settings, "neo4j_connection_timeout_seconds")
    )


async def _consume(result: object) -> None:
    consume = getattr(result, "consume", None)
    if consume is not None:
        await consume()


async def check_neo4j_readiness() -> Neo4jReadiness:
    """Run the auth, database, Cypher, and APOC probes with deterministic errors."""
    settings = assert_neo4j_config_valid()
    driver = None
    try:
        driver = AsyncGraphDatabase.driver(
            getattr(settings, "neo4j_uri"),
            auth=(getattr(settings, "neo4j_username"), getattr(settings, "neo4j_password")),
            max_connection_pool_size=getattr(settings, "neo4j_max_connection_pool_size"),
            connection_timeout=getattr(settings, "neo4j_connection_timeout_seconds"),
        )
        await driver.verify_connectivity()
        async with driver.session(database=_DATABASE) as session:
            await _consume(await session.run("RETURN 1"))
            # APOC 5.26 exposes version as a function, not a procedure.
            apoc_result = await session.run("RETURN apoc.version() AS version")
            apoc_record = await apoc_result.single()
            apoc_version = apoc_record.get("version") if apoc_record is not None else None
            if apoc_version != _APOC_CORE_VERSION:
                raise GraphRagError(
                    "Neo4j APOC version is incompatible", "neo4j_apoc_version_mismatch"
                )
            path_result = await session.run(
                "CREATE (n:__FFStage1ReadinessProbe) "
                "WITH n "
                "CALL apoc.path.subgraphAll(n, {maxLevel: 0}) "
                "YIELD nodes, relationships "
                "WITH n, size(nodes) AS nodes, size(relationships) AS relationships "
                "DELETE n "
                "RETURN nodes, relationships"
            )
            path_record = await path_result.single()
            if path_record is None or (
                path_record.get("nodes"), path_record.get("relationships")
            ) != (1, 0):
                raise GraphRagError(
                    "Neo4j APOC path probe returned an invalid result",
                    "neo4j_apoc_path_invalid",
                )
        return Neo4jReadiness()
    except GraphRagError:
        raise
    except Exception as exc:
        raise GraphRagError("Neo4j or APOC is unavailable", "neo4j_unavailable") from exc
    finally:
        if driver is not None:
            try:
                await driver.close()
            except Exception:
                # A close failure must not replace the deterministic readiness
                # error (or expose a driver exception through the health path).
                pass
