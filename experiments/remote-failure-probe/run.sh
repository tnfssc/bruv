#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
BUN_BIN="${BUN_BIN:-$(command -v bun)}"
DIE_BIN="${DIE_BIN:-dist/die}"
ID="die-failure-$RANDOM-$$"
TMP="$(mktemp -d)"
GATE_PID=''
cleanup(){ if [[ -n "$GATE_PID" ]]; then kill "$GATE_PID" 2>/dev/null || true; wait "$GATE_PID" 2>/dev/null || true; fi; docker rm -f "$ID" >/dev/null 2>&1 || true; docker image rm "$ID" >/dev/null 2>&1 || true; docker volume rm "$ID-data" >/dev/null 2>&1 || true; if [[ "${LAB_KEEP:-0}" != 1 ]]; then rm -rf "$TMP"; else echo "Diagnostics (contains synthetic token): $TMP"; fi; }
trap cleanup EXIT
cp experiments/remote-task-poc/{Dockerfile,owner.ts,bounded-log.ts} "$TMP/"
cp "$BUN_BIN" "$TMP/bun"
cp "$DIE_BIN" "$TMP/die"
"$TMP/die" --version
sha256sum "$TMP/die"
docker build -q -t "$ID" "$TMP" >/dev/null
TOKEN="$(head -c 24 /dev/urandom | xxd -p)"
docker volume create "$ID-data" >/dev/null
docker run -d --name "$ID" --network bridge --memory 768m --cpus 2 --pids-limit 128 --read-only --mount type=volume,source="$ID-data",target=/work -e LAB_TOKEN="$TOKEN" -p 127.0.0.1::8080 "$ID" >/dev/null
PORT="$(docker port "$ID" 8080/tcp | sed 's/.*://')"
client(){ "$BUN_BIN" experiments/remote-task-poc/client.ts "$1" "$PORT" "$TOKEN" "$TMP/replica.jsonl" "${@:2}"; }
ready(){ for i in {1..100}; do if client hello > "$1" 2>/dev/null; then return; fi; sleep .1; done; docker logs "$ID" >&2; echo 'owner not ready' >&2; exit 1; }
ready "$TMP/hello.json"
"$BUN_BIN" experiments/remote-failure-probe/gate.ts "$PORT" > "$TMP/gate.log" 2> "$TMP/gate.err" & GATE_PID=$!
for i in {1..100}; do if grep -q gatePort "$TMP/gate.log"; then break; fi; sleep .05; done
GATE_PORT="$(sed -n 's/.*"gatePort":\([0-9]*\).*/\1/p' "$TMP/gate.log" | head -1)"
test -n "$GATE_PORT"
if "$BUN_BIN" experiments/remote-task-poc/client.ts launch "$GATE_PORT" "$TOKEN" "$TMP/replica.jsonl" stable-a 'Inspect marker then complete follow-up execute.' > "$TMP/lost.json" 2> "$TMP/lost.err"; then echo 'expected transport failure' >&2; exit 1; fi
client launch stable-a 'Inspect marker then complete follow-up execute.' > "$TMP/retry.json"
for i in {1..100}; do
 client sync > "$TMP/progress.json"
 "$BUN_BIN" experiments/remote-failure-probe/events.ts "$PORT" "$TOKEN" "$TMP/hello.json" > "$TMP/before.json"
 if grep -q 'tool_execution_start' "$TMP/before.json"; then break; fi
 sleep .05
done
"$BUN_BIN" experiments/remote-failure-probe/check-before.ts "$TMP"
# The independent owner read can observe tool-start after the prior client sync.
# Catch that event up before checking the offline replica after the kill.
client sync > "$TMP/progress-before-kill.json"
docker kill --signal=KILL "$ID" >/dev/null
docker start "$ID" >/dev/null
PORT="$(docker port "$ID" 8080/tcp | sed 's/.*://')"
ready "$TMP/restarted.json"
"$BUN_BIN" experiments/remote-failure-probe/events.ts "$PORT" "$TOKEN" "$TMP/restarted.json" > "$TMP/after.json"
client launch stable-a 'Inspect marker then complete follow-up execute.' > "$TMP/post-retry.json"
if client sync > "$TMP/stale.out" 2> "$TMP/stale.err"; then echo 'old epoch merged' >&2; exit 1; fi
"$BUN_BIN" experiments/remote-failure-probe/check.ts "$TMP" > "$TMP/result.json"
if "$BUN_BIN" experiments/remote-task-poc/client.ts offline "$TMP/damaged.jsonl" > "$TMP/partial.out" 2> "$TMP/partial.err"; then echo 'partial append silently accepted' >&2; exit 1; fi
grep -Eq "SyntaxError|Unexpected end|JSON Parse" "$TMP/partial.err"
"$BUN_BIN" experiments/remote-task-poc/client.ts offline "$TMP/replica.jsonl" > "$TMP/offline.json"
"$BUN_BIN" experiments/remote-failure-probe/check-canonical.ts "$TMP"
LAB_TRANSCRIPT="$TMP/offline-proof.jsonl" BUN_BIN="$BUN_BIN" DIE_BIN="$DIE_BIN" experiments/remote-task-poc/run.sh > "$TMP/offline-proof.log"
"$BUN_BIN" experiments/remote-task-poc/client.ts offline "$TMP/offline-proof.jsonl" > "$TMP/offline-proof.json"
"$BUN_BIN" experiments/remote-failure-probe/check-offline.ts "$TMP/offline-proof.json"
cp "$TMP/result.json" experiments/remote-failure-probe/results.json
echo 'PASS: real blocked HTTP response, retry, owner SIGKILL, unknown epoch, partial append rejection'
cat experiments/remote-failure-probe/results.json
