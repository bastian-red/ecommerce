#!/usr/bin/env bash
#
# Run the integration lane end to end: migrate, boot the API, run the suite,
# shut the API down again.
#
# This exists because the sequence is fiddly and easy to get subtly wrong (the
# suite silently passing against a stale API is the failure mode), and because a
# flow run by hand twice should be a command the third time.
#
# Rate limits are raised for the run. The suite fires twenty concurrent
# checkouts from one address, which a production-shaped per-IP budget is
# supposed to refuse. Raising them here keeps the production defaults honest
# instead of weakening them to make a test pass.
#
# Usage: ./scripts/integration.sh
# Assumes Postgres and Redis are up (infra/docker-compose.yml).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOG=/tmp/shop-integration-api.log
API_PID=""

cleanup() {
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

export DATABASE_URL="${DATABASE_URL:-postgresql://shop:shop@localhost:5433/shop?schema=public}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6380}"
export AUTH_SECRET="${AUTH_SECRET:-ci-secret-at-least-32-characters-long}"
export MOCK_WEBHOOK_SECRET="${MOCK_WEBHOOK_SECRET:-mock-webhook-secret-at-least-32-chars}"
export PAYMENTS_DRIVER=mock
export STORAGE_DRIVER=local
export API_PORT="${API_PORT:-4000}"
export API_BASE_URL="${API_BASE_URL:-http://localhost:${API_PORT}}"
export RATE_LIMIT_GLOBAL=100000
export RATE_LIMIT_AUTH=100000
export RATE_LIMIT_CHECKOUT=100000

# A leftover dev server on the port is the nastiest failure mode this script has:
# the new API fails to bind, the suite happily talks to the stale one, and the
# results describe code that is no longer on disk. Refuse to start instead.
if curl -sf "${API_BASE_URL}/health" >/dev/null 2>&1; then
  echo "Something is already serving ${API_BASE_URL}. Stop it first:" >&2
  echo "  pkill -f 'nest start'" >&2
  exit 1
fi

echo "==> Applying migrations"
pnpm --filter @shop/db exec prisma migrate deploy >/dev/null

echo "==> Building the API and the packages it imports"
pnpm --filter @shop/shared --filter @shop/db --filter @shop/payments \
  --filter @shop/storage --filter @shop/notifications --filter @shop/api run build >/dev/null

echo "==> Starting the API on :${API_PORT} (log: ${LOG})"
# Started as plain `node`, not through pnpm or the Nest CLI. Killing a wrapper
# only kills the wrapper: `nest start` spawns `node dist/main` as a grandchild,
# which survives, keeps the port, and makes the next run silently test a stale
# server. `$!` here is the process that actually holds the socket.
node apps/api/dist/main.js >"$LOG" 2>&1 &
API_PID=$!

echo "==> Waiting for /health"
for _ in $(seq 1 60); do
  if curl -sf "${API_BASE_URL}/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "API exited before becoming healthy:" >&2
    tail -30 "$LOG" >&2
    exit 1
  fi
  sleep 1
done

if ! curl -sf "${API_BASE_URL}/health" >/dev/null 2>&1; then
  echo "API never became healthy:" >&2
  tail -30 "$LOG" >&2
  exit 1
fi

echo "==> Running the integration suite"
pnpm --filter @shop/api run test:integration
