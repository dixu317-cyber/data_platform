#!/bin/sh
set -eu

DATABASE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck disable=SC1091
. "${DATABASE_DIR}/common.sh"

validate_database_compose

if [ "${1:-}" = "--dry-run" ]; then
  [ "$#" -eq 1 ] || { echo "usage: $0 [--dry-run]" >&2; exit 2; }
  echo "would stop only Compose project: $DATABASE_PROJECT"
  echo "volumes would be preserved"
  exit 0
fi
[ "$#" -eq 0 ] || { echo "usage: $0 [--dry-run]" >&2; exit 2; }

database_compose stop
echo "Stopped $DATABASE_PROJECT. Data volumes were preserved."
