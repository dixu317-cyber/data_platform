#!/bin/sh
set -eu
case "${NEO4J_AUTH:-}" in */*) ;; *) exit 1;; esac
export NEO4J_USERNAME="${NEO4J_AUTH%%/*}" NEO4J_PASSWORD="${NEO4J_AUTH#*/}" NEO4J_URI='bolt://127.0.0.1:7687'
printf 'RETURN 1 AS ok, apoc.version() AS apoc;\n' | cypher-shell --non-interactive >/dev/null 2>&1
