#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
env_file=${FF_COMPOSE_ENV_FILE:-"$script_dir/.env"}
project_name=${FF_COMPOSE_PROJECT_NAME:-ff-companybrain}
isolation_prefix=${M1_6_VOLUME_PREFIX:-}

compose() {
  if [ -n "$isolation_prefix" ]; then
    M1_6_VOLUME_PREFIX="$isolation_prefix" docker compose \
      --project-name "$project_name" \
      --env-file "$env_file" \
      -f "$script_dir/compose.student.yml" \
      -f "$script_dir/compose.build.yml" \
      -f "$script_dir/compose.m1-6-isolated.yml" \
      "$@"
  else
    docker compose \
      --project-name "$project_name" \
      --env-file "$env_file" \
      -f "$script_dir/compose.student.yml" \
      -f "$script_dir/compose.build.yml" \
      "$@"
  fi
}

if [ "$#" -ne 0 ]; then
  echo "Usage: $0" >&2
  exit 2
fi

if [ ! -f "$env_file" ]; then
  echo "Missing private env file: $env_file" >&2
  echo "Copy $script_dir/.env.example to $script_dir/.env and fill every required value." >&2
  exit 2
fi

if [ -n "$isolation_prefix" ]; then
  case "$isolation_prefix" in
    ff_companybrain_[A-Za-z0-9_-]*) ;;
    *)
      echo "Unsafe M1_6_VOLUME_PREFIX: $isolation_prefix" >&2
      exit 2
      ;;
  esac
fi

echo "[1/4] Building images and starting a fresh stack..."
FF_COMPOSE_ENV_FILE="$env_file" \
FF_COMPOSE_PROJECT_NAME="$project_name" \
M1_6_VOLUME_PREFIX="$isolation_prefix" \
  "$script_dir/up.sh" build

echo "[2/4] Waiting for the initial database migration..."
attempt=0
while [ "$attempt" -lt 240 ]; do
  migrate_container=$(compose ps -a -q migrate)
  if [ -n "$migrate_container" ]; then
    migrate_status=$(docker inspect -f '{{.State.Status}}' "$migrate_container")
    if [ "$migrate_status" = "exited" ]; then
      migrate_exit=$(docker inspect -f '{{.State.ExitCode}}' "$migrate_container")
      if [ "$migrate_exit" != "0" ]; then
        echo "Initial migration failed. Inspect it with:" >&2
        echo "  docker compose --project-name $project_name --env-file $env_file -f $script_dir/compose.student.yml -f $script_dir/compose.build.yml logs migrate" >&2
        exit 1
      fi
      break
    fi
  fi
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$attempt" -ge 240 ]; then
  echo "Timed out waiting for the initial migration." >&2
  exit 1
fi

echo "[3/4] Importing the sanitized fourth-lesson teaching snapshot..."
FF_COMPOSE_ENV_FILE="$env_file" \
FF_COMPOSE_PROJECT_NAME="$project_name" \
M1_6_VOLUME_PREFIX="$isolation_prefix" \
  "$script_dir/restore-student-data.sh"

echo "[4/4] Waiting for the Web application..."
web_container=$(compose ps -q web)
attempt=0
while [ "$attempt" -lt 240 ]; do
  web_health=$(docker inspect -f \
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
    "$web_container" 2>/dev/null || true)
  [ "$web_health" = "healthy" ] && break
  attempt=$((attempt + 1))
  sleep 1
done
if [ "${web_health:-}" != "healthy" ]; then
  echo "The Web application did not become healthy. Run deploy/compose/status.sh and inspect Docker logs." >&2
  exit 1
fi

web_port=$(sed -n 's/^WEB_HOST_PORT=//p' "$env_file" | tail -n 1)
[ -n "$web_port" ] || web_port=3000
echo "Ready: http://127.0.0.1:$web_port"
echo "Administrator: use ADMIN_USERNAME / ADMIN_PASSWORD from your private deploy/compose/.env"
echo "Teaching accounts: student01 ... student15 / student123456"
