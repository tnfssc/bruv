#!/usr/bin/env bash
# An owned, hardware-free PipeWire graph; never touches the desktop server.
set -euo pipefail
# With --, run a local fixture in this graph; otherwise run provider acceptance.
if [[ ${1:-} == -- ]]; then
  shift
  (( $# )) || { echo 'Expected a command after --' >&2; exit 1; }
  command=("$@")
else
  command=(bun scripts/live/acceptance.ts "$@")
  for tool in parec pacat bun; do
    command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }
  done
fi
for tool in pipewire pipewire-pulse wireplumber pw-dump pactl python3 mktemp timeout; do
  command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }
done

cleanup() {
  local status=$?
  if (( status )); then
    local log
    for log in core pulse manager; do
      echo "Private $log log:" >&2
      tail -15 "$root/$log.log" >&2 2>/dev/null || :
    done
  fi

  # Snapshot the fixture's children before stopping their parent. Both shutdown
  # stages must cover the same processes, with the graph alive until last.
  local pid
  local -a owned_pids=()
  if [[ -n "$test_pid" ]]; then
    mapfile -t owned_pids < <(ps -o pid= --ppid "$test_pid" | tr -d ' ')
    owned_pids+=("$test_pid")
  fi
  for pid in "$manager" "$pulse" "$core"; do
    if [[ -n "$pid" ]]; then owned_pids+=("$pid"); fi
  done

  for pid in "${owned_pids[@]}"; do
    kill "$pid" 2>/dev/null || :
  done
  sleep .2
  for pid in "${owned_pids[@]}"; do
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || :
    wait "$pid" 2>/dev/null || :
  done
  rm -rf -- "$root"
}

start_empty_private_graph() {
  export XDG_RUNTIME_DIR="$root/runtime" XDG_CONFIG_HOME="$root/config" XDG_STATE_HOME="$root/state" XDG_CACHE_HOME="$root/cache"
  export PIPEWIRE_RUNTIME_DIR="$root/runtime" PIPEWIRE_REMOTE=pipewire-0
  export PULSE_SERVER="unix:$root/runtime/pulse/native" PULSE_COOKIE="$root/runtime/pulse-cookie"
  export DBUS_SESSION_BUS_ADDRESS="unix:path=$root/runtime/nonexistent-dbus"
  # No autospawn, default user configs, system policy or device discovery modules.
  export PIPEWIRE_CONFIG_DIR="$root/config" PIPEWIRE_NO_SYSTEM_CONFIG=1
  cp /usr/share/pipewire/client.conf "$root/config/client.conf"
  cp /usr/share/pipewire/pipewire.conf "$root/config/pipewire.conf"
  cp /usr/share/pipewire/pipewire-pulse.conf "$root/config/pipewire-pulse.conf"
  cat >>"$root/config/pipewire-pulse.conf" <<'EOF'
pulse.cmd = [ ]
pulse.properties = { server.address = [ "unix:native" ] server.dbus-name = "" }
EOF
  pipewire -c pipewire.conf >"$root/core.log" 2>&1 & core=$!
  pipewire-pulse -c pipewire-pulse.conf >"$root/pulse.log" 2>&1 & pulse=$!
  # The stock 'policy' profile contains linking policy but no ALSA, Bluetooth,
  # MIDI, V4L2 or libcamera monitors. Run against our private socket only.
  wireplumber -c /usr/share/wireplumber/wireplumber.conf -p policy >"$root/manager.log" 2>&1 & manager=$!
  local i
  for ((i=0;i<15;i++)); do
    if timeout 2 pactl info >/dev/null 2>&1 && timeout 2 pw-dump >/dev/null 2>&1; then break; fi
    kill -0 "$core" 2>/dev/null && kill -0 "$pulse" 2>/dev/null && kill -0 "$manager" 2>/dev/null || { echo 'Private audio service exited' >&2; exit 1; }
    sleep .1
  done
  timeout 2 pactl info >/dev/null
  # The only permissible pre-test graph has no hardware or other audio nodes.
  timeout 2 pw-dump | python3 -c '
import json
import sys

nodes = [
    obj.get("info", {}).get("props", {})
    for obj in json.load(sys.stdin)
    if obj.get("type", "").endswith(":Node")
]
allowed_drivers = ("Dummy-Driver", "Freewheel-Driver")
unexpected_nodes = [node for node in nodes if node.get("node.name") not in allowed_drivers]
print("Pre-test graph nodes:", [(node.get("node.name"), node.get("media.class")) for node in nodes])
sys.exit(bool(unexpected_nodes))
  '
  [[ $(timeout 2 pactl -f json list sinks) == '[]' ]] || { echo 'Unexpected sink in private graph' >&2; exit 1; }
  [[ $(timeout 2 pactl -f json list sources) == '[]' ]] || { echo 'Unexpected source in private graph' >&2; exit 1; }
}

root=$(mktemp -d)
chmod 700 "$root"
mkdir -m 700 "$root/runtime" "$root/config" "$root/state" "$root/cache"
core= pulse= manager= test_pid=
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
start_empty_private_graph
BRUV_LIVE_ISOLATED=1 "${command[@]}" & test_pid=$!
wait "$test_pid"
