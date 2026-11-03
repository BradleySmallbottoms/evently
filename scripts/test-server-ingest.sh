#!/usr/bin/env bash
# Open an SSH tunnel to the test server, then run the local importers and scans
# against that server's database, image bucket, and domain-event queue.
#
#   sh scripts/test-server-ingest.sh
#   sh scripts/test-server-ingest.sh --source visit-soderhamn --limit 5
#   sh scripts/test-server-ingest.sh --skip-import
#   sh scripts/test-server-ingest.sh --skip-scan
#
# TEST_SSH_HOST defaults to evently. TEST_REMOTE_DIR overrides ~/evently on that host.
# This writes to the test database. Chat keys come from the server env when they are set.

set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

SSH_HOST=${TEST_SSH_HOST:-evently}
LOCAL_PG_PORT=${TEST_PG_PORT:-25432}
LOCAL_S3_PORT=${TEST_S3_PORT:-23900}
LOCAL_SQS_PORT=${TEST_SQS_PORT:-29324}

SOURCE_LIST=""
LIMIT_ARGS=""
SKIP_IMPORT=0
SKIP_SCAN=0

usage() {
  echo "Usage: sh scripts/test-server-ingest.sh [--source <slug>]... [--limit <n>] [--skip-import] [--skip-scan]" >&2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --source)
      [ $# -ge 2 ] || { usage; exit 2; }
      SOURCE_LIST="${SOURCE_LIST}$2"$'\n'
      shift 2
      ;;
    --limit)
      [ $# -ge 2 ] || { usage; exit 2; }
      LIMIT_ARGS="--limit $2"
      shift 2
      ;;
    --skip-import)
      SKIP_IMPORT=1
      shift
      ;;
    --skip-scan)
      SKIP_SCAN=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

container_ip() {
  local service="$1"
  ssh "$SSH_HOST" "SERVICE=$(printf '%q' "$service") REMOTE_DIR=$(printf '%q' "${TEST_REMOTE_DIR:-}") bash -s" <<'REMOTE'
set -eu
if [ -n "$REMOTE_DIR" ]; then
  file="${REMOTE_DIR}/deploy/test/docker-compose.yml"
else
  file="${HOME}/evently/deploy/test/docker-compose.yml"
fi
cid=$(docker compose -f "$file" ps -q "$SERVICE")
if [ -z "$cid" ]; then
  echo "The test server has no running ${SERVICE} container." >&2
  exit 1
fi
docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{println $v.IPAddress}}{{end}}' "$cid" |
  awk 'NF { print; exit }'
REMOTE
}

load_remote_env() {
  # Assignments must be exported. The worker is a child process, and its .env file
  # does not replace variables that are already set.
  set -a
  # shellcheck disable=SC2046
  eval "$(
    ssh "$SSH_HOST" "REMOTE_DIR=$(printf '%q' "${TEST_REMOTE_DIR:-}") bash -s" <<'REMOTE'
set -eu
if [ -n "$REMOTE_DIR" ]; then
  file="${REMOTE_DIR}/deploy/test/.env"
else
  file="${HOME}/evently/deploy/test/.env"
fi
python3 - "$file" <<'PY'
import pathlib, shlex, sys
allowed = {
    "POSTGRES_PASSWORD",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "CHAT_PROVIDER",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "VISIT_SODERHAMN_API_KEY",
    "TICKSTER_API_KEY",
    "BRAVE_API_KEY",
}
path = pathlib.Path(sys.argv[1])
for raw in path.read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key not in allowed:
        continue
    value = value.strip().strip('"').strip("'")
    if not value or "\n" in value or "\x00" in value:
        continue
    print(f"{key}={shlex.quote(value)}")
PY
REMOTE
  )"
  set +a
}

wait_port() {
  local port="$1"
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
    if nc -z 127.0.0.1 "$port" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  echo "Nothing accepted connections on 127.0.0.1:${port}." >&2
  return 1
}

echo "Resolving test containers on ${SSH_HOST}"
GARAGE_IP=$(container_ip garage)
SQS_IP=$(container_ip elasticmq)
if [ -z "$GARAGE_IP" ] || [ -z "$SQS_IP" ]; then
  echo "Could not read the Garage or ElasticMQ address on the test server." >&2
  exit 1
fi

echo "Opening SSH tunnel"
ssh -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L "127.0.0.1:${LOCAL_PG_PORT}:127.0.0.1:5432" \
  -L "127.0.0.1:${LOCAL_S3_PORT}:${GARAGE_IP}:3900" \
  -L "127.0.0.1:${LOCAL_SQS_PORT}:${SQS_IP}:9324" \
  "$SSH_HOST" &
TUNNEL_PID=$!
cleanup() {
  kill "$TUNNEL_PID" >/dev/null 2>&1 || true
  wait "$TUNNEL_PID" 2>/dev/null || true
}
trap cleanup EXIT

wait_port "$LOCAL_PG_PORT"
wait_port "$LOCAL_S3_PORT"
wait_port "$LOCAL_SQS_PORT"

load_remote_env
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "The test server env has no POSTGRES_PASSWORD." >&2
  exit 1
fi
if [ -z "${S3_ACCESS_KEY_ID:-}" ] || [ -z "${S3_SECRET_ACCESS_KEY:-}" ]; then
  echo "The test server env has no Garage key. Image uploads would use the local key." >&2
  exit 1
fi
export S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY

ENCODED_PASSWORD=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$POSTGRES_PASSWORD")
export DATABASE_URL="postgres://events:${ENCODED_PASSWORD}@127.0.0.1:${LOCAL_PG_PORT}/events"
export PUBLIC_ASSETS_BUCKET=local-events-assets
export S3_ENDPOINT="http://127.0.0.1:${LOCAL_S3_PORT}"
export S3_REGION=garage
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_REGION=eu-north-1
export AWS_ENDPOINT_URL_SQS="http://127.0.0.1:${LOCAL_SQS_PORT}"
export DOMAIN_EVENTS_QUEUE_URL="http://127.0.0.1:${LOCAL_SQS_PORT}/000000000000/domain-events"
export OLLAMA_DISABLED=1
unset POSTGRES_PASSWORD ENCODED_PASSWORD

if [ -z "$SOURCE_LIST" ] && [ "$SKIP_IMPORT" -eq 0 ]; then
  SOURCE_LIST=$(
    pnpm --filter @local-events/db exec node --input-type=module -e '
      import postgres from "postgres";
      const sql = postgres(process.env.DATABASE_URL, { max: 1 });
      const rows = await sql`select slug from data_sources where slug <> ${"example-fixture"} order by slug`;
      process.stdout.write(rows.map((row) => row.slug).join("\n"));
      await sql.end();
    '
  )
fi

FAILED=0
if [ "$SKIP_IMPORT" -eq 0 ]; then
  if [ -z "$SOURCE_LIST" ]; then
    echo "No import sources are stored on the test database."
  fi
  while IFS= read -r slug; do
    [ -n "$slug" ] || continue
    echo "Importing ${slug}"
    # shellcheck disable=SC2086
    if ! pnpm --filter @local-events/data-workers dev -- --source "$slug" $LIMIT_ARGS; then
      FAILED=1
    fi
  done <<<"$SOURCE_LIST"
fi

if [ "$SKIP_SCAN" -eq 0 ]; then
  echo "Scanning events"
  # shellcheck disable=SC2086
  if ! pnpm --filter @local-events/data-workers dev -- --job event-scan $LIMIT_ARGS; then
    FAILED=1
  fi
fi

exit "$FAILED"
