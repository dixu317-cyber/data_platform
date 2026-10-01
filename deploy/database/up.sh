#!/bin/sh
set -eu

DATABASE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck disable=SC1091
. "${DATABASE_DIR}/common.sh"

validate_database_compose

if [ "${1:-}" = "--dry-run" ]; then
  [ "$#" -eq 1 ] || { echo "usage: $0 [--dry-run]" >&2; exit 2; }
  echo "project: $DATABASE_PROJECT"
  echo "compose: $DATABASE_COMPOSE_FILE"
  echo "1. build/start postgres and neo4j"
  echo "2. wait for both healthchecks through migrate depends_on"
  echo "3. recreate migrate and return its exact exit code"
  exit 0
fi
[ "$#" -eq 0 ] || { echo "usage: $0 [--dry-run]" >&2; exit 2; }

echo "Starting PostgreSQL and Neo4j for project $DATABASE_PROJECT ..."
database_compose up --detach --build --wait postgres neo4j

echo "Running the single migrate/init service ..."
set +e
database_compose up --detach --build --force-recreate migrate
start_code=$?
set -e
if [ "$start_code" -ne 0 ]; then
  echo "migrate could not start (exit $start_code)." >&2
  echo "Inspect status: ./deploy/database/status.sh" >&2
  echo "Inspect logs: docker compose -p $DATABASE_PROJECT --env-file .env.docker.local -f deploy/database/compose.yml --profile stage2 logs migrate" >&2
  exit "$start_code"
fi

set +e
database_compose wait migrate
migrate_code=$?
set -e

if [ "$migrate_code" -ne 0 ]; then
  echo "migrate failed with exit $migrate_code; PostgreSQL and Neo4j remain available for diagnosis." >&2
  echo "Inspect logs: docker compose -p $DATABASE_PROJECT --env-file .env.docker.local -f deploy/database/compose.yml --profile stage2 logs migrate" >&2
  exit "$migrate_code"
fi

echo "Database foundation is ready."
echo "Host ports are defined in .env.docker.local (defaults: PostgreSQL 55432, Neo4j 7474/7687)."
