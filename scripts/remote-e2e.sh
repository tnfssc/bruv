#!/usr/bin/env bash
# Linux-only real CLI / SSH / owner / explicitly fake provider test. No external SSH host or real provider.
set -euo pipefail
# The fixture is a human parent CLI, even when launched from a bruv worker.
unset BRUV_SUBAGENT_DEPTH BRUV_SUBAGENT_TYPE BRUV_REMOTE_RUNTIME_STATE
cd "$(dirname "$0")/.."
for tool in docker ssh ssh-keygen timeout python3 curl; do command -v "$tool" >/dev/null || { echo "missing $tool" >&2; exit 1; }; done
if [[ "${REMOTE_E2E_SCRIPT:-}" == scripts/remote-pty-e2e.ts || "${REMOTE_E2E_SCRIPT:-}" == scripts/remote-capability-pty-e2e.ts || "${REMOTE_E2E_SCRIPT:-}" == scripts/remote-recovery-e2e.ts ]]; then command -v tmux >/dev/null || { echo "missing tmux" >&2; exit 1; }; fi
BRUV_BIN="${BRUV_BIN:-$PWD/dist/bruv}"; BUN_BIN="${BUN_BIN:-$(command -v bun)}"
test -x "$BRUV_BIN" && test -x "$BUN_BIN" || { echo 'build dist/bruv first and supply BUN_BIN if necessary' >&2; exit 1; }
name="bruv-remote-e2e-$$-$RANDOM"; mkdir -p "${TMPDIR:-$PWD/.cache}"; tmp="$(mktemp -d "${TMPDIR:-$PWD/.cache}/remote-e2e.XXXXXX")"; trap 'docker logs --tail 35 "$name" >&2 || true' ERR; trap 'docker rm -f "$name" >/dev/null 2>&1 || true; docker image rm "$name" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
umask 077
ssh-keygen -q -t ed25519 -N '' -f "$tmp/client"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/hostkey"
mkdir "$tmp/build" "$tmp/keys" "$tmp/bin" "$tmp/home" "$tmp/home/.ssh" "$tmp/home/.bruv" "$tmp/home/agent"
cp tests/fixtures/remote-e2e/{Dockerfile,entrypoint.sh,sshd_config,models.json,subagents.json,fake-provider.ts} "$tmp/build/"
cp "$BUN_BIN" "$tmp/build/bun"; cp "$BRUV_BIN" "$tmp/build/bruv"
cp "$tmp/hostkey" "$tmp/client.pub" "$tmp/keys/"
chmod 644 "$tmp/build"/*; chmod 755 "$tmp/build/bun" "$tmp/build/bruv" "$tmp/build/entrypoint.sh"
printf 'normal CLI bruv %s sha256 %s\n' "$(HOME="$tmp/home" "$BRUV_BIN" --version)" "$(sha256sum "$BRUV_BIN" | cut -d ' ' -f 1)"
timeout 180 docker build -q -t "$name" "$tmp/build" >/dev/null
for attempt in {1..8}; do
 if docker run -d --name "$name" --memory 1g --cpus 2 --pids-limit 192 -p 127.0.0.1::2222 -p 127.0.0.1::18765 --mount "type=bind,src=$tmp/keys,dst=/keys,readonly" "$name" >"$tmp/container-id"; then break; fi
 docker rm -f "$name" >/dev/null 2>&1 || true
 if (( attempt == 8 )); then echo 'could not bind loopback SSH port' >&2; exit 1; fi
done
provider_port="$(docker port "$name" 18765/tcp)"; [[ "$provider_port" =~ ^127\.0\.0\.1:[0-9]+$ ]] || { echo 'provider not published exclusively on loopback' >&2; exit 1; }
port="$(docker port "$name" 2222/tcp | sed -nE 's/^127\.0\.0\.1:([0-9]+)$/\1/p')"; test -n "$port" || { echo 'SSH not published only on loopback' >&2; exit 1; }
printf '[127.0.0.1]:%s %s\n' "$port" "$(cat "$tmp/hostkey.pub")" > "$tmp/home/.ssh/known_hosts"
cat > "$tmp/home/.ssh/config" <<EOF
Host fixture-owner
  HostName 127.0.0.1
  User root
  Port $port
  IdentityFile $tmp/client
  IdentitiesOnly yes
  IdentityAgent none
  ForwardAgent no
  StrictHostKeyChecking yes
  UserKnownHostsFile $tmp/home/.ssh/known_hosts
  GlobalKnownHostsFile /dev/null
  UpdateHostKeys no
  BatchMode yes
  ConnectTimeout 3
  ControlMaster no
EOF
chmod 600 "$tmp/home/.ssh/"*
for attempt in {1..50}; do
 if HOME="$tmp/home" ssh -F "$tmp/home/.ssh/config" fixture-owner true >/dev/null 2>&1; then break; fi
 if (( attempt == 50 )); then docker logs "$name" >&2; echo 'SSH readiness timeout' >&2; exit 1; fi
 sleep .1
done
for attempt in {1..50}; do
 if [[ "$(curl --silent --max-time 1 -o /dev/null -w '%{http_code}' http://$provider_port/v1/models)" == 404 ]]; then break; fi
 if (( attempt == 50 )); then docker logs "$name" >&2; echo 'provider readiness timeout' >&2; exit 1; fi
 sleep .1
done
if [[ "${REMOTE_E2E_SCRIPT:-}" == scripts/remote-recovery-e2e.ts ]]; then
cat > "$tmp/bin/ssh" <<EOF
#!/bin/sh
# Only the opt-in recovery fixture drops accepted responses; readiness SSH is untouched.
case "\$*" in
  *--remote-control*)
    IFS= read -r request || exit 1
    case "\$request" in
      *'"op":"launch"'*'REMOTE_FIXTURE_MENU_LOST_LAUNCH'*)
        if test -f "$tmp/drop-next-launch"; then
          response=\$(printf '%s\n' "\$request" | /usr/bin/ssh -F "$tmp/home/.ssh/config" "\$@") || exit 1
          python3 -c 'import json,sys; q=json.loads(sys.argv[1]); r=json.loads(sys.argv[2]); assert q["op"] == "launch" and q["taskId"] == r["task"]["taskId"] and r["task"]["state"] in ("accepted", "running")' "\$request" "\$response" || exit 1
          printf '%s\n' "\$response" > "$tmp/dropped-launch.json"
          mv "$tmp/drop-next-launch" "$tmp/launch-drop-used"
          echo 'fixture: accepted owner launch response intentionally lost' >&2
          exit 42
        fi ;;
      *'"op":"answer"'*)
        if test -f "$tmp/drop-next-answer"; then
          response=\$(printf '%s\n' "\$request" | /usr/bin/ssh -F "$tmp/home/.ssh/config" "\$@") || exit 1
          # Verify owner responded to the accepted request BEFORE losing the reply.
          printf '%s' "\$response" | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["task"]["reply"]["replyId"] and r["task"]["reply"]["status"] in ("uncertain", "delivered")' || exit 1
          printf '%s\n' "\$response" > "$tmp/dropped-reply.json"
          mv "$tmp/drop-next-answer" "$tmp/drop-used"
          echo 'fixture: accepted owner answer response intentionally lost' >&2
          exit 42
        fi ;;
    esac
    printf '%s\n' "\$request" | /usr/bin/ssh -F "$tmp/home/.ssh/config" "\$@"
    exit \$? ;;
esac
exec /usr/bin/ssh -F "$tmp/home/.ssh/config" "\$@"
EOF
else
cat > "$tmp/bin/ssh" <<EOF
#!/bin/sh
exec /usr/bin/ssh -F "$tmp/home/.ssh/config" "\$@"
EOF
fi
chmod 755 "$tmp/bin/ssh"
DOCKER_HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')" PATH="$tmp/bin:$PATH" HOME="$tmp/home" BRUV_CODING_AGENT_DIR="$tmp/home/agent" BRUV_BIN="$BRUV_BIN" FIXTURE_CONTAINER="$name" FIXTURE_PROVIDER_URL="http://$provider_port/v1" FIXTURE_SSH_CONFIG="$tmp/home/.ssh/config" FIXTURE_DROP_DIR="$tmp" "$BUN_BIN" "${REMOTE_E2E_SCRIPT:-scripts/remote-e2e.ts}"
