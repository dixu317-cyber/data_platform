#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_name=${FF_COMPOSE_PROJECT_NAME:-ff-companybrain}
env_file=${FF_COMPOSE_ENV_FILE:-"$script_dir/.env"}
timeout_seconds=${FF_VERIFY_TIMEOUT_SECONDS:-180}

if [ ! -f "$env_file" ]; then
  echo "Missing private env file: $env_file" >&2
  exit 2
fi

case "$timeout_seconds" in
  ''|*[!0-9]*)
    echo "FF_VERIFY_TIMEOUT_SECONDS must be a positive integer." >&2
    exit 2
    ;;
esac

if [ "$timeout_seconds" -lt 1 ]; then
  echo "FF_VERIFY_TIMEOUT_SECONDS must be greater than zero." >&2
  exit 2
fi

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required for stack verification." >&2
  exit 2
}
command -v curl >/dev/null 2>&1 || {
  echo "curl is required for stack verification." >&2
  exit 2
}

compose() {
  docker compose --project-name "$project_name" --env-file "$env_file" \
    -f "$script_dir/compose.student.yml" "$@"
}

read_env_value() {
  key=$1
  sed -n "s/^${key}=//p" "$env_file" | tail -n 1
}

deadline_after_timeout() {
  date +%s | awk -v seconds="$timeout_seconds" '{ print $1 + seconds }'
}

show_failure_context() {
  service=${1:-}
  echo "Compose state for project $project_name:" >&2
  compose ps --all >&2 || true
  if [ -n "$service" ]; then
    echo "Recent logs for $service:" >&2
    compose logs --tail 100 "$service" >&2 || true
  fi
}

wait_for_migrate() {
  deadline=$(deadline_after_timeout)
  while :; do
    container_id=$(compose ps --all -q migrate 2>/dev/null || true)
    if [ -n "$container_id" ]; then
      state=$(docker inspect --format '{{.State.Status}}:{{.State.ExitCode}}' "$container_id" 2>/dev/null || true)
      case "$state" in
        exited:0)
          echo "migrate completed successfully"
          return 0
          ;;
        exited:*)
          echo "migrate failed: $state" >&2
          show_failure_context migrate
          return 1
          ;;
      esac
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "Timed out waiting for migrate." >&2
      show_failure_context migrate
      return 1
    fi
    sleep 2
  done
}

wait_for_healthy() {
  service=$1
  deadline=$(deadline_after_timeout)
  while :; do
    container_id=$(compose ps -q "$service" 2>/dev/null || true)
    if [ -n "$container_id" ]; then
      running=$(docker inspect --format '{{.State.Running}}' "$container_id" 2>/dev/null || true)
      health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id" 2>/dev/null || true)
      if [ "$running" = "true" ] && [ "$health" = "healthy" ]; then
        echo "$service is healthy"
        return 0
      fi
      if [ "$running" != "true" ]; then
        echo "$service stopped before becoming healthy." >&2
        show_failure_context "$service"
        return 1
      fi
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "Timed out waiting for $service to become healthy." >&2
      show_failure_context "$service"
      return 1
    fi
    sleep 2
  done
}

wait_for_full_stack() {
  wait_for_migrate
  for service in postgres neo4j nano-brain traditional-rag graph-rag api agent-gateway web; do
    wait_for_healthy "$service"
  done
}

assert_learner_pull_only() {
  if compose config | grep -Eq '^[[:space:]]+build:'; then
    echo "Learner Compose unexpectedly contains a build section." >&2
    return 1
  fi
  if ! compose config | grep -q 'service_completed_successfully'; then
    echo "Learner Compose no longer contains the migrate completion gate." >&2
    return 1
  fi
}

assert_host_private() {
  port=$1
  if curl --silent --show-error --fail --max-time 2 "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
    echo "Internal service unexpectedly reachable from host on port $port." >&2
    return 1
  fi
}

assert_no_host_publish() {
  service=$1
  container_id=$(compose ps -q "$service")
  if published=$(docker port "$container_id" 2>/dev/null) && [ -n "$published" ]; then
    echo "$service unexpectedly publishes host ports: $published" >&2
    return 1
  fi
}

assert_loopback_publish() {
  service=$1
  container_port=$2
  host_port=$3
  container_id=$(compose ps -q "$service")
  expected="127.0.0.1:${host_port}"
  published=$(docker port "$container_id" "${container_port}/tcp" 2>/dev/null || true)
  if [ "$published" != "$expected" ]; then
    echo "$service must publish ${container_port}/tcp only to $expected; got: ${published:-none}" >&2
    return 1
  fi
}

assert_web_reachable() {
  web_port=$(read_env_value WEB_HOST_PORT)
  web_port=${web_port:-3000}
  web_url=${FF_VERIFY_WEB_URL:-"http://127.0.0.1:${web_port}"}
  response=$(curl --silent --show-error --fail --max-time 10 "$web_url/")
  if [ -z "$response" ]; then
    echo "Web returned an empty response: $web_url" >&2
    return 1
  fi
  echo "Web is reachable at $web_url"
}

probe_protected_tool_http() {
  admin_username=$(read_env_value ADMIN_USERNAME)
  admin_password=$(read_env_value ADMIN_PASSWORD)
  if [ -z "$admin_username" ] || [ -z "$admin_password" ]; then
    echo "ADMIN_USERNAME and ADMIN_PASSWORD are required for the protected Tool HTTP probe." >&2
    return 1
  fi

  compose exec -T \
    -e "FF_VERIFY_ADMIN_USERNAME=$admin_username" \
    -e "FF_VERIFY_ADMIN_PASSWORD=$admin_password" \
    api bun -e '
const login = await fetch("http://127.0.0.1:3001/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    username: process.env.FF_VERIFY_ADMIN_USERNAME,
    password: process.env.FF_VERIFY_ADMIN_PASSWORD,
  }),
});
if (!login.ok) throw new Error(`admin login failed with HTTP ${login.status}`);
const session = await login.json();
if (typeof session.token !== "string" || !session.token) throw new Error("login did not return a bearer token");
const tool = await fetch("http://127.0.0.1:3001/nano/agent-tools/audit-logs?limit=1", {
  headers: { authorization: `Bearer ${session.token}` },
});
if (!tool.ok) throw new Error(`protected Nano Tool HTTP adapter failed with HTTP ${tool.status}`);
const body = await tool.json();
if (!Array.isArray(body.audit_logs)) throw new Error("Tool adapter response has no audit_logs array");
console.log("protected Tool HTTP adapter passed");
'
}

assert_learner_pull_only
wait_for_full_stack

postgres_dev_host_port=$(read_env_value POSTGRES_DEV_HOST_PORT)
postgres_dev_host_port=${postgres_dev_host_port:-15432}
neo4j_http_dev_host_port=$(read_env_value NEO4J_HTTP_DEV_HOST_PORT)
neo4j_http_dev_host_port=${neo4j_http_dev_host_port:-17474}
neo4j_bolt_dev_host_port=$(read_env_value NEO4J_BOLT_DEV_HOST_PORT)
neo4j_bolt_dev_host_port=${neo4j_bolt_dev_host_port:-17687}

for service in api agent-gateway nano-brain traditional-rag graph-rag; do
  assert_no_host_publish "$service"
done
assert_loopback_publish postgres 5432 "$postgres_dev_host_port"
assert_loopback_publish neo4j 7474 "$neo4j_http_dev_host_port"
assert_loopback_publish neo4j 7687 "$neo4j_bolt_dev_host_port"
for port in 3001 3002 8100 8101 8102; do
  assert_host_private "$port"
done

assert_web_reachable
probe_protected_tool_http

# This is an ordinary service restart: it never removes volumes and proves that
# the migrated identity data and protected HTTP path survive a process restart.
compose restart postgres neo4j nano-brain traditional-rag graph-rag api agent-gateway web
wait_for_full_stack
assert_loopback_publish postgres 5432 "$postgres_dev_host_port"
assert_loopback_publish neo4j 7474 "$neo4j_http_dev_host_port"
assert_loopback_publish neo4j 7687 "$neo4j_bolt_dev_host_port"
assert_web_reachable
probe_protected_tool_http

echo "M3 current-platform stack verification passed. SaaS-backed retrieval remains an M5 check."
