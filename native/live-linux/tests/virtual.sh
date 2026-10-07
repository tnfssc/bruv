#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
# Desktop policy can move even explicitly named streams (for example to a DSP
# sink). Reuse the owned, hardware-free graph instead of testing desktop routes.
if [[ ${BRUV_LIVE_ISOLATED:-} != 1 ]]; then
  exec bash scripts/live-isolated-audio.sh -- bash native/live-linux/tests/virtual.sh "$@"
fi
command -v pactl >/dev/null
pactl info >/dev/null # the parent owns the server; never change its defaults
helper=${1:-dist/live-audio-linux}
prefix="bruv_live_$$_$RANDOM"
out="$prefix-out"
mic="$prefix-mic"
output_module= microphone_module=
cleanup() {
  local module
  for module in "$microphone_module" "$output_module"; do
    if [[ -n "$module" ]]; then pactl unload-module "$module" 2>/dev/null || true; fi
  done
}
trap cleanup EXIT
output_module=$(pactl load-module module-null-sink sink_name="$out")
microphone_module=$(pactl load-module module-null-sink sink_name="$mic")
python3 native/live-linux/tests/protocol.py "$helper" --source "$mic.monitor" --sink "$out"

# This scenario unplugs the microphone. Keep ownership on failure so EXIT can
# still release it if the scenario failed before unloading the module.
python3 native/live-linux/tests/source-removal.py "$helper" "$mic.monitor" "$out" "$microphone_module"
microphone_module=
