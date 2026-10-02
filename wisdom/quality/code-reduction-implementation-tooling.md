# Feature-preserving tooling cleanup (2026-10-02)

Baseline d80d7058a2f5481f067586fd7042fe2746cff4ae. Scope: tooling-01–10, October 2 audit. No feature/archive retirement, release mutation, paid study, or shipped source edits.

## Implemented

- **01:** Removed uncalled capability PTY helpers and unobserved PTY counters. Also removed an unused question-PTY SSH closure; its long-task launch remains without an unused binding. All human capability/question/privacy assertions remain.
- **02:** network-none-fixture.ts owns isolated environment/directories, command checks, cached-image/no-pull network:none Docker, pinned SSH, readiness and exact resource cleanup. Callers keep scenario overlays, receipts, tmux controls, evidence and acceptance assertions. Root alone supplies reply loss; child alone retains local fake inference. Shared canonical output checks preserve root/clean symlink boundaries. Capture receipts now include shared fixture/renderer source provenance.
- **03:** loopback-parent-fixture.ts shares model-file/SSE and newline-buffered compiled RPC transport. Parent RPC still counts actual requests; PTY transports have no discarded counters. False trust responses, malformed JSON rejection, owned children and each caller's diagnostics remain.
- **05/09:** live-study-trial.ts shares study WebSocket session/tool/continuation/teardown. All three drivers and language/context/replay/mock-output differences remain, including 20s/1400 vs 25s/2000 bounds and controlled response counts. Removed redundant late validation; early opt-in/disclosure/plan/private-input checks remain.
- **06:** ansi_video_renderer.py shares the exact PIL/FFmpeg renderer. Clean privacy/all-frame/decode/faststart checks and frozen final provenance remain independent. Browser ANSI renderer untouched.
- **07:** Asset preparation delegates Pi version/all-file validation to preparePiHost. Added the required SessionManager patch-inventory assertion; exact hashes, idempotence and fail-before-write tests remain. Unsupported preparation diagnostics now come from the single Pi owner (version/file), rather than duplicate SessionManager wording.
- **08:** Removed the explicitly approved unconsumed future packed-web restore-key wrapper. Internal identities, receipts, source/cache/digest/age/symlink checks and every real verification acceptance/rejection assertion remain.
- **10:** Inlined one-call JSON alias; removed discarded tmux has-session subprocess. New/duplicate/invalid session tests preserve duplicate rejection and modified Enter config.

## Deferred, not weakened

- **04:** Release inventory deduplication deferred. Its audit requires a real candidate through final packaged Linux/browser/Mac helper/updater gates and preserving complete log/failure contracts. No combined candidate/Mac runner is available here; publication is not authorized. Workflows, CI inventories and release gates remain unchanged.
- Full clean-product recapture needs a reviewed binary with independently established source/digest. The available copied parent binary has a measured digest but no matching source receipt found; do not fabricate capture provenance. Historical final-video frozen captures are absent (/home/tnfssc/.bruv/probes does not exist). Instead compared both baseline renderers with shared rendering using actual root acceptance text plus ANSI/Unicode samples. No archive deleted.
- Compiled question PTY reaches /remote status but the existing rendered-result guard times out despite visible status. The **unchanged baseline script** against the same binary reproduces the identical failure. Keep assertions; investigate old marker-count/history guard separately, not by weakening acceptance.

## Proof and resume

Dependencies are private worktree files. Bun's default install was found to hardlink cached/parent package files; rematerialized with --frozen-lockfile --backend=copyfile (SessionManager link count 1), before pristine restoration checks. Use copyfile when preparation rewrites dependencies. Local pinned pnpm is in .cache/tooling-pnpm, not shared node_modules.

Focused Bun 1.4.2 command, with .cache/tooling-pnpm/node_modules/.bin prepended to PATH:

    bun test tests/live-study-trial.test.ts tests/tooling-fixtures.test.ts tests/pi-host.test.ts tests/packed-web.test.ts tests/ci-web.test.ts tests/release-workflows.test.ts tests/live-probe-input.test.ts tests/remote-placement-e2e-fixture.test.ts tests/remote-typed-root-placement-fixture.test.ts tests/tui-harness.test.ts scripts/task-placement-clean-scenario.test.ts

**118 pass, 0 fail, 889 assertions**, 11 files. Offline coverage includes study event ordering/continuation/error/close/timeout, invalid plans before private reads/credentials, environment/cleanup/symlink boundaries, SSE request counting, RPC false trust/line buffering/diagnostics/malformed JSON, duplicate/invalid TUI starts. bun run check, tsc --noEmit, Python compilation and changed-file Biome format pass. Changed-file Biome lint exits 0: 102 warnings, 156 informational style diagnostics; no errors/unused diagnostics. No full build/CI.

Real disposable acceptance used copied existing parent 0.15.25 binary SHA256 861022c96831a8725c9d3ada8fb1eff2bd07032f5d0b62af8fd8396c0e5b9202; **not a new release-candidate claim**:

- remote-placement-e2e.ts: PASS child clean+drift, questions/restart/roles/worktree/source return. Artifacts /home/tnfssc/.bruv/tmp-pi-removal/remote-placement-artifacts-OFxKlR.
- remote-root-placement-e2e.ts: PASS root clean+drift, real reply loss, no replay, active shell cancellation, unsupported modes. Artifacts /home/tnfssc/.bruv/tmp-pi-removal/remote-root-placement-artifacts-kUIi50. Both used explicit BUN_BIN/BRUV_BIN and REMOTE[_ROOT]_PLACEMENT_BASE_IMAGE=die-remote-e2e-2434886-5027:latest.
- bash scripts/remote-e2e.sh: PASS original compiled RPC pinned/offline/grants/cancellation/source safety. Same runner with REMOTE_E2E_SCRIPT=scripts/remote-capability-pty-e2e.ts: PASS actual details/Escape/No/Yes/revoke/stale-request proof.
- REMOTE_E2E_SCRIPT=scripts/remote-pty-e2e.ts: existing /remote status failure; baseline reproduction in .baseline-pty.log. Other durable uncommitted logs: .child-acceptance.log, .root-acceptance.log, .loopback-rpc.log, .loopback-capability.log, .loopback-pty.log, .tooling-tests.log, .tooling-lint.log.
- .cache/compare-renderers.py compares both baseline renderers extracted with git show: all five decoded frames and both sampled PNGs per style pixel-identical, including ANSI/Unicode and actual root capture. Artifacts /tmp/tooling-renderer-z3xj1qjv. Old implementation copies are transient proof, not maintained tests.
- Pi preparation passed from hash-verified reconstructed original files in copyfile dependencies, then already adapted; .cache/restore-private-pi.ts retains the recipe. Typecheck passed afterward.

Values unchanged: existing single-owner, real acceptance and useful-negative-assertion principles suffice; parent owns values integration. No necessary cross-owner source edits. Parent should run the combined gate and decide whether to investigate the known old PTY guard before final release acceptance.
