#!/usr/bin/env bash
set -euo pipefail

# macOS local PostgreSQL helper for the first phase.
# It installs postgresql@17 and pgvector via Homebrew if needed and starts PostgreSQL as a local service.
# GraphRAG graph data is Neo4j-only; PostgreSQL retains pgvector and supporting tables.

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required for this helper. Install PostgreSQL manually or install Homebrew first." >&2
  exit 1
fi

if ! brew list postgresql@17 >/dev/null 2>&1; then
  echo "Installing postgresql@17..."
  brew install postgresql@17
fi

if ! brew list pgvector >/dev/null 2>&1; then
  echo "Installing pgvector..."
  brew install pgvector
fi

BREW_PREFIX="$(brew --prefix postgresql@17)"
export PATH="$BREW_PREFIX/bin:$PATH"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found after installing postgresql@17" >&2
  exit 1
fi

echo "Starting postgresql@17 via brew services..."
brew services start postgresql@17 >/dev/null

echo "Waiting for PostgreSQL..."
for _ in {1..30}; do
  if pg_isready >/dev/null 2>&1; then
    echo "PostgreSQL is ready."
    psql -d postgres -c 'SELECT version();'
    exit 0
  fi
  sleep 1
done

echo "PostgreSQL did not become ready in time." >&2
exit 1
