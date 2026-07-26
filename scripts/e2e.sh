#!/usr/bin/env bash
#
# Run the E2E lane: migrate, reseed, boot api + web, run Playwright, tear
# everything down.
#
# The reseed matters. The specs drive stock to zero and create orders, so a
# second run against a drained database would fail for reasons that have nothing
# to do with the code. The seed is idempotent and resets stock absolutely, which
# is what makes the lane repeatable.
#
# Usage: ./scripts/e2e.sh [playwright args...]
# Assumes Postgres and Redis are up (infra/docker-compose.yml).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_PID=""
WEB_PID=""

cleanup() {
  for pid in "$WEB_PID" "$API_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

export DATABASE_URL="${DATABASE_URL:-postgresql://shop:shop@localhost:5433/shop?schema=public}"
# Prisma requires directUrl to be set; without a pooler locally it is the same.
export DIRECT_DATABASE_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6380}"
export AUTH_SECRET="${AUTH_SECRET:-ci-secret-at-least-32-characters-long}"
export MOCK_WEBHOOK_SECRET="${MOCK_WEBHOOK_SECRET:-mock-webhook-secret-at-least-32-chars}"
export PAYMENTS_DRIVER=mock
export STORAGE_DRIVER=local
export API_PORT="${API_PORT:-4000}"
export WEB_PORT="${WEB_PORT:-3000}"
export API_BASE_URL="${API_BASE_URL:-http://localhost:${API_PORT}}"
export APP_BASE_URL="${APP_BASE_URL:-http://localhost:${WEB_PORT}}"
export NEXT_PUBLIC_API_BASE_URL="$API_BASE_URL"
# The suite drives many checkouts from one address; production keeps the
# defaults in .env.example.
export RATE_LIMIT_GLOBAL=100000
export RATE_LIMIT_AUTH=100000
export RATE_LIMIT_CHECKOUT=100000

# A leftover server from an interrupted run is the worst failure mode here: the
# new process fails to bind, the suite talks to the stale one, and the results
# describe code that is no longer on disk. The API is probed on /health because
# its root path 404s, which `curl -f` would read as "nothing is listening".
for url in "${API_BASE_URL}/health" "${APP_BASE_URL}/"; do
  if curl -sf "$url" >/dev/null 2>&1; then
    echo "Something is already serving ${url}. Stop it first:" >&2
    echo "  pkill -f 'apps/api/dist/main.js'; pkill -f 'next start'" >&2
    exit 1
  fi
done

echo "==> Migrating and reseeding"
pnpm --filter @shop/db exec prisma migrate deploy >/dev/null
pnpm --filter @shop/db run seed

echo "==> Building"
# NODE_ENV=production is required: `next build` under development produces a
# broken prerender.
NODE_ENV=production pnpm build

echo "==> Starting api, web"
node apps/api/dist/main.js >/tmp/shop-e2e-api.log 2>&1 &
API_PID=$!
pnpm --filter @shop/web exec next start -p "$WEB_PORT" >/tmp/shop-e2e-web.log 2>&1 &
WEB_PID=$!

wait_for() {
  local url="$1" name="$2" pid="$3"
  for _ in $(seq 1 90); do
    if curl -sf "$url" >/dev/null 2>&1; then
      return 0
    fi
    # A process that has already exited will never become healthy, and waiting
    # the full 90 seconds to discover that hides the reason it died.
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "${name} exited during startup. Logs:" >&2
      tail -30 "/tmp/shop-e2e-${name}.log" >&2
      return 1
    fi
    sleep 1
  done
  echo "${name} never came up. Logs:" >&2
  tail -30 "/tmp/shop-e2e-${name}.log" >&2
  return 1
}

wait_for "${API_BASE_URL}/health" api "$API_PID"
wait_for "${APP_BASE_URL}/" web "$WEB_PID"

echo "==> Running Playwright"
pnpm --filter @shop/e2e exec playwright test "$@"
