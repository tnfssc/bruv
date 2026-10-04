#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
BUN="${BUN_BIN:-$(command -v bun)}"
PROJECT="die-network-lab-$$"
OUT="${LAB_RESULTS:-/tmp/die-network-lab-results-$$.json}"
TMP="$(mktemp -d)"
D=(docker compose -f wisdom/experiments/remote-network-lab/compose.yaml -p "$PROJECT")
cleanup() { "${D[@]}" down -v >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
"${D[@]}" up -d
ready=false
for i in {1..100}; do
  if curl -fsS http://127.0.0.1:18783/health >/dev/null && curl -fsS http://127.0.0.1:18785/version >/dev/null; then ready=true; break; fi
  sleep .1
done
if [[ "$ready" != true ]]; then echo "lab did not become ready" >&2; exit 1; fi
"$BUN" wisdom/experiments/remote-network-lab/setup.ts
"$BUN" test wisdom/experiments/remote-network-lab/client.test.ts
"$BUN" wisdom/experiments/remote-network-lab/demo.ts > "$OUT"
export LAB_REPLICA="$TMP/offline.json"
"$BUN" wisdom/experiments/remote-network-lab/client.ts launch offline-proof plain
sleep 1
"$BUN" wisdom/experiments/remote-network-lab/client.ts sync > "$TMP/synced.json"
"${D[@]}" stop owner
"$BUN" wisdom/experiments/remote-network-lab/client.ts offline > "$TMP/offline-read.json"
"$BUN" -e 'const s=await Bun.file(process.argv[1]).json(); if(s.tasks["offline-proof"]?.status!=="done") throw Error("offline read failed"); console.log("PASS: completed transcript readable with server stopped, cursor="+s.cursor)' "$TMP/offline-read.json"
printf 'Results: %s\n' "$OUT"
