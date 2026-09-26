#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
BUN_BIN="${BUN_BIN:-$(command -v bun)}"
DIE_BIN="${DIE_BIN:-dist/die}"
NAME="die-remote-agent-probe-$$"
IMAGE="die-remote-agent-probe:$$"
TMP="$(mktemp -d)"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; docker image rm "$IMAGE" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
cp experiments/remote-agent-probe/{Dockerfile,server.ts} "$TMP/"
cp "$BUN_BIN" "$TMP/bun"
cp "$DIE_BIN" "$TMP/die"
docker build -q -t "$IMAGE" "$TMP"
TOKEN="$(head -c 24 /dev/urandom | xxd -p)"
docker run -d --name "$NAME" --network bridge --memory 768m --cpus 2 --pids-limit 128 --read-only --tmpfs /work:rw,size=64m,uid=65534,gid=65534 -e PROBE_TOKEN="$TOKEN" -p 127.0.0.1::8080 "$IMAGE" >/dev/null
PORT="$(docker port "$NAME" 8080/tcp | sed 's/.*://')"
client(){ "$BUN_BIN" experiments/remote-agent-probe/client.ts "$1" "$PORT" "$TOKEN"; }
for i in {1..100}; do if client status > "$TMP/ready.json" 2>/dev/null; then break; fi; sleep .1; done
client start > "$TMP/start.json"
for i in {1..100}; do
  client status > "$TMP/progress.json"
  if grep -q '"type":"tool_execution_start"' "$TMP/progress.json"; then break; fi
  sleep .05
done
client detach > "$TMP/detach.json"
# No host requests during this window; server owns all subsequent model turns.
sleep 4
# A new viewer now reconnects.
for i in {1..400}; do
  client status > "$TMP/reconnect.json"
  if grep -q '"phase":"done"' "$TMP/reconnect.json"; then break; fi
  sleep .1
done
"$BUN_BIN" experiments/remote-agent-probe/verify.ts "$TMP/detach.json" "$TMP/reconnect.json"
if [[ -n "${PROBE_TRANSCRIPT:-}" ]]; then cp "$TMP/reconnect.json" "$PROBE_TRANSCRIPT"; fi
