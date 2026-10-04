#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
for t in docker ssh ssh-keygen python3 sha256sum timeout; do command -v "$t" >/dev/null || { echo "missing required tool: $t" >&2; exit 1; }; done
BUN_BIN="${BUN_BIN:-$(command -v bun)}"
DIE_BIN="${DIE_BIN:-dist/die-ssh-native-question}"
for b in "$BUN_BIN" "$DIE_BIN"; do test -x "$b" || { echo "missing executable: $b" >&2; exit 1; }; done
id="die-ssh-native-question-$$-$RANDOM"; tmp="$(mktemp -d)"; ssh_pid=''
cleanup(){
 [[ -z "$ssh_pid" ]] || { kill "$ssh_pid" 2>/dev/null || true; wait "$ssh_pid" 2>/dev/null || true; }
 docker rm -f "$id-sshd" >/dev/null 2>&1 || true
 docker rm -f "$id-owner" >/dev/null 2>&1 || true
 docker network rm "$id-net" >/dev/null 2>&1 || true
 docker image rm "$id-owner" >/dev/null 2>&1 || true
 docker image rm "$id-sshd" >/dev/null 2>&1 || true
 rm -rf "$tmp"
}
trap cleanup EXIT
trap 'echo "probe failed; owner/sshd logs:" >&2; docker logs --tail 20 "$id-owner" >&2 || true; docker logs --tail 20 "$id-sshd" >&2 || true' ERR
umask 077
ssh-keygen -q -t ed25519 -N '' -f "$tmp/client"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/hostkey"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/wrong"
mkdir "$tmp/owner-context" "$tmp/sshd-keys"
cp "$tmp/hostkey" "$tmp/client.pub" "$tmp/sshd-keys/"
cp wisdom/experiments/remote-native-question-probe/{Dockerfile,server.ts,policy.ts} "$tmp/owner-context/"
cp "$BUN_BIN" "$tmp/owner-context/bun"; cp "$DIE_BIN" "$tmp/owner-context/die"
chmod 644 "$tmp/owner-context"/{Dockerfile,server.ts,policy.ts}
chmod 755 "$tmp/owner-context"/{bun,die}
printf 'staged die: %s sha256 %s\n' "$("$DIE_BIN" --version)" "$(sha256sum "$DIE_BIN" | cut -d' ' -f1)"
printf '{"version":"%s","sha256":"%s"}\n' "$("$DIE_BIN" --version)" "$(sha256sum "$DIE_BIN" | cut -d' ' -f1)" > "$tmp/provenance"
timeout 150 docker build -q -t "$id-owner" "$tmp/owner-context" >/dev/null
timeout 150 docker build -q -t "$id-sshd" -f wisdom/experiments/remote-ssh-probe/sshd.Dockerfile wisdom/experiments/remote-ssh-probe >/dev/null
docker network create "$id-net" >/dev/null
token="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
printf %s "$token" > "$tmp/token"
printf "PROBE_TOKEN=%s\n" "$token" > "$tmp/owner.env"
unset token
# SSH shares the owner's network namespace; forward destination is 127.0.0.1:8080.
# Only the SSH port is published, on host loopback.
for n in {1..8}; do
 if docker run -d --name "$id-owner" --network "$id-net" --memory 768m --cpus 2 --pids-limit 128 --read-only --tmpfs /work:rw,size=64m,uid=65534,gid=65534 --env-file "$tmp/owner.env" -p 127.0.0.1::2222 "$id-owner" >/dev/null; then break; fi
 docker rm -f "$id-owner" >/dev/null 2>&1 || true
 if (( n == 8 )); then echo 'SSH port allocation failed' >&2; exit 1; fi
done
ssh_port="$(docker port "$id-owner" 2222/tcp | sed -nE 's/^127\.0\.0\.1:([0-9]+)$/\1/p')"
test -n "$ssh_port" || { echo 'SSH not bound to loopback' >&2; exit 1; }
docker run -d --name "$id-sshd" --network "container:$id-owner" --memory 128m --cpus 1 --pids-limit 64 --read-only --tmpfs /run/sshd:rw,noexec,nosuid,nodev,mode=0755 --mount "type=bind,src=$tmp/sshd-keys,dst=/keys,readonly" "$id-sshd" >/dev/null
printf '[127.0.0.1]:%s %s\n' "$ssh_port" "$(cat "$tmp/hostkey.pub")" > "$tmp/known_hosts"
printf '[127.0.0.1]:%s %s\n' "$ssh_port" "$(cat "$tmp/wrong.pub")" > "$tmp/bad_hosts"
known="$tmp/bad_hosts"
opts=(-v -F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none -o ForwardAgent=no -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known" -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no -o ConnectTimeout=3 -o ExitOnForwardFailure=yes -i "$tmp/client" -p "$ssh_port")
for n in {1..40}; do
 if timeout 5 ssh "${opts[@]}" root@127.0.0.1 true >"$tmp/bad.out" 2>&1; then echo 'WRONG HOST KEY ACCEPTED' >&2; exit 1; fi
 if grep -Eq 'Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED' "$tmp/bad.out"; then break; fi
 sleep .1
done
grep -Eq 'Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED' "$tmp/bad.out" || { cat "$tmp/bad.out" >&2; docker logs "$id-sshd" >&2 || true; echo 'no host-key rejection' >&2; exit 1; }
for i in "${!opts[@]}"; do [[ "${opts[$i]}" != UserKnownHostsFile=* ]] || opts[$i]="UserKnownHostsFile=$tmp/known_hosts"; done
free_port(){ python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()'; }
start_ssh(){
 for n in {1..8}; do
  local_port="$(free_port)"
  ssh "${opts[@]}" -N -L "127.0.0.1:$local_port:127.0.0.1:8080" root@127.0.0.1 >"$tmp/ssh.out" 2>&1 & ssh_pid=$!
  for poll in {1..60}; do
   if ! kill -0 "$ssh_pid" 2>/dev/null; then break; fi
   if client status > "$tmp/hello" 2>/dev/null; then return; fi
   sleep .01
  done
  kill "$ssh_pid" 2>/dev/null || true
  wait "$ssh_pid" || true; ssh_pid=''
 done
 cat "$tmp/ssh.out" >&2; echo 'SSH bind failed after retries' >&2; exit 1
}
client(){ "$BUN_BIN" wisdom/experiments/remote-ssh-native-question/client.ts "$1" "$local_port" "$tmp" "${@:2}"; }
# All owner API traffic is through the pinned SSH local forward. No owner HTTP port is published.
"$BUN_BIN" test wisdom/experiments/remote-native-question-probe/policy.test.ts
start_ssh
client start
client pending
kill "$ssh_pid"; wait "$ssh_pid" 2>/dev/null || true; ssh_pid=''
if client status >/dev/null 2>&1; then echo 'owner reachable after client SSH cut' >&2; exit 1; fi
sleep .35
start_ssh
client reconnect
client answer
client done
client duplicate
# Store the final readable snapshot on the client, then destroy both servers.
docker rm -f "$id-sshd" "$id-owner" >/dev/null
kill "$ssh_pid" 2>/dev/null || true; wait "$ssh_pid" 2>/dev/null || true; ssh_pid=''
client offline
printf 'SSH native question PASS: pinned host key, disconnect, reconnect, exact reply, follow-up, duplicate and offline readable snapshot; die %s\n' "$(sha256sum "$DIE_BIN" | cut -d' ' -f1)"
