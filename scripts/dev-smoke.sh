#!/usr/bin/env bash
#
# Smoke the documented developer command.
#
# scripts/env-contract.mjs proves the variables are declared. It cannot prove
# they arrive: that depends on package.json pointing "dev" at scripts/dev.sh, on
# dev.sh sourcing .env, and on turbo passing the names through. This boots the
# real `pnpm dev` and asserts the app serves.
#
# Why this is not folded into scripts/e2e.sh: that lane sources .env itself and
# starts `node apps/api/dist/main.js` and `next start` directly, never touching
# turbo. It is a genuinely different path, and it stayed green for months while
# `pnpm dev` was broken. A lane that cannot fail the way production of this
# repo's README fails is not covering it.
#
# Usage: ./scripts/dev-smoke.sh
# Assumes Postgres and Redis are up and the database is migrated and seeded.
set -euo pipefail

# Job control, so each background job lands in its own process group and the
# cleanup below can take down turbo *and* the next/nest children it spawned.
# Killing only the turbo PID leaves the servers holding :3000 and :4000, which
# makes the next run fail for a reason that has nothing to do with the code.
set -m

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEV_PID=""
LOG=/tmp/shop-dev-smoke.log

cleanup() {
  if [[ -n "$DEV_PID" ]] && kill -0 "$DEV_PID" 2>/dev/null; then
    kill -- -"$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

[[ -f .env ]] || { echo "No .env. See README.md, 'Running it'." >&2; exit 1; }

# Read the two URLs the probes need WITHOUT sourcing .env.
#
# This is the difference between a real check and a vacuous one. The first
# version of this script did `set -a; . ./.env`, which put every variable into
# its own environment, where `pnpm dev` inherited them as an ordinary child
# process. It then passed with the fix reverted, because the app was getting its
# configuration from the smoke script rather than from dev.sh. A test that
# supplies the thing it is testing for proves nothing.
env_value() {
  sed -n "s/^[[:space:]]*$1=//p" .env | tail -1
}
API_BASE_URL="$(env_value API_BASE_URL)"
APP_BASE_URL="$(env_value APP_BASE_URL)"
API_BASE_URL="${API_BASE_URL:-http://localhost:4000}"
APP_BASE_URL="${APP_BASE_URL:-http://localhost:3000}"

# Every name .env defines is stripped from the child's environment, so the only
# way the app can see one is if dev.sh loaded it and turbo passed it through.
# That is precisely the path this script exists to cover, and it reproduces what
# a fresh clone experiences: a .env on disk and nothing in the shell.
mapfile -t ENV_KEYS < <(sed -n 's/^[[:space:]]*\([A-Z][A-Z0-9_]*\)=.*/\1/p' .env | sort -u)
UNSET_ARGS=()
for key in "${ENV_KEYS[@]}"; do UNSET_ARGS+=(-u "$key"); done

for url in "${API_BASE_URL}/health" "${APP_BASE_URL}/"; do
  if curl -sf "$url" >/dev/null 2>&1; then
    echo "Something is already serving ${url}. Stop it first." >&2
    exit 1
  fi
done

echo "==> Starting: pnpm dev (with every .env name stripped from the environment)"
env "${UNSET_ARGS[@]}" pnpm dev >"$LOG" 2>&1 &
DEV_PID=$!

# Dev-mode Next compiles a route on first request, so the first GET is slow by
# design. 120s covers a cold .next on a loaded machine without hiding a hang.
wait_for() {
  local url="$1" name="$2"
  for _ in $(seq 1 120); do
    if curl -sf "$url" >/dev/null 2>&1; then return 0; fi
    # A process that has already exited will never become healthy, and waiting
    # out the full timeout hides the reason it died.
    if ! kill -0 "$DEV_PID" 2>/dev/null; then
      echo "pnpm dev exited before ${name} came up. Log:" >&2
      tail -40 "$LOG" >&2
      return 1
    fi
    sleep 1
  done
  echo "${name} never came up at ${url}. Log:" >&2
  tail -40 "$LOG" >&2
  return 1
}

wait_for "${API_BASE_URL}/health" api
wait_for "${APP_BASE_URL}/" web

echo "==> Checking /health reports its dependencies"
health="$(curl -sf "${API_BASE_URL}/health")"
for dep in database redis; do
  if ! grep -q "\"${dep}\":true" <<<"$health"; then
    echo "/health does not report ${dep} healthy: ${health}" >&2
    exit 1
  fi
done

# The load-bearing assertion. Before this fix, `/` answered 200 with a Next error
# page while every API call behind it failed, so a status-code check alone would
# have passed on a completely broken app. Product cards only appear if the server
# render reached the API, which only happens if AUTH_SECRET and API_BASE_URL
# survived the trip through turbo.
echo "==> Checking the homepage rendered real catalog content"
home="$(curl -sf "${APP_BASE_URL}/")"
cards="$(grep -o 'data-testid="product-card"' <<<"$home" | wc -l)"
if [[ "$cards" -lt 1 ]]; then
  echo "Homepage served ${#home} bytes with no product cards. It is an error page, not the shop." >&2
  tail -40 "$LOG" >&2
  exit 1
fi

# The symptoms of the original bug, by name. Any of these in a dev log means the
# environment did not arrive, even if the pages happened to render.
echo "==> Checking the dev log is clean"
if grep -qE "ECONNREFUSED|MissingSecret|AUTH_SECRET is not set|AUTH_SECRET must be set" "$LOG"; then
  echo "pnpm dev logged an environment failure:" >&2
  grep -nE "ECONNREFUSED|MissingSecret|AUTH_SECRET is not set|AUTH_SECRET must be set" "$LOG" >&2
  exit 1
fi

echo "==> OK: pnpm dev serves ${cards} product cards, /health green on database + redis"
