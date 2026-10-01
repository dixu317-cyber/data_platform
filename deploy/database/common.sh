#!/bin/sh

set -eu

DATABASE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "${DATABASE_DIR}/../.." && pwd)
DATABASE_ENV_FILE=${FF_DATABASE_ENV_FILE:-${REPO_ROOT}/.env.docker.local}
DATABASE_COMPOSE_FILE=${DATABASE_DIR}/compose.yml
DATABASE_PROJECT=ff-companybrain-m2b
POSTGRES_VOLUME=ff_companybrain_m2b_postgres_data
NEO4J_VOLUME=ff_companybrain_m2b_neo4j_data
DATABASE_NETWORK=ff-companybrain-m2b-internal

"${DATABASE_DIR}/validate-env.sh" "$DATABASE_ENV_FILE"

database_compose() {
  docker compose \
    --project-name "$DATABASE_PROJECT" \
    --env-file "$DATABASE_ENV_FILE" \
    --file "$DATABASE_COMPOSE_FILE" \
    --profile stage2 \
    "$@"
}

validate_database_compose() {
  database_compose config --quiet
}
