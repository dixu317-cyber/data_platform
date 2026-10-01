#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUN_INSTALL=1
RUN_DB=1
RUN_ADMIN=1
RUN_WEB_BUILD=1

for arg in "$@"; do
  case "$arg" in
    --skip-install) RUN_INSTALL=0 ;;
    --skip-db) RUN_DB=0 ;;
    --skip-admin) RUN_ADMIN=0 ;;
    --skip-web-build) RUN_WEB_BUILD=0 ;;
    -h|--help)
      cat <<'HELP'
Usage: ./scripts/deploy.sh [options]

Options:
  --skip-install     Do not install Bun / uv dependencies.
  --skip-db          Do not create or migrate databases.
  --skip-admin       Do not create the default admin user.
  --skip-web-build   Do not build the Next.js frontend.
HELP
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 is required" >&2
    exit 1
  fi
}

require_command bun
require_command uv

if [ "$RUN_INSTALL" -eq 1 ]; then
  echo "Installing Bun workspace dependencies..."
  bun install --frozen-lockfile

  echo "Installing Python module dependencies..."
  uv sync --project modules/traditional-rag
  uv sync --project modules/graph-rag
fi

echo "Running TypeScript checks..."
bun x tsc --noEmit

if [ "$RUN_WEB_BUILD" -eq 1 ]; then
  echo "Building web frontend..."
  bun --cwd apps/web build
fi

if [ "$RUN_DB" -eq 1 ]; then
  echo "Creating and migrating databases..."
  bun run db:init
fi

if [ "$RUN_ADMIN" -eq 1 ]; then
  echo "Ensuring admin user exists..."
  set +e
  bun run admin:create
  admin_status=$?
  set -e
  if [ "$admin_status" -eq 2 ]; then
    echo "Admin user already exists; continuing."
  elif [ "$admin_status" -ne 0 ]; then
    exit "$admin_status"
  fi
fi

cat <<'DONE'

Deployment preparation complete.

Run services with:
  bun run dev:all

For production process managers, use these service commands:
  bun --cwd apps/api start
  bun --cwd modules/nano-brain http
  uv run --project modules/traditional-rag python -m traditional_rag.http.main
  uv run --project modules/graph-rag python -m graph_rag.http.main
  bun --cwd apps/agent-gateway start
  bun --cwd apps/web start
DONE
