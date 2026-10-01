#!/bin/sh
set -eu

DATABASE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck disable=SC1091
. "${DATABASE_DIR}/common.sh"

validate_database_compose
CONFIRM_PROJECT=ff-companybrain-m2b
[ "$DATABASE_PROJECT" = "$CONFIRM_PROJECT" ] || {
  echo "refusing reset: unexpected project contract $DATABASE_PROJECT" >&2
  exit 1
}

show_targets() {
  echo "Reset is destructive and is limited to these M2-B resources:"
  echo "  project: $DATABASE_PROJECT"
  echo "  volume:  $POSTGRES_VOLUME"
  echo "  volume:  $NEO4J_VOLUME"
  echo "  network: $DATABASE_NETWORK"
  echo "It never runs prune and never connects to a host database."
}

show_targets

if [ "$#" -ne 2 ] || [ "${1:-}" != "--confirm-reset" ] || [ "${2:-}" != "$CONFIRM_PROJECT" ]; then
  echo
  echo "No resources changed. To confirm the exact target, run:" >&2
  echo "  $0 --confirm-reset $CONFIRM_PROJECT" >&2
  exit 2
fi

services=$(database_compose config --services | LC_ALL=C sort | tr '\n' ' ')
[ "$services" = "migrate neo4j postgres " ] || {
  echo "refusing reset: unexpected service set: $services" >&2
  exit 1
}
volume_keys=$(database_compose config --volumes | LC_ALL=C sort | tr '\n' ' ')
[ "$volume_keys" = "neo4j_data postgres_data " ] || {
  echo "refusing reset: unexpected volume set: $volume_keys" >&2
  exit 1
}

for volume in "$POSTGRES_VOLUME" "$NEO4J_VOLUME"; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    owner=$(docker volume inspect --format '{{ index .Labels "com.docker.compose.project" }}' "$volume")
    [ "$owner" = "$DATABASE_PROJECT" ] || {
      echo "refusing reset: $volume is not owned by $DATABASE_PROJECT" >&2
      exit 1
    }
  fi
done

if docker network inspect "$DATABASE_NETWORK" >/dev/null 2>&1; then
  owner=$(docker network inspect --format '{{ index .Labels "com.docker.compose.project" }}' "$DATABASE_NETWORK")
  [ "$owner" = "$DATABASE_PROJECT" ] || {
    echo "refusing reset: $DATABASE_NETWORK is not owned by $DATABASE_PROJECT" >&2
    exit 1
  }
fi

database_compose down --volumes
echo "Reset completed for $DATABASE_PROJECT only."
