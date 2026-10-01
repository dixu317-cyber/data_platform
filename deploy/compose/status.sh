#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
env_file=${FF_COMPOSE_ENV_FILE:-"$script_dir/.env"}

if [ ! -f "$env_file" ]; then
  echo "Missing private env file: $env_file" >&2
  exit 2
fi

exec docker compose --project-name ff-companybrain --env-file "$env_file" \
  -f "$script_dir/compose.student.yml" ps
