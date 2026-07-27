#!/usr/bin/env bash
#
# Record the README's demo GIF from the real Playwright suite.
#
# The frames come from `e2e/tests/demo.spec.ts`, which drives the app through
# the same helpers and selectors the rest of the suite uses. That is the point:
# the demo cannot show a flow the tests do not cover, and it breaks loudly when
# the product does.
#
# Assembled with ImageMagick rather than ffmpeg from Playwright's video, because
# ffmpeg needs a root install and ImageMagick is already here. The result is a
# slideshow of real screens rather than smooth video, which is an honest trade
# for zero extra dependencies.
#
# Usage: ./scripts/demo-gif.sh
# Assumes Postgres and Redis are up (infra/docker-compose.yml).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SHOTS="$ROOT/e2e/demo-shots"
OUT="$ROOT/assets/demo.gif"

command -v convert >/dev/null 2>&1 || {
  echo "ImageMagick's 'convert' is required and was not found." >&2
  exit 1
}

echo "==> Clearing previous frames"
rm -rf "$SHOTS"
mkdir -p "$ROOT/assets"

echo "==> Running the demo spec (chromium only, one worker)"
# --grep re-enables the spec that playwright.config.ts excludes by default.
DEMO=1 "$ROOT/scripts/e2e.sh" --project=chromium --grep "@demo"

shopt -s nullglob
frames=("$SHOTS"/*.png)
if [[ ${#frames[@]} -eq 0 ]]; then
  echo "No frames were produced in ${SHOTS}." >&2
  exit 1
fi
echo "==> Captured ${#frames[@]} frames"

echo "==> Assembling ${OUT}"
# -delay is in hundredths of a second, so 180 holds each frame 1.8s: long enough
# to read a screen, short enough that the whole loop stays under 20 seconds.
# The last frame holds longer so the loop does not snap back mid-thought.
convert -delay 180 -loop 0 "${frames[@]}" \
  -delay 320 "${frames[-1]}" \
  -resize 1000x \
  -layers optimize \
  "$OUT"

size=$(du -h "$OUT" | cut -f1)
bytes=$(stat -c%s "$OUT")
echo "==> ${OUT} (${size})"

# GitHub renders inline reliably below a few MB; past that it becomes a link.
if [[ "$bytes" -gt 3500000 ]]; then
  echo "WARNING: over 3.5MB. Re-run with a smaller -resize, or drop a frame." >&2
fi
