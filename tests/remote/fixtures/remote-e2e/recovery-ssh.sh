#!/bin/sh
# Installed by remote-e2e.sh behind its fixture-only SSH shim.
config=$1
drop=$2
shift 2
# Only the opt-in recovery fixture drops accepted responses; readiness SSH is untouched.
case "$*" in
  *--remote-control*)
    IFS= read -r request || exit 1
    case "$request" in
      *'"op":"launch"'*'REMOTE_FIXTURE_MENU_LOST_LAUNCH'*)
        if test -f "$drop/drop-next-launch"; then
          response=$(printf '%s\n' "$request" | /usr/bin/ssh -F "$config" "$@") || exit 1
          python3 -c 'import json,sys; q=json.loads(sys.argv[1]); r=json.loads(sys.argv[2]); assert q["op"] == "launch" and q["taskId"] == r["task"]["taskId"] and r["task"]["state"] in ("accepted", "running")' "$request" "$response" || exit 1
          printf '%s\n' "$response" > "$drop/dropped-launch.json"
          mv "$drop/drop-next-launch" "$drop/launch-drop-used"
          echo 'fixture: accepted owner launch response intentionally lost' >&2
          exit 42
        fi ;;
      *'"op":"answer"'*)
        if test -f "$drop/drop-next-answer"; then
          response=$(printf '%s\n' "$request" | /usr/bin/ssh -F "$config" "$@") || exit 1
          # Verify owner responded to the accepted request BEFORE losing the reply.
          printf '%s' "$response" | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["task"]["reply"]["replyId"] and r["task"]["reply"]["status"] in ("uncertain", "delivered")' || exit 1
          printf '%s\n' "$response" > "$drop/dropped-reply.json"
          mv "$drop/drop-next-answer" "$drop/drop-used"
          echo 'fixture: accepted owner answer response intentionally lost' >&2
          exit 42
        fi ;;
    esac
    printf '%s\n' "$request" | /usr/bin/ssh -F "$config" "$@"
    exit $? ;;
esac
exec /usr/bin/ssh -F "$config" "$@"
