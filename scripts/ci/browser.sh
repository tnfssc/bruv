#!/usr/bin/env bash
# One compiled-browser gate. Build in ci.sh; acquire the pinned browser in the workflow.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${RELEASE_BOOT_PLAYWRIGHT:?Run scripts/release/setup-release-browser.sh first}"
export PLAYWRIGHT_CORE="$RELEASE_BOOT_PLAYWRIGHT"
mkdir -p artifacts/ci/browser
for probe in browser-ui browser-workspaces-smoke browser-multiplayer-smoke; do
  args=()
  # The UI probe owns dialogs and multi-view edits. Keep this run on PTY/voice.
  if [[ "$probe" == browser-multiplayer-smoke ]]; then args+=(--voice-only); fi
  bun "scripts/web/$probe.mjs" "${args[@]}" 2>&1 | tee "artifacts/ci/browser/$probe.log"
done
bun test tests/web/browser-probe.test.js 2>&1 | tee artifacts/ci/browser/helpers.log
