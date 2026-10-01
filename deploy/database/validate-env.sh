#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
file="${1:-$root/.env.docker.local}"
[ -f "$file" ] || { echo "private env not found: $file" >&2; exit 1; }

if mode=$(stat -f '%Lp' "$file" 2>/dev/null); then :
elif mode=$(stat -c '%a' "$file" 2>/dev/null); then :
else echo "cannot read permissions: $file" >&2; exit 1
fi
case "$mode" in 600|400) ;; *) echo "private env mode must be 0600 or 0400; got $mode" >&2; exit 1;; esac

require() { grep -Eq "$1" "$file" || { echo "invalid or missing $2" >&2; exit 1; }; }
require '^POSTGRES_HOST_PORT=[0-9]+$' POSTGRES_HOST_PORT
require '^POSTGRES_BOOTSTRAP_USER=postgres$' POSTGRES_BOOTSTRAP_USER
require '^POSTGRES_BOOTSTRAP_PASSWORD=[0-9a-f]{32,}$' POSTGRES_BOOTSTRAP_PASSWORD
for name in POSTGRES_MIGRATOR_PASSWORD IDENTITY_APP_PASSWORD PLATFORM_APP_PASSWORD NANO_APP_PASSWORD AGENT_APP_PASSWORD TRADITIONAL_APP_PASSWORD GRAPH_APP_PASSWORD ADMIN_PASSWORD; do
  require "^${name}=[0-9a-f]{32,}$" "$name"
done
require '^ADMIN_USERNAME=[A-Za-z0-9_.-]+$' ADMIN_USERNAME
require '^NEO4J_HTTP_PORT=[0-9]+$' NEO4J_HTTP_PORT
require '^NEO4J_BOLT_PORT=[0-9]+$' NEO4J_BOLT_PORT
require '^NEO4J_USERNAME=neo4j$' NEO4J_USERNAME
require '^NEO4J_PASSWORD=[0-9a-f]{32,}$' NEO4J_PASSWORD
! grep -Eq '<[^>]+>|CHANGE_ME|TODO|change-me' "$file" || { echo 'private env contains a placeholder' >&2; exit 1; }
echo "private env validation passed: $file"
