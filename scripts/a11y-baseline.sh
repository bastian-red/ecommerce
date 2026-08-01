#!/usr/bin/env bash
#
# Record the accessibility baseline, before any design change.
#
# The point is the delta. "The redesign improved accessibility" is worth nothing
# without the number it started from, and once the CSS is rewritten the old
# number is unrecoverable. So this runs the same axe spec the gate runs, but in
# BASELINE=1 mode where findings are written to a file instead of failing the
# run.
#
# Usage: ./scripts/a11y-baseline.sh
# Output: /tmp/shop-a11y/baseline.json  (override with BASELINE_DIR)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export BASELINE=1
export BASELINE_DIR="${BASELINE_DIR:-/tmp/shop-a11y}"
mkdir -p "$BASELINE_DIR"

# One browser is enough: axe's rule engine gives the same answer in both, and
# the second project would only double the runtime for an identical result.
./scripts/e2e.sh --project=chromium a11y.spec.ts

echo
echo "==> Baseline written to ${BASELINE_DIR}/baseline.json"
if command -v jq >/dev/null 2>&1; then
  echo "==> Violation types per route:"
  jq -r 'to_entries[] | "  \(.value | length)\t\(.key)"' "${BASELINE_DIR}/baseline.json"
  echo "==> Distinct rules failing across the app:"
  jq -r '[.[][].id] | unique | .[]' "${BASELINE_DIR}/baseline.json" | sed 's/^/  /'
  echo "==> Total node count:"
  jq '[.[][].nodes] | add // 0' "${BASELINE_DIR}/baseline.json" | sed 's/^/  /'
fi
