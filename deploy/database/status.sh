#!/bin/sh
set -eu

DATABASE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck disable=SC1091
. "${DATABASE_DIR}/common.sh"

validate_database_compose
database_compose ps --all

echo
echo "Expected healthy services: postgres, neo4j"
echo "Expected completed service: migrate (Exited 0 after a successful up)"
