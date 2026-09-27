#!/usr/bin/env bash
# Linux-only real CLI / SSH / owner / fake-provider test. No experiment dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."
for tool in docker ssh ssh-keygen timeout python3; do command -v "$tool" >/dev/null || { echo "missing $tool" >&2; exit 1; }; done
DIE_BIN="${DIE_BIN:-$PWD/dist/die}"; BUN_BIN="${BUN_BIN:-$(command -v bun)}"
test -x "$DIE_BIN" && test -x "$BUN_BIN" || { echo 'build dist/die first and supply BUN_BIN if necessary' >&2; exit 1; }
name="die-remote-e2e-$-$RANDOM"; tmp="$(mktemp -d)"; trap 'docker logs --tail 35 "$name" >&2 || true' ERR; trap 'docker rm -f "$name" >/dev/null 2>&1 || true; docker image rm "$name" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
umask 077
ssh-keygen -q -t ed25519 -N '' -f "$tmp/client"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/hostkey"
mkdir "$tmp/build" "$tmp/keys" "$tmp/bin" "$tmp/home" "$tmp/home/.ssh" "$tmp/home/.die" "$tmp/home/agent"
cp tests/fixtures/remote-e2e/{Dockerfile,entrypoint.sh,sshd_config,models.json,subagents.json,fake-provider.ts} "$tmp/build/"
cp "$BUN_BIN" "$tmp/build/bun"; cp "$DIE_BIN" "$tmp/build/die"
cp "$tmp/hostkey" "$tmp/client.pub" "$tmp/keys/"
chmod 644 "$tmp/build"/*; chmod 755 "$tmp/build/bun" "$tmp/build/die" "$tmp/build/entrypoint.sh"
printf 'normal CLI die %s sha256 %s\n' "$("$DIE_BIN" --version)" "$(sha256sum "$DIE_BIN" | cut -d ' ' -f 1)"
timeout 180 docker build -q -t "$name" "$tmp/build" >/dev/null
for attempt in {1..8}; do
 if docker run -d --name "$name" --memory 1g --cpus 2 --pids-limit 192 -p 127.0.0.1::2222 --mount "type=bind,src=$tmp/keys,dst=/keys,readonly" "$name" >"$tmp/container-id"; then break; fi
 docker rm -f "$name" >/dev/null 2>&1 || true
 if (( attempt == 8 )); then echo 'could not bind loopback SSH port' >&2; exit 1; fi
done
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
cat > "$tmp/bin/ssh" <<EOF
#!/bin/sh
exec /usr/bin/ssh -F "$tmp/home/.ssh/config" "\$@"
EOF
chmod 755 "$tmp/bin/ssh"
PATH="$tmp/bin:$PATH" HOME="$tmp/home" DIE_CODING_AGENT_DIR="$tmp/home/agent" DIE_BIN="$DIE_BIN" FIXTURE_CONTAINER="$name" FIXTURE_SSH_CONFIG="$tmp/home/.ssh/config" "$BUN_BIN" scripts/remote-e2e.ts
