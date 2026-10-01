"""Shared graph-read limits used by the service and curation surfaces."""

# Governance/export promises that every node up to this explicit ceiling is
# reachable.  LightRAG has its own lower default, so construction and callers
# must share this value instead of silently diverging.
MAX_GRAPH_NODES = 10_000
