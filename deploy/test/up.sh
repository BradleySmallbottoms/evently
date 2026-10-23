#!/bin/sh
# Build and start the test server. Run on the instance, from anywhere:
#   sh deploy/test/up.sh
set -eu
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Copy deploy/test/.env.example to deploy/test/.env and fill it in." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

missing=0
for name in DOMAIN ACME_EMAIL POSTGRES_PASSWORD STATS_WORKER_TOKEN SESSION_SECRET \
  S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY GARAGE_RPC_SECRET GARAGE_ADMIN_TOKEN \
  GARAGE_METRICS_TOKEN ADMIN_BOOTSTRAP_EMAIL ADMIN_BOOTSTRAP_PASSWORD; do
  eval "value=\${$name-}"
  if [ -z "$value" ]; then
    echo "Missing $name in deploy/test/.env" >&2
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  exit 1
fi

export COMPOSE_BAKE="${COMPOSE_BAKE:-true}"

sed \
  -e "s/__RPC_SECRET__/${GARAGE_RPC_SECRET}/" \
  -e "s/__ADMIN_TOKEN__/${GARAGE_ADMIN_TOKEN}/" \
  -e "s/__METRICS_TOKEN__/${GARAGE_METRICS_TOKEN}/" \
  garage.toml.template > garage.toml
chmod 600 garage.toml

echo "Migrating…"
docker compose up -d --build --force-recreate migrate
docker compose wait migrate

echo "Opening the asset bucket…"
docker compose up -d garage
docker compose up -d --force-recreate garage-init
i=0
state=""
while [ "$i" -lt 30 ]; do
  id=$(docker compose ps -aq garage-init || true)
  if [ -n "$id" ]; then
    state=$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$id" || true)
    if [ "$state" = "exited 0" ]; then
      break
    fi
  fi
  i=$((i + 1))
  sleep 2
done
if [ "$state" != "exited 0" ]; then
  echo "Garage did not allow public website reads." >&2
  docker compose logs --tail=80 garage garage-init
  exit 1
fi

echo "Starting the apps. The first Next.js build needs several minutes and the swap file."
docker compose up -d --build

echo
echo "Web:    https://app.${DOMAIN}"
echo "Admin:  https://admin.${DOMAIN}"
echo "API:    https://api.${DOMAIN}/health"
echo "Assets: https://assets.${DOMAIN}"
docker compose ps
