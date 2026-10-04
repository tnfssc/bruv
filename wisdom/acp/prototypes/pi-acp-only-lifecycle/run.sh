#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd -- "$(dirname -- "$0")" && pwd)
export BRUV_PARENT_REPO=${BRUV_PARENT_REPO:-/home/tnfssc/Code/bruv}
export PROOF_PORT=${PROOF_PORT:-18784}
mkdir -p "$PWD/.cache"
R=$(mktemp -d "$PWD/.cache/pi-acp-only-proof.XXXXXX")
echo "Private runtime: $R (do not publish wholesale)"
mkdir -p "$R"/{agent,home,project,npm-cache}
git clone --no-hardlinks "$BRUV_PARENT_REPO/.cache/acp-pi-peer/source" "$R/source"
git -C "$R/source" checkout b0581c9c1d675e634234674484247008b03d69b4
git -C "$R/source" apply "$HERE/adapter.patch"
(cd "$R/source"; npm ci --ignore-scripts --cache "$R/npm-cache"; npm run typecheck; npm test; npm run build)
chmod +x "$R/source/dist/index.js"
export PROOF_ADAPTER="$R/source/dist/index.js"
git -C "$R/project" init -q
git -C "$R/project" -c user.name=Proof -c user.email=proof@example.invalid commit --allow-empty -qm initial
cp "$HERE"/{trial-runner.mjs,browser-driver.mjs,export-history.py} "$R/"
node "$R/trial-runner.mjs" > "$R/runner-private.log" 2>&1 & RUNNER=$!
trap 'touch "$R/runner-stop"; wait "$RUNNER" || true' EXIT
for i in {1..100}; do if grep -q 'pairingUrl:' "$R/server-private.log" 2>/dev/null; then break; fi; sleep .2; done
node "$R/browser-driver.mjs"
python3 "$R/export-history.py" "$R"
touch "$R/runner-stop"
wait "$RUNNER"
trap - EXIT
