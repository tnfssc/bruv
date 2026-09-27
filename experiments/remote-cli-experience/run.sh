#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
for t in docker ssh ssh-keygen python3 sha256sum timeout curl; do command -v "$t" >/dev/null || { echo "missing required tool: $t" >&2; exit 1; }; done
BUN_BIN="${BUN_BIN:-$(command -v bun)}"
DIE_BIN="${DIE_BIN:-dist/die-remote-cli-experience}"
for b in "$BUN_BIN" "$DIE_BIN"; do test -x "$b" || { echo "missing executable: $b" >&2; exit 1; }; done
id="die-remote-cli-experience-$$-$RANDOM"; tmp="$(mktemp -d)"; ssh_pid=''
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
cp experiments/remote-native-question-probe/{Dockerfile,server.ts,policy.ts} "$tmp/owner-context/"
cp experiments/remote-cli-experience/log.ts "$tmp/owner-context/"
sed -i "/COPY policy.ts/a COPY log.ts /opt/log.ts\nRUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*" "$tmp/owner-context/Dockerfile"
cp "$BUN_BIN" "$tmp/owner-context/bun"; cp "$DIE_BIN" "$tmp/owner-context/die"
chmod 644 "$tmp/owner-context"/{Dockerfile,server.ts,policy.ts,log.ts}
chmod 755 "$tmp/owner-context"/{bun,die}
printf 'staged die: %s sha256 %s\n' "$("$DIE_BIN" --version)" "$(sha256sum "$DIE_BIN" | cut -d' ' -f1)"
printf '{"version":"%s","sha256":"%s"}\n' "$("$DIE_BIN" --version)" "$(sha256sum "$DIE_BIN" | cut -d' ' -f1)" > "$tmp/provenance"
timeout 150 docker build -q -t "$id-owner" "$tmp/owner-context" >/dev/null
timeout 150 docker build -q -t "$id-sshd" -f experiments/remote-ssh-probe/sshd.Dockerfile experiments/remote-ssh-probe >/dev/null
docker network create "$id-net" >/dev/null
token="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
printf %s "$token" > "$tmp/token"
printf "PROBE_TOKEN=%s\nEXPERIENCE_MODE=1\n" "$token" > "$tmp/owner.env"
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
client(){ REMOTE_CLI_STATE="$tmp/state.json" REMOTE_CLI_PORT="$local_port" REMOTE_CLI_TOKEN="$(cat "$tmp/token")" "$BUN_BIN" experiments/remote-cli-experience/cli.ts "$@"; }
# Only pinned SSH forwards owner traffic. Interactive pauses accept CLI commands in this process.
manual(){
 [[ "${1:-}" != "--interactive" ]] && return
 echo "Manual CLI: connect | launch | launch-repo <root> --allow-history-bundle [--grant-repo-read] | status | sync | serve-read | cancel-file-task | transcript | offline | answer <id> A; type continue to advance."
 while true; do read -r -p "remote-cli> " line || break; [[ "$line" == continue ]] && break; read -r -a words <<< "$line"; [[ "${#words[@]}" -eq 0 ]] || client "${words[@]}"; done
}

start_ssh
client connect | tee "$tmp/connect.out"
manual "${1:-}"
if [[ "${1:-}" == --repo-safe || "${1:-}" == --repo-conflict || "${1:-}" == --repo-read || "${1:-}" == --repo-read-denied || "${1:-}" == --repo-read-cancel ]]; then
 repo="$tmp/fixture-repo"; mkdir "$repo"; git -C "$repo" init -q; git -C "$repo" config user.email fixture@example.invalid; git -C "$repo" config user.name Fixture
 printf 'base\n' > "$repo/fixture.txt"; git -C "$repo" add fixture.txt; git -C "$repo" commit -qm base
 printf 'staged\n' >> "$repo/fixture.txt"; git -C "$repo" add fixture.txt
 printf 'unstaged\n' >> "$repo/fixture.txt"; printf 'secret not sent\n' > "$repo/omitted.secret"
 if [[ "${1:-}" == --repo-read || "${1:-}" == --repo-read-denied || "${1:-}" == --repo-read-cancel ]]; then printf "CAPABILITY_FILE_OK: fresh offline-only fixture\n" > "$repo/on-demand.txt"; client launch-repo "$repo" --allow-history-bundle --grant-repo-read | tee "$tmp/launch.out"; else client launch-repo "$repo" --allow-history-bundle | tee "$tmp/launch.out"; fi
 test ! -e "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["repo"]["folder"])' "$tmp/state.json")/snapshot/omitted.secret"
else client launch | tee "$tmp/launch.out"; fi
if [[ "${1:-}" == --repo-read || "${1:-}" == --repo-read-denied || "${1:-}" == --repo-read-cancel ]]; then
 test ! -e "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["repo"]["folder"])' "$tmp/state.json")/snapshot/on-demand.txt"
 client launch > "$tmp/retry.out"
 for i in {1..150}; do client sync > "$tmp/sync.out"; grep -q 'repo_file_read_requested' "$tmp/state.json.events" && break; sleep .1; done
 grep -q 'repo_file_read_requested' "$tmp/state.json.events"
 kill "$ssh_pid"; wait "$ssh_pid" 2>/dev/null || true; ssh_pid=''
 client offline > "$tmp/offline.out"
 grep -q 'INDEPENDENT REMOTE STEP' "$tmp/offline.out"
 grep -q repo_file_read_requested "$tmp/offline.out"
 if client serve-read > "$tmp/disconnected.out" 2>&1; then echo 'served while disconnected' >&2; exit 1; fi
 start_ssh
 client sync > "$tmp/reconnect.out"
 request_id="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["fileRequest"]["id"])' "$tmp/state.json")"
 task_id="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["intent"]["id"])' "$tmp/state.json")"
 owner_id="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["identity"])' "$tmp/state.json")"
 reply(){ curl -sS -o "$tmp/http-body" -w '%{http_code}' -H "Authorization: Bearer $(cat "$tmp/token")" -H 'Content-Type: application/json' -d "$1" "http://127.0.0.1:$local_port/experience/file-reply"; }
 payload(){ python3 -c 'import json,sys;print(json.dumps(dict(owner=sys.argv[1],task=sys.argv[2],id=sys.argv[3],status="ok",text=sys.argv[4],error="")))' "$1" "$2" "$3" "$4"; }
 test "$(reply "$(payload stale "$task_id" "$request_id" bad)")" == 409
 test "$(reply "$(payload "$owner_id" stale "$request_id" bad)")" == 409
 test "$(reply "$(payload "$owner_id" "$task_id" stale bad)")" == 409
 if [[ "${1:-}" == --repo-read-cancel ]]; then
   client cancel-file-task
   test "$(reply "$(payload "$owner_id" "$task_id" "$request_id" late)")" == 409
   if client serve-read > "$tmp/cancel-refusal.out" 2>&1; then echo 'cancelled task served' >&2; exit 1; fi
   client sync > "$tmp/cancel-sync.out"; client offline > "$tmp/cancel-offline.out"
   grep -q repo_file_task_cancelled "$tmp/cancel-offline.out"
   docker rm -f "$id-sshd" "$id-owner" >/dev/null
   echo 'PASS cancelled pending file task remains ended, late response rejected'; exit 0
 fi
 if [[ "${1:-}" == --repo-read-denied ]]; then rm "$repo/on-demand.txt"; fi
 client serve-read | tee "$tmp/read.out"
 client serve-read | tee "$tmp/duplicate.out"
 test "$(reply "$(payload "$owner_id" "$task_id" "$request_id" conflict)")" == 409
 grep -q duplicate "$tmp/duplicate.out"
 for i in {1..100}; do client sync > "$tmp/final.out"; grep -q 'task ended' "$tmp/final.out" && break; sleep .1; done
 grep -q 'task ended' "$tmp/final.out"
 test "$(reply "$(payload "$owner_id" "$task_id" "$request_id" "CAPABILITY_FILE_OK: fresh offline-only fixture")")" == 409
 client offline > "$tmp/final-offline.out"
 if [[ "${1:-}" == --repo-read-denied ]]; then grep -q 'FILE READ DENIED OR ERROR' "$tmp/final-offline.out"; grep -q 'file read denied' "$tmp/final-offline.out"; else grep -q 'CAPABILITY_FILE_OK' "$tmp/final-offline.out"; fi
 if [[ "${1:-}" == --repo-read ]]; then grep -q 'REMOTE FILE CONTENT' "$tmp/final-offline.out"; fi
 docker rm -f "$id-sshd" "$id-owner" >/dev/null
 echo 'PASS pinned SSH on-demand repo read, offline independent step, wait/resume and real execute consumption'
 exit 0
fi
client launch | tee "$tmp/retry.out"
for i in {1..100}; do
 client sync > "$tmp/sync.out"
 if grep -q 'waiting for answer' "$tmp/sync.out"; then break; fi
 sleep .1
done
grep -q 'waiting for answer' "$tmp/sync.out"
kill "$ssh_pid"; wait "$ssh_pid" 2>/dev/null || true; ssh_pid=''
client offline > "$tmp/offline.out"
grep -q 'waiting for answer' "$tmp/offline.out"
grep -q 'tool_execution_end' "$tmp/offline.out"
grep -q 'durable paged events' "$tmp/offline.out"
if client status > "$tmp/disconnected.out" 2>&1; then echo 'status unexpectedly online' >&2; exit 1; fi
manual "${1:-}"
start_ssh
client sync > "$tmp/reconnect.out"
manual "${1:-}"
q_id="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["question"]["id"])' "$tmp/state.json")"
if client answer "$q_id" B > "$tmp/rejected.out" 2>&1; then echo "unsupported answer accepted" >&2; exit 1; fi
grep -q "exact choice A only" "$tmp/rejected.out"
client answer "$q_id" A | tee "$tmp/answer.out"
for i in {1..100}; do
 client sync > "$tmp/final.out"
 if grep -q ' fixture complete' "$tmp/final.out"; then break; fi
 sleep .1
done
grep -q ' fixture complete' "$tmp/final.out" || { cat "$tmp/final.out" >&2; exit 1; }
if [[ "${1:-}" == --repo-safe || "${1:-}" == --repo-conflict ]]; then
 if [[ "${1:-}" == --repo-conflict ]]; then printf 'local divergence\n' >> "$repo/fixture.txt"; fi
 client return | tee "$tmp/return.out"
 test -s "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["repo"]["artifact"])' "$tmp/state.json")"
 if [[ "${1:-}" == --repo-safe ]]; then
   grep -q 'return applied' "$tmp/return.out"; grep -q 'remote-die-editremote-unstaged-edit' "$repo/fixture.txt"
   git -C "$repo" diff --cached | grep -q staged
   git -C "$repo" ls-files --others --exclude-standard | grep -q omitted.secret
 else grep -q 'return review' "$tmp/return.out"; ! grep -q remote-die-edit "$repo/fixture.txt"; fi
 client return | tee "$tmp/duplicate.out"
 if [[ "${1:-}" == --repo-safe ]]; then grep -q 'duplicate refused' "$tmp/duplicate.out"; else grep -q 'return review' "$tmp/duplicate.out"; fi
 fi
client transcript > "$tmp/transcript.out"
grep -q 'SAVED ANSWER OBSERVED' "$tmp/transcript.out"
grep -q 'tool_execution_end' "$tmp/transcript.out"
docker rm -f "$id-sshd" "$id-owner" >/dev/null
kill "$ssh_pid" 2>/dev/null || true; wait "$ssh_pid" 2>/dev/null || true; ssh_pid=''
client offline > "$tmp/final-offline.out"
grep -q 'SAVED ANSWER OBSERVED' "$tmp/final-offline.out"
grep -q 'tool_execution_end' "$tmp/final-offline.out"
if [[ -n "${LAB_EXPERIENCE_STATE:-}" ]]; then cp "$tmp/state.json" "$LAB_EXPERIENCE_STATE"; cp "$tmp/state.json.events" "$LAB_EXPERIENCE_STATE.events"; fi
printf 'PASS pinned SSH, offline durable paged RPC events, exact native question, follow-up; %s events\n' "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["count"])' "$tmp/state.json")"
