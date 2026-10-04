#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
NODE="${NODE_BIN:-node}"
TSC="${TSC_BIN:-./node_modules/.bin/tsc}"
"$TSC" -p wisdom/experiments/remote-stream-probe/tsconfig.json
"$NODE" --test wisdom/experiments/remote-stream-probe/core.test.ts
"$NODE" wisdom/experiments/remote-stream-probe/probe.ts > wisdom/experiments/remote-stream-probe/results.json
"$NODE" wisdom/experiments/remote-stream-probe/verify.ts
