#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_name=${FF_COMPOSE_PROJECT_NAME:-ff-companybrain}
env_file=${FF_COMPOSE_ENV_FILE:-"$script_dir/.env"}
mode=${1:-student}
isolation_prefix=${M1_6_VOLUME_PREFIX:-}

if [ ! -f "$env_file" ]; then
  echo "Missing private env file: $env_file" >&2
  echo "Copy $script_dir/.env.example to $script_dir/.env and replace every template value." >&2
  exit 2
fi

require_real_value() {
  key=$1
  value=$(sed -n "s/^${key}=//p" "$env_file" | tail -n 1)
  case "$value" in
    ''|*CHANGE_ME*|change-me-internal-token|*'<'*|*'>'*)
      echo "Refusing to start: replace $key in $env_file" >&2
      exit 2
      ;;
  esac
}

for key in \
  POSTGRES_BOOTSTRAP_PASSWORD POSTGRES_MIGRATOR_PASSWORD \
  IDENTITY_APP_PASSWORD PLATFORM_APP_PASSWORD NANO_APP_PASSWORD AGENT_APP_PASSWORD \
  TRADITIONAL_APP_PASSWORD GRAPH_APP_PASSWORD ADMIN_PASSWORD NEO4J_PASSWORD \
  RAG_INTERNAL_TOKEN EMBEDDING_API_KEY AGENT_API_KEY
do
  require_real_value "$key"
done

internal_token=$(sed -n 's/^RAG_INTERNAL_TOKEN=//p' "$env_file" | tail -n 1)
if [ "${#internal_token}" -lt 32 ]; then
  echo "Refusing to start: RAG_INTERNAL_TOKEN in $env_file must be at least 32 characters" >&2
  exit 2
fi

compose() {
  if [ -n "$isolation_prefix" ]; then
    case "$isolation_prefix" in
      ff_companybrain_[A-Za-z0-9_-]*) ;;
      *)
        echo "Unsafe M1_6_VOLUME_PREFIX: $isolation_prefix" >&2
        exit 2
        ;;
    esac
    M1_6_VOLUME_PREFIX="$isolation_prefix" docker compose \
      --project-name "$project_name" \
      --env-file "$env_file" \
      -f "$script_dir/compose.student.yml" \
      -f "$script_dir/compose.m1-6-isolated.yml" \
      "$@"
  else
    docker compose \
      --project-name "$project_name" \
      --env-file "$env_file" \
      -f "$script_dir/compose.student.yml" \
      "$@"
  fi
}

case "$mode" in
  student)
    compose up --detach
    ;;
  build)
    compose \
      -f "$script_dir/compose.build.yml" \
      -f "$script_dir/compose.dev-ports.yml" \
      up --build --detach
    ;;
  *)
    echo "Usage: $0 [student|build]" >&2
    exit 2
    ;;
esac
