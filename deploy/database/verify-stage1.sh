#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
env_file="$root/.env.docker.local"
compose_file="$root/deploy/database/compose.yml"
project=ff-companybrain-m2b
pg_volume=ff_companybrain_m2b_postgres_data
neo_volume=ff_companybrain_m2b_neo4j_data

compose() { docker compose -p "$project" --env-file "$env_file" -f "$compose_file" "$@"; }
fail() { echo "Stage 1 verification failed: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail 'Docker is required'
"$root/deploy/database/validate-env.sh" "$env_file"
set -a
# validate-env restricts this file to a non-executable key/value grammar.
. "$env_file"
set +a

[ "$POSTGRES_HOST_PORT" != 5432 ] || fail 'host PostgreSQL port must not be 5432'
for volume in "$pg_volume" "$neo_volume"; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    fail "target volume already exists; refusing to reuse or reset it: $volume"
  fi
done

config=$(mktemp "${TMPDIR:-/tmp}/m2b-stage1-config.XXXXXX")
trap 'rm -f "$config"' EXIT HUP INT TERM
compose --profile stage2 config >"$config"
services=$(compose --profile stage2 config --services | LC_ALL=C sort | tr '\n' ' ')
[ "$services" = 'migrate neo4j postgres ' ] || fail "wrong service set: $services"
volumes=$(compose --profile stage2 config --volumes | LC_ALL=C sort | tr '\n' ' ')
[ "$volumes" = 'neo4j_data postgres_data ' ] || fail "wrong volume set: $volumes"
! grep -Eq 'ff.companybrain.m2a|ff_companybrain_m2a|external:[[:space:]]*true' "$config" \
  || fail 'Compose references an M2-A or external resource'

compose up -d --build --wait postgres neo4j
cleanup() { compose stop postgres neo4j >/dev/null 2>&1 || true; rm -f "$config"; }
trap cleanup EXIT HUP INT TERM

pg_major=$(compose exec -T postgres sh -eu -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d postgres -Atqc "SELECT current_setting('"'"'server_version_num'"'"')::int / 10000"')
[ "$pg_major" = 17 ] || fail "expected PostgreSQL 17, got $pg_major"
vector=$(compose exec -T postgres sh -eu -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d postgres -Atqc "SELECT default_version FROM pg_available_extensions WHERE name='"'"'vector'"'"'"')
[ "$vector" = 0.8.2 ] || fail "expected pgvector 0.8.2, got $vector"
business_count=$(compose exec -T postgres sh -eu -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" -d postgres -Atqc "SELECT count(*) FROM pg_database WHERE datname IN ('"'"'platform_identity_db'"'"','"'"'platform_core_db'"'"','"'"'nano_brain_db'"'"','"'"'agent_gateway_db'"'"','"'"'traditional_rag_db'"'"','"'"'graph_rag_db'"'"')"')
[ "$business_count" = 0 ] || fail 'Stage 2 business databases already exist'

neo_version=$(compose exec -T neo4j sh -eu -c '
  export NEO4J_USERNAME="${NEO4J_AUTH%%/*}" NEO4J_PASSWORD="${NEO4J_AUTH#*/}" NEO4J_URI=bolt://127.0.0.1:7687
  printf "CALL dbms.components() YIELD versions RETURN versions[0];\n" | cypher-shell --non-interactive --format plain
')
printf '%s\n' "$neo_version" | grep -F 5.26.28 >/dev/null || fail "expected Neo4j 5.26.28, got $neo_version"
apoc=$(compose exec -T neo4j sh -eu -c '
  export NEO4J_USERNAME="${NEO4J_AUTH%%/*}" NEO4J_PASSWORD="${NEO4J_AUTH#*/}" NEO4J_URI=bolt://127.0.0.1:7687
  printf "RETURN apoc.version();\n" | cypher-shell --non-interactive --format plain
')
printf '%s\n' "$apoc" | grep -F 5.26.28 >/dev/null || fail "expected APOC 5.26.28, got $apoc"
nodes=$(compose exec -T neo4j sh -eu -c '
  export NEO4J_USERNAME="${NEO4J_AUTH%%/*}" NEO4J_PASSWORD="${NEO4J_AUTH#*/}" NEO4J_URI=bolt://127.0.0.1:7687
  printf "MATCH (n) RETURN count(n);\n" | cypher-shell --non-interactive --format plain
' | tr -cd '0-9' | tail -c 10)
[ "$nodes" = 0 ] || fail "Neo4j is not empty; node count=$nodes"

postgres_id=$(compose ps -q postgres)
neo4j_id=$(compose ps -q neo4j)
pg_binding=$(docker inspect --format '{{(index (index .HostConfig.PortBindings "5432/tcp") 0).HostIp}}:{{(index (index .HostConfig.PortBindings "5432/tcp") 0).HostPort}}' "$postgres_id")
neo_http_binding=$(docker inspect --format '{{(index (index .HostConfig.PortBindings "7474/tcp") 0).HostIp}}:{{(index (index .HostConfig.PortBindings "7474/tcp") 0).HostPort}}' "$neo4j_id")
neo_bolt_binding=$(docker inspect --format '{{(index (index .HostConfig.PortBindings "7687/tcp") 0).HostIp}}:{{(index (index .HostConfig.PortBindings "7687/tcp") 0).HostPort}}' "$neo4j_id")
[ "$pg_binding" = "127.0.0.1:$POSTGRES_HOST_PORT" ] || fail "wrong PostgreSQL port binding: $pg_binding"
[ "$neo_http_binding" = "127.0.0.1:$NEO4J_HTTP_PORT" ] || fail "wrong Neo4j HTTP binding: $neo_http_binding"
[ "$neo_bolt_binding" = "127.0.0.1:$NEO4J_BOLT_PORT" ] || fail "wrong Neo4j Bolt binding: $neo_bolt_binding"

for volume in "$pg_volume" "$neo_volume"; do
  owner=$(docker volume inspect --format '{{ index .Labels "com.docker.compose.project" }}' "$volume")
  [ "$owner" = "$project" ] || fail "wrong owner label on $volume"
done
network_owner=$(docker network inspect --format '{{ index .Labels "com.docker.compose.project" }}' ff-companybrain-m2b-internal)
[ "$network_owner" = "$project" ] || fail 'wrong owner label on M2-B network'

for service in postgres neo4j; do
  id=$(compose ps -q "$service")
  [ -n "$id" ] || fail "$service container missing"
  owner=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$id")
  [ "$owner" = "$project" ] || fail "$service has the wrong project label"
done

echo 'Stage 1 verification passed; stopping services without deleting containers or volumes'
compose stop postgres neo4j
trap 'rm -f "$config"' EXIT HUP INT TERM
echo 'PostgreSQL 17/pgvector 0.8.2 and Neo4j 5.26.28/APOC are healthy on fresh M2-B volumes'
