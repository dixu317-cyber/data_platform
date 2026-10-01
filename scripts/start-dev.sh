#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  cat <<'HELP'
Usage: ./scripts/start-dev.sh

Starts the local FF-CompanyBrain stack in one terminal:
  - apps/api
  - modules/nano-brain HTTP
  - modules/traditional-rag HTTP
  - modules/graph-rag HTTP
  - apps/agent-gateway
  - apps/web

The script loads .env when present and stops all child services on Ctrl-C.
HELP
  exit 0
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required" >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required for Traditional RAG and GraphRAG services" >&2
  exit 1
fi

declare -a PIDS=()
declare -a NAMES=()

cleanup() {
  local code=$?
  if [ "${#PIDS[@]}" -gt 0 ]; then
    echo
    echo "Stopping services..."
    for pid in "${PIDS[@]}"; do
      if kill -0 "$pid" >/dev/null 2>&1; then
        kill "$pid" >/dev/null 2>&1 || true
      fi
    done
  fi
  exit "$code"
}

trap cleanup INT TERM EXIT

start_service() {
  local name="$1"
  shift
  echo "Starting ${name}: $*"
  (
    "$@" \
      > >(sed "s/^/[${name}] /") \
      2> >(sed "s/^/[${name}] /" >&2)
  ) &
  PIDS+=("$!")
  NAMES+=("$name")
}

start_service "api" bun --cwd apps/api dev
start_service "nano-http" bun --cwd modules/nano-brain http
start_service "traditional-rag" uv run --project modules/traditional-rag python -m traditional_rag.http.main
start_service "graph-rag" uv run --project modules/graph-rag python -m graph_rag.http.main
start_service "agent-gateway" bun --cwd apps/agent-gateway dev
start_service "web" bun --cwd apps/web dev

echo
echo "All services started."
echo "Web:            http://localhost:3000"
echo "API:            http://localhost:${API_PORT:-3001}"
echo "Agent Gateway:  http://localhost:${AGENT_GATEWAY_PORT:-3002}"
echo "Nano Brain:     ${NANO_BRAIN_HTTP_URL:-http://127.0.0.1:${NANO_BRAIN_HTTP_PORT:-8100}}"
echo "Traditional:    ${TRADITIONAL_RAG_HTTP_URL:-http://127.0.0.1:${TRADITIONAL_RAG_HTTP_PORT:-8101}}"
echo "GraphRAG:       ${GRAPH_RAG_HTTP_URL:-http://127.0.0.1:${GRAPH_RAG_HTTP_PORT:-8102}}"
echo
echo "Press Ctrl-C to stop all services."

while true; do
  for index in "${!PIDS[@]}"; do
    pid="${PIDS[$index]}"
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      wait "$pid"
      status=$?
      echo "Service ${NAMES[$index]} exited with status ${status}" >&2
      exit "$status"
    fi
  done
  sleep 1
done
