#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
BUN_BIN="${BUN_BIN:-$(command -v bun)}"
DIE_BIN="${DIE_BIN:-dist/die}"
ID="die-task-lab-$$-$RANDOM"
TMP="$(mktemp -d)"
cleanup(){ docker rm -f "$ID" >/dev/null 2>&1 || true; docker image rm "$ID" >/dev/null 2>&1 || true; docker volume rm "$ID-data" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
cp experiments/remote-task-poc/{Dockerfile,owner.ts,bounded-log.ts} "$TMP/"
cp "$BUN_BIN" "$TMP/bun"
cp "$DIE_BIN" "$TMP/die"
DIE_SHA256="$(sha256sum "$TMP/die" | cut -d' ' -f1)"
DIE_VERSION="$("$TMP/die" --version)"
printf '{"version":"%s","sha256":"%s"}\n' "$DIE_VERSION" "$DIE_SHA256" > "$TMP/provenance"
docker build -q -t "$ID" "$TMP" >/dev/null
TOKEN="$(head -c 24 /dev/urandom | xxd -p)"
docker volume create "$ID-data" >/dev/null
docker run -d --name "$ID" --network bridge --memory 768m --cpus 2 --pids-limit 128 --read-only --mount type=volume,source="$ID-data",target=/work -e LAB_TOKEN="$TOKEN" -p 127.0.0.1::8080 "$ID" >/dev/null
PORT="$(docker port "$ID" 8080/tcp | sed 's/.*://')"
client(){ "$BUN_BIN" experiments/remote-task-poc/client.ts "$1" "$PORT" "$TOKEN" "$TMP/replica.jsonl" "${@:2}"; }
READY=0
for i in {1..100}; do if client hello > "$TMP/hello" 2>/dev/null; then READY=1; break; fi; sleep .1; done
if [ "$READY" -ne 1 ]; then docker logs "$ID" >&2; echo "initial readiness timeout" >&2; exit 1; fi
"$BUN_BIN" experiments/remote-task-poc/protocol.ts "$PORT" "$TOKEN"
client launch task-a 'Inspect marker then complete follow-up execute.' > "$TMP/launch"
client launch task-a 'Inspect marker then complete follow-up execute.' > "$TMP/retry"
if client launch task-a "conflict" >/dev/null 2>&1; then echo "conflict accepted" >&2; exit 1; fi
for i in {1..120}; do
 client sync > "$TMP/progress"
 if grep -q '"type":"tool_execution_start"' "$TMP/replica.jsonl"; then break; fi
 sleep .05
done
sleep 4
for i in {1..180}; do
 client sync > "$TMP/sync"
 if grep -q '"type":"outcome"' "$TMP/replica.jsonl"; then break; fi
 sleep .1
done
docker restart "$ID" >/dev/null
PORT="$(docker port "$ID" 8080/tcp | sed 's/.*://')"
READY=0
for i in {1..100}; do if client hello > "$TMP/restarted" 2>/dev/null; then READY=1; break; fi; sleep .1; done
if [ "$READY" -ne 1 ]; then docker logs "$ID" >&2; echo "restart readiness timeout" >&2; exit 1; fi
"$BUN_BIN" experiments/remote-task-poc/restart-check.ts "$TMP/hello" "$TMP/restarted"
if client sync >/dev/null 2>&1; then echo "cross-epoch merge accepted" >&2; exit 1; fi
docker rm -f "$ID" >/dev/null
client offline > "$TMP/offline"
"$BUN_BIN" experiments/remote-task-poc/verify.ts "$TMP"
