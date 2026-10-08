#!/usr/bin/env bash
# Harness downloads only; never cache product binaries or skip their browser gate.
set -euo pipefail
export PLAYWRIGHT_BROWSERS_PATH="$RUNNER_TEMP/release-browser/chromium"
echo "PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH" >> "$GITHUB_ENV"
echo "RELEASE_BOOT_PLAYWRIGHT=$RUNNER_TEMP/release-browser/node_modules/playwright-core/index.mjs" >> "$GITHUB_ENV"
mkdir -p "$RUNNER_TEMP/release-browser"
printf '{"private":true}\n' > "$RUNNER_TEMP/release-browser/package.json"
# Same Playwright runtime as the official-2644 bounded proof.
bun add --cwd "$RUNNER_TEMP/release-browser" playwright-core@1.63.0
cli="$RUNNER_TEMP/release-browser/node_modules/playwright-core/cli.js"
# The gate launches Chromium headless without a channel: Playwright uses this shell.
bun "$cli" install --only-shell chromium
# Hosted Ubuntu already carries Chrome libraries. Avoid upgrading the entire
# browser dependency/font set on each run; install it if shared libraries lack.
# ldd failures are fatal; only a demonstrated missing library selects fallback.
mapfile -t shells < <(find "$PLAYWRIGHT_BROWSERS_PATH" -type f \( -name chrome-headless-shell -o -name headless_shell \))
[[ ${#shells[@]} == 1 ]] || { echo 'Expected exactly one pinned Chromium headless shell' >&2; exit 1; }
libraries="$RUNNER_TEMP/release-browser/shared-libraries.txt"
ldd "${shells[0]}" > "$libraries"
if grep -q 'not found' "$libraries"; then
  bun "$cli" install-deps chromium
fi
ldd "${shells[0]}" > "$libraries"
if grep -q 'not found' "$libraries"; then
  cat "$libraries" >&2
  exit 1
fi
