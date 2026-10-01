"""Deterministic custom-KG fixture shared by isolated Neo4j probes."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from typing import Any

GRAPH_RAG_WORKSPACES = {"A": "gsrc_stage0_fixture_a", "B": "gsrc_stage0_fixture_b"}
EXPECTED_NORMALIZED_HASHES = {
    "A": "b63d63c24a1535127b625a5b184f0134d085fc32961d7e3c497afc88410eb176",
    "B": "f580bbd95896e93d89f1a8b2c35dcf2c5d798a5d26ace3eec43f7f4596bfabef",
}
_ENTITY_FIELDS = ("entity_name", "entity_type", "description", "source_id", "file_path")
_RELATIONSHIP_FIELDS = (
    "src_id", "tgt_id", "description", "keywords", "weight", "source_id", "file_path"
)


def _project(record: Mapping[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    return {field: record.get(field) for field in fields if field in record}


def normalized_graph_hash(
    entities: Iterable[Mapping[str, Any]], relationships: Iterable[Mapping[str, Any]]
) -> str:
    def canonical_records(
        records: Iterable[Mapping[str, Any]], fields: tuple[str, ...]
    ) -> list[dict[str, Any]]:
        projected = [_project(record, fields) for record in records]
        return sorted(
            projected,
            key=lambda record: json.dumps(record, ensure_ascii=False, sort_keys=True),
        )

    normalized = {
        "entities": canonical_records(entities, _ENTITY_FIELDS),
        "relationships": canonical_records(relationships, _RELATIONSHIP_FIELDS),
    }
    payload = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def _fixture(unique_name: str, workspace: str) -> dict[str, Any]:
    # These business values are frozen by Stage 0/2 hashes; moving the helper
    # out of the retired package must not rewrite the acceptance fixture.
    source_id = f"fixture://stage0/{workspace}"
    file_path = f"stage0/{workspace}.md"
    entities = [
        {"entity_name": "共同实体", "entity_type": "概念", "description": "A/B 共有锚点", "source_id": source_id, "file_path": file_path},
        {"entity_name": unique_name, "entity_type": "概念", "description": f"{unique_name} 专有邻居", "source_id": source_id, "file_path": file_path},
        {"entity_name": "方向终点", "entity_type": "概念", "description": "用于验证第二条有向关系", "source_id": source_id, "file_path": file_path},
        {"entity_name": "中文孤立点", "entity_type": "概念", "description": "无关系的中文实体", "source_id": source_id, "file_path": file_path},
    ]
    relationships = [
        {"src_id": "共同实体", "tgt_id": unique_name, "description": "方向一", "keywords": "连接", "weight": 0.95, "source_id": source_id, "file_path": file_path},
        {"src_id": unique_name, "tgt_id": "方向终点", "description": "方向二", "keywords": "指向", "weight": 0.15, "source_id": source_id, "file_path": file_path},
    ]
    return {
        "workspace": workspace,
        "custom_kg": {
            "chunks": [{"content": "M2-A Stage 0 deterministic fixture", "source_id": source_id, "file_path": file_path, "chunk_order_index": 0}],
            "entities": entities,
            "relationships": relationships,
        },
    }


def build_custom_kg_fixture() -> dict[str, dict[str, Any]]:
    return {
        "A": _fixture("A_ONLY", GRAPH_RAG_WORKSPACES["A"]),
        "B": _fixture("B_ONLY", GRAPH_RAG_WORKSPACES["B"]),
    }
