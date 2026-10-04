# Runtime teardown proof (Linux, unchanged official T3 2644)

[Finding, lifecycle and limits](../../runtime-teardown-lifecycle.md). [Build provenance](provenance.json).

## Evidence

- observed/baseline: real Pi local-model answer, then nested MCP HTTP ConnectionRefused and connector exit 1. Diagnostic-only release-tag rebuild expanded errors; no behavior fix in that build.
- observed/simple: **final** rebuilt connector, original simple real local-model answer, T3 closed afterward, main connector exit 0 and zero stderr lines. Exactly one loopback provider request.
- observed/two-mcp: final rebuilt connector, two actual UI turns, each making the real T3 read-only orchestrator_capabilities call through Pi/MCP, two replies, then main connector exit 0 and zero stderr. Four loopback provider requests (tool request + answer each turn). No child task was created or cancelled.
- regression-before.log / regression-after.log: new actual Pi + stateful SDK HTTP seam fails baseline with a retained idle session, then passes. It also asserts distinct reacquired sessions, remote session deletion before result/idle, Stop abortion/reuse and no DELETE after host shutdown.
- preservation-tests.log: 96 outer pass, 8 explicit opt-in skips, zero failures; isolated suites retain their inner assertions. Typecheck passes. This is focused runtime preservation, not a release gate.

Final proof artifact SHA256: **1c003a4728414effbc2035529478bcbfadb5b3d11043875518c4518062fc29ae**. Installed release connector SHA256: **49d2d0fbae81ba680e7eec5a062d74b2b410f566569384ccb61d25d6d1f83b3a**, matching the existing release publication record for source tag cb32e158. Initial parent source was older; see the finding before diagnosing from that checkout.

Raw MCP bearer config, full SDK input/wire and T3 pairing logs stay private under the owned .cache/teardown trial directories. project.mjs whitelists only lifecycle, answer/tool markers, truthful init status and selected diagnostics. No frame translation/synthesis. passive-tap.mjs forwards the actual artifact byte-for-byte. Screenshots/DOM retain the out-of-scope unsupported/updater UI defects, not a claim they were cured.

Two early harness attempts stopped at onboarding selectors; Add project was visible before the modal finished mounting. The harness waits for either actual ready surface and settles the modal before navigating. Those attempts never exercised a provider turn. Starting MCP close earlier without changing lease lifetime was also tried and still exited 1; it is not in the patch.

## Reproduce with owned isolated dependencies and existing held assets

Do not use real auth, user config, installed binary destinations or devices. Prepare pinned dependencies in the **owned** worktree first. Any package-manager cache must be inside that worktree (BUN_INSTALL_CACHE_DIR), not the global cache. See the explicitly disclosed earlier setup metadata deviation in the finding.

~~~sh
BUN=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun
export BUN_INSTALL_CACHE_DIR="$PWD/.cache/teardown/bun-cache"
"$BUN" scripts/build-claude-compat.ts --outfile=.cache/teardown/verified-connector
T3=/home/tnfssc/Code/bruv/.cache/v0160-clean-native-setup/native-t3/platform/t3
NORMAL=/home/tnfssc/.local/bin/bruv
BROWSER=/home/tnfssc/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome
PW=/home/tnfssc/Code/bruv/.cache/acp-t3-upstream-experience/runtime/node_modules/playwright/index.mjs
P=wisdom/claude-compat/proof/runtime-teardown
# NEW_OUTPUT must not already exist. Choose free loopback ports.
/usr/bin/node "$P/replay.mjs" "$T3" .cache/teardown/verified-connector "$NORMAL" "$BROWSER" "$PW" .cache/new-teardown-simple aligned 19396
/usr/bin/node "$P/replay.mjs" "$T3" .cache/teardown/verified-connector "$NORMAL" "$BROWSER" "$PW" .cache/new-teardown-two two-mcp 19397
/usr/bin/node "$P/project.mjs" .cache/new-teardown-simple .cache/new-teardown-simple-projection
/usr/bin/node "$P/verify.mjs"
"$BUN" test tests/claude-compat-*.test.ts tests/claude-compat
~~~

replay exits nonzero if the final simple/two-turn answer or clean main connector shutdown fails. It pins/copies the supplied connector and sibling, uses HOME/PATH/TMPDIR-only T3 parent env, creates its own aligned ordinary connector state and a zero-cost deterministic loopback model. T3 hash is enforced before and recorded after. Substitute held assets when elsewhere, verifying provenance first. verify.mjs checks **committed** observations only; it is not a certification of future runs.

No push, release, installed-binary mutation, device access, real credential use or provider charge. No desktop/macOS/history/fork/full-product acceptance. Active-host-loss cleanup remains honest failure if an HTTP lease was not released; external MCP keeps normal persistent ownership.
