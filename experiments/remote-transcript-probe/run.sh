#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
BUN="${BUN:-bun}"
"$BUN" test experiments/remote-transcript-probe
"$BUN" experiments/remote-transcript-probe/probe.ts "${1:-experiments/remote-transcript-probe/fixture.jsonl}"
