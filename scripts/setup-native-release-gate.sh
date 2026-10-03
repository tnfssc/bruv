#!/usr/bin/env bash
# Explicit release-CI download, not a product installer or bundled payload.
set -euo pipefail
: "${RUNNER_TEMP:?}" "${GITHUB_ENV:?}" "${PLAYWRIGHT_BROWSERS_PATH:?}"
root="$RUNNER_TEMP/native-t3"
mkdir -p "$root/platform" "$root/runtime/node_modules"
archive="$root/t3.tar.gz"
curl -fL --retry 3 https://github.com/pingdotgg/t3code/releases/download/v0.0.46-nightly.20261003.2623/t3-0.0.46-nightly.20261003.2623-linux-x64.tar.gz -o "$archive"
printf '624c3aa1b7809282cd32223a37aaa1501d4b099db1364cdc0a33699e063644c3  %s\n' "$archive" | sha256sum -c -
tar -xzf "$archive" --strip-components=1 -C "$root/platform"
test -x "$root/platform/t3"
ln -s "$RUNNER_TEMP/release-browser/node_modules/playwright-core" "$root/runtime/node_modules/playwright"
mapfile -t browsers < <(find "$PLAYWRIGHT_BROWSERS_PATH" -type f \( -name chrome-headless-shell -o -name headless_shell \))
[[ ${#browsers[@]} == 1 ]]
echo "T3_UPSTREAM=$root" >> "$GITHUB_ENV"
echo "BROWSER_PATH=${browsers[0]}" >> "$GITHUB_ENV"
