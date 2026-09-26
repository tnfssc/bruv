#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
for t in docker ssh ssh-keygen python3 sha256sum timeout; do command -v "$t" >/dev/null || { echo "missing required tool: $t" >&2; exit 1; }; done
BUN_BIN="${BUN_BIN:-/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun}"
DIE_BIN="${DIE_BIN:-/home/tnfssc/Code/die/dist/die}"
for b in "$BUN_BIN" "$DIE_BIN"; do test -x "$b" || { echo "missing executable: $b" >&2; exit 1; }; done
id="die-ssh-probe-$$-$RANDOM"; tmp="$(mktemp -d)"; ssh_pid=''
cleanup(){
 [[ -z "$ssh_pid" ]] || { kill "$ssh_pid" 2>/dev/null || true; wait "$ssh_pid" 2>/dev/null || true; }
 docker rm -f "$id-sshd" "$id-owner" >/dev/null 2>&1 || true
 docker volume rm "$id-data" >/dev/null 2>&1 || true
 docker network rm "$id-net" >/dev/null 2>&1 || true
 docker image rm "$id-owner" "$id-sshd" >/dev/null 2>&1 || true
 rm -rf "$tmp"
}
trap cleanup EXIT
trap 'echo "probe failed; owner/sshd logs:" >&2; docker logs --tail 20 "$id-owner" >&2 || true; docker logs --tail 20 "$id-sshd" >&2 || true' ERR
umask 077
ssh-keygen -q -t ed25519 -N '' -f "$tmp/client"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/hostkey"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/wrong"
cp experiments/remote-task-poc/{Dockerfile,owner.ts,bounded-log.ts,dependency.ts} "$tmp/"
cp "$BUN_BIN" "$tmp/bun"; cp "$DIE_BIN" "$tmp/die"
chmod 644 "$tmp"/{Dockerfile,owner.ts,bounded-log.ts,dependency.ts}
chmod 755 "$tmp"/{bun,die}
printf 'staged die: %s sha256 %s (repo metadata: 0.15.4)\n' "$("$DIE_BIN" --version)" "$(sha256sum "$DIE_BIN" | cut -d' ' -f1)"
printf '{"version":"%s","sha256":"%s"}\n' "$("$DIE_BIN" --version)" "$(sha256sum "$DIE_BIN" | cut -d' ' -f1)" > "$tmp/provenance"
timeout 150 docker build -q -t "$id-owner" "$tmp" >/dev/null
timeout 150 docker build -q -t "$id-sshd" -f experiments/remote-ssh-probe/sshd.Dockerfile experiments/remote-ssh-probe >/dev/null
docker network create "$id-net" >/dev/null
docker volume create "$id-data" >/dev/null
token="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
# SSH shares the owner's network namespace; forward destination is 127.0.0.1:8080.
# Only the SSH port is published, on host loopback.
for n in {1..8}; do
 if docker run -d --name "$id-owner" --network "$id-net" --memory 768m --cpus 2 --pids-limit 128 --read-only --mount "type=volume,source=$id-data,target=/work" -e "LAB_TOKEN=$token" -p 127.0.0.1::2222 "$id-owner" >/dev/null; then break; fi
 docker rm -f "$id-owner" >/dev/null 2>&1 || true
 if (( n == 8 )); then echo 'SSH port allocation failed' >&2; exit 1; fi
done
ssh_port="$(docker port "$id-owner" 2222/tcp | sed -nE 's/^127\.0\.0\.1:([0-9]+)$/\1/p')"
test -n "$ssh_port" || { echo 'SSH not bound to loopback' >&2; exit 1; }
docker run -d --name "$id-sshd" --network "container:$id-owner" --memory 128m --cpus 1 --pids-limit 64 --read-only --tmpfs /run/sshd --mount "type=bind,src=$tmp,dst=/keys,readonly" "$id-sshd" >/dev/null
printf '[127.0.0.1]:%s %s\n' "$ssh_port" "$(cat "$tmp/hostkey.pub")" > "$tmp/known_hosts"
printf '[127.0.0.1]:%s %s\n' "$ssh_port" "$(cat "$tmp/wrong.pub")" > "$tmp/bad_hosts"
known="$tmp/bad_hosts"
opts=(-F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes -o IdentityAgent=none -o ForwardAgent=no -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known" -o GlobalKnownHostsFile=/dev/null -o UpdateHostKeys=no -o ConnectTimeout=3 -o ExitOnForwardFailure=yes -i "$tmp/client" -p "$ssh_port")
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
  sleep .25
  if kill -0 "$ssh_pid" 2>/dev/null; then return; fi
  wait "$ssh_pid" || true; ssh_pid=''
 done
 cat "$tmp/ssh.out" >&2; echo 'SSH bind failed after retries' >&2; exit 1
}
client(){ "$BUN_BIN" experiments/remote-task-poc/client.ts "$1" "$local_port" "$token" "$tmp/replica.jsonl" "${@:2}"; }
ms(){ python3 -c 'import time;print(round(time.monotonic()*1000))'; }
start="$(ms)"; start_ssh
for n in {1..80}; do if client hello > "$tmp/hello" 2>/dev/null; then break; fi; sleep .1; done
test -s "$tmp/hello" || { echo 'owner not ready via SSH' >&2; exit 1; }
cold=$(( $(ms) - start ))
client launch task-a 'Inspect marker then complete follow-up execute.' > "$tmp/launch"
client launch task-a 'Inspect marker then complete follow-up execute.' > "$tmp/retry"
"$BUN_BIN" -e 'const x=await Bun.file(process.argv[1]).json();if(!x.duplicate)throw Error("retry not duplicate")' "$tmp/retry"
for n in {1..120}; do
 client sync > "$tmp/progress"
 if grep -q '"type":"tool_execution_start"' "$tmp/replica.jsonl"; then break; fi
 sleep .05
done
grep -q '"type":"tool_execution_start"' "$tmp/replica.jsonl" || { echo 'no tool start before cut' >&2; exit 1; }
kill "$ssh_pid"; wait "$ssh_pid" 2>/dev/null || true; ssh_pid=''
if client hello >/dev/null 2>&1; then echo 'owner reachable without SSH' >&2; exit 1; fi
sleep 4
start="$(ms)"; start_ssh
for n in {1..150}; do
 client sync > "$tmp/sync"
 if grep -q '"type":"outcome"' "$tmp/replica.jsonl"; then break; fi
 sleep .1
done
warm=$(( $(ms) - start ))
grep -q '"type":"outcome"' "$tmp/replica.jsonl" || { echo 'remote task did not finish' >&2; exit 1; }
docker rm -f "$id-sshd" "$id-owner" >/dev/null
kill "$ssh_pid" 2>/dev/null || true; wait "$ssh_pid" 2>/dev/null || true; ssh_pid=''
client offline > "$tmp/offline"
"$BUN_BIN" experiments/remote-task-poc/verify.ts "$tmp"
printf 'SSH PASS wrong host key rejected; cold setup+hello %sms; warm reconnect+catchup %sms\n' "$cold" "$warm"
