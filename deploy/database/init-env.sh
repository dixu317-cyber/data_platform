#!/bin/sh
set -eu

umask 077
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
out="$root/.env.docker.local"
image=pgvector/pgvector:0.8.2-pg17-bookworm

[ ! -e "$out" ] || { echo "refusing to overwrite existing private env: $out" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo 'Docker is required' >&2; exit 1; }

random_hex() {
  docker run --rm --network none --entrypoint sh "$image" -c \
    'od -An -N24 -tx1 /dev/urandom | tr -d " \n"'
}

tmp="${out}.tmp.$$"
trap 'rm -f "$tmp"' EXIT HUP INT TERM
{
  printf 'POSTGRES_HOST_PORT=55432\nPOSTGRES_BOOTSTRAP_USER=postgres\n'
  for name in POSTGRES_BOOTSTRAP_PASSWORD POSTGRES_MIGRATOR_PASSWORD IDENTITY_APP_PASSWORD PLATFORM_APP_PASSWORD NANO_APP_PASSWORD AGENT_APP_PASSWORD TRADITIONAL_APP_PASSWORD GRAPH_APP_PASSWORD ADMIN_PASSWORD; do
    value=$(random_hex)
    printf '%s\n' "$value" | grep -Eq '^[0-9a-f]{48}$' || { echo 'failed to generate strong local passwords' >&2; exit 1; }
    printf '%s=%s\n' "$name" "$value"
  done
  printf 'ADMIN_USERNAME=admin\nNEO4J_HTTP_PORT=7474\nNEO4J_BOLT_PORT=7687\nNEO4J_USERNAME=neo4j\n'
  value=$(random_hex)
  printf '%s\n' "$value" | grep -Eq '^[0-9a-f]{48}$' || { echo 'failed to generate strong local passwords' >&2; exit 1; }
  printf 'NEO4J_PASSWORD=%s\n' "$value"
} >"$tmp"
chmod 0600 "$tmp"
mv "$tmp" "$out"
trap - EXIT HUP INT TERM
echo "created private env with mode 0600: $out"
