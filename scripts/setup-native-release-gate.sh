#!/usr/bin/env bash
# Explicit release-CI download, not a product installer or bundled payload.
set -euo pipefail
: "${RUNNER_TEMP:?}" "${GITHUB_ENV:?}" "${PLAYWRIGHT_BROWSERS_PATH:?}"
root="$RUNNER_TEMP/native-t3"
runtime="$RUNNER_TEMP/native-browser-runtime"
mkdir "$runtime"
mkdir "$runtime/node_modules"
ln -s "$RUNNER_TEMP/release-browser/node_modules/playwright-core" "$runtime/node_modules/playwright"
# Reuse the validated fetch contract: release source metadata, published checksum,
# archive and extracted executable must all match official-2644 provenance.
/usr/bin/node wisdom/claude-compat/proof/official-2644/fetch-official.mjs "$root" "$runtime"
mapfile -t browsers < <(find "$PLAYWRIGHT_BROWSERS_PATH" -type f \( -name chrome-headless-shell -o -name headless_shell \))
[[ ${#browsers[@]} == 1 ]]
echo "T3_UPSTREAM=$root" >> "$GITHUB_ENV"
echo "BROWSER_PATH=${browsers[0]}" >> "$GITHUB_ENV"
