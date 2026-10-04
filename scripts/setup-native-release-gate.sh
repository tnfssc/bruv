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
node wisdom/claude-compat/proof/official-2644/fetch-official.mjs "$root" "$runtime"
mapfile -t browsers < <(find "$PLAYWRIGHT_BROWSERS_PATH" -type f \( -name chrome-headless-shell -o -name headless_shell \))
[[ ${#browsers[@]} == 1 ]]
echo "T3_UPSTREAM=$root" >> "$GITHUB_ENV"
echo "BROWSER_PATH=${browsers[0]}" >> "$GITHUB_ENV"

# Read native child history with the exact SDK used by this official T3 pin.
sdk="$RUNNER_TEMP/native-claude-sdk"
mkdir "$sdk"
curl -fL --retry 3 https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.276.tgz -o "$sdk/sdk.tgz"
printf 'f65a23c8272467ec37da496c5a349b10b3b4d04f052209f239f028c5aabdc3ca  %s\n' "$sdk/sdk.tgz" | sha256sum -c -
tar -xzf "$sdk/sdk.tgz" -C "$sdk"
node --input-type=module -e 'const sdk=await import(process.argv[1]); if(typeof sdk.getSubagentMessages!=="function") throw Error("Pinned SDK history API missing");' "$sdk/package/sdk.mjs"
echo "BRUV_CLAUDE_SDK_PATH=$sdk/package/sdk.mjs" >> "$GITHUB_ENV"
