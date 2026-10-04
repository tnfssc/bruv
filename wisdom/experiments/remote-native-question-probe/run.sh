#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
BUN_BIN="${BUN_BIN:-$(command -v bun)}"
DIE_BIN="${DIE_BIN:-dist/die}"
NAME="die-native-question-$RANDOM-$$"
IMAGE="die-native-question:$RANDOM-$$"
TMP="$(mktemp -d)"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; docker image rm "$IMAGE" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
cp wisdom/experiments/remote-native-question-probe/{Dockerfile,server.ts,policy.ts} "$TMP/"
cp "$BUN_BIN" "$TMP/bun"
cp "$DIE_BIN" "$TMP/die"
echo "staged die sha256: $(sha256sum "$TMP/die" | cut -d' ' -f1)"
timeout 45s docker build -q -t "$IMAGE" "$TMP" >/dev/null
TOKEN="$(head -c 24 /dev/urandom | xxd -p)"
timeout 10s docker run -d --name "$NAME" --network bridge --memory 768m --cpus 2 --pids-limit 128 --read-only --tmpfs /work:rw,size=64m,uid=65534,gid=65534 -e PROBE_TOKEN="$TOKEN" -p 127.0.0.1::8080 "$IMAGE" >/dev/null
PORT="$(docker port "$NAME" 8080/tcp | sed 's/.*://')"
"$BUN_BIN" test wisdom/experiments/remote-native-question-probe/policy.test.ts
timeout 50s "$BUN_BIN" wisdom/experiments/remote-native-question-probe/verify.ts "$PORT" "$TOKEN"
