# Exact gates — 2026-10-04

Source baseline: parent156e2450. Existing paused human driver recovered selectively.

## Compile

Both binaries built locally with /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun.
Connector: bun scripts/build-claude-compat.ts.
Normal runtime: bun build --compile --minify src/cli.ts --outfile=dist/bruv after
prepare-assets, reusing the unchanged held web archive only to satisfy its file
import. No web/T3/packaging build or source modification.

Artifact hashes: observed/invocation.json. T3 actual version/hash: observed/result.json.
Browser: fresh-profile /opt/google/chrome/chrome, Google Chrome150.0.7871.128.
No real user browser profile, provider, audio device or credential used.

## Focused code gates

- Supported Bun1.4.2: bun test tests/claude-compat-{human-controls,commands,transport,runtime}.test.ts — **51 passed, 239 assertions**; bun-unit.log.
- /usr/bin/node --test tests/claude-native-acceptance-model.test.mjs — **12 passed**; model-unit.log.
- node_modules/.bin/tsc --noEmit — **passed**.
- Biome format on changed TS/MJS source and git diff --check — **passed**.

## Rendered gate


```sh
ACCEPT_HUMAN_CONTROLS=1 BROWSER_PATH=/opt/google/chrome/chrome FIXTURE_PORT=19861 \
BRUV_CONNECTOR_EXECUTABLE="$PWD/dist/bruv-claude-compat" \
BRUV_RUNTIME_BINARY="$PWD/dist/bruv" PROOF_OUTPUT=.cache/human-resume-17 \
/usr/bin/node scripts/claude-native-acceptance/run.mjs
```

**Passed focused human control/consent safety gate with explicit upstream UI
recovery, not a clean all-green product UX claim.** 5 execute consent requests,
3 native question requests, 1 actual human answer callback, 1 saved-answer
continuation, 0 fabricated connector events, unchanged official pinned T3.

Snapshots are actual rendered official T3. Known stale approval and zero-model
command recovery gaps are in result.json and README.md; only original fixture
screenshots are included. Safe protocol/owner identity exports are hashes. Raw
wire/model input and scoped runtime removed; observed/cleanup.json confirms.

Default Stop/late-cancellation gate is recorded separately when complete; it is
not silently skipped or counted as this focused gate.


## Separate preserved default gate — FAILED, not weakened

Same binaries/T3, fresh stable Chrome profile, FIXTURE_PORT=19863,
PROOF_OUTPUT=.cache/human-default-regression-6, without ACCEPT_HUMAN_CONTROLS.
The fixture now handles the actual shortened cancellation notice by its real
launch ID, including OpenAI array-text JSON escaping (no leading word-boundary
assumption before task_ID). Backend local-model evidence has exactly one
TASK_COMPLETED_REAL, one CANCEL_CONFIRMED_REAL and one CANCELLATION_COMPLETED_REAL.
Native rendered acceptance still fails: T3 displays CANCELLATION_COMPLETED_REAL
but no longer displays CANCEL_CONFIRMED_REAL. Both rendered-marker assertions
remain unchanged. See default-regression/result.json, model-projection.json and
failure frame. Parent's task/history/native message composition owns this
remaining integration issue; no history, app policy or T3 files were changed to
mask it. Cleanup is confirmed. This is not a full connector PASS.
