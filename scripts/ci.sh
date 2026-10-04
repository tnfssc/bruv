#!/usr/bin/env bash
# Shared local / GitHub Actions validation. CI owns tool setup and log upload only.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
lane="${1:-linux}"
if [[ "$lane" != linux && "$lane" != macos || $# -gt 1 ]]; then
  echo 'usage: scripts/ci.sh [linux|macos]' >&2
  exit 2
fi

# Isolate transient session files from prior runs and real user sessions.
run_tmp="$(mktemp -d "${TMPDIR:-/tmp}/bruv-ci.XXXXXX")"
export TMPDIR="$run_tmp"
trap 'rm -rf "$run_tmp"' EXIT

mkdir -p artifacts/ci
log_dir="$root/artifacts/ci"
run_step() {
  local label="$1" log="$2" directory="$3"
  shift 3
  echo "==> $label"
  (cd "$directory" && "$@") 2>&1 | tee "$log_dir/$log"
}

run_step 'Install locked dependencies' install.log "$root" bun install --frozen-lockfile

if [[ "$lane" == macos ]]; then
  # This is the separate device-free macOS lane, not the Linux gate.
  run_step 'Prepare assets' macos-assets.log "$root" bun run prepare:assets
  run_step 'Offline OpenAI source probe' macos-openai-transport.log "$root" bun scripts/offline-openai-default-transport.ts --source-only
  run_step 'Deterministic Live tests' macos-live-tests.log "$root" bun test --parallel=3 tests/live-*.test.ts
  exit 0
fi

run_step 'Format check' format.log "$root" bun run format:check
run_step 'Lint' lint.log "$root" bun run lint
run_step 'Typecheck' typecheck.log "$root" bun run check
run_step 'Build paired Bruv binaries (no bundled T3)' build.log "$root" bun run build
run_step 'Offline default OpenAI transport' openai-transport.log "$root" bun scripts/offline-openai-default-transport.ts
run_step 'Complete root tests (three bounded workers)' tests.log "$root" env BRUV_RUN_LLM_TESTS=0 bun test --parallel=3 ./tests
run_step 'Standalone paired smoke test' smoke.log "$root" bun run smoke -- --reuse-build
