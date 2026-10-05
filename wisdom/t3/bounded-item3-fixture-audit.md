# Bounded item 3: bridge, capability, and saved-startup fixtures

2026-10-05. Audit base: `9906f92e0181582c24753230f944100bdf218e55`.
Worktree: `/home/tnfssc/.bruv/worktrees/t3code-2c8ee52c-5442693331ce-task_3e453111`.
Branch: `bruv/audit-async-startup-and-capability-fixtu-3e453111`.

Read [values](../values.md), [HTTP close observation](mcp-close-ci-observation.md), [v0.15.26 capability repair](../releases/v0.15.26-capability-gate.md), [cleanup integration](../releases/v0.15.26-cleanup.md), and [grammar-loader repair](saved-transcript-startup-loader.md).

## Current owners and narrow correction

- MCP close owns admission stop, owner abort, tracked-request drain, then acquired-session DELETE. The HTTP test already observes **client reader cancellation**, not server disconnect processing. Its controlled reader gate still requires abort/draining before release and settled/DELETE afterward. No product defect or close-bound change was found.
- Remaining test failure-path defect: throwing at the held-reader assertion released the gate but restored the global fetch fixture before close finished. A sentinel fetch recorded `[abort, draining, settled, escaped-delete]`. Both close-initialize fixtures now retain the hook until close and their handled initialization promise finish; the same injection now records `[abort, draining, settled, delete]` through the owned fixture.
- Capability execute already pins a request ID, joins same-ID serialized durable publication, immediately observes rejection, and aborts/drains before storage removal. Keep those fixes and the existing real 250 ms fsync regression case.
- Remaining PATH defect: an injected failure immediately after starting serve, with its grant-file read held, restored PATH before Git spawned. The controlled config-spawn observer reported `owned=false`. Release and drain serve before restoring PATH/removing storage now reports `owned=true`. Attach rejection handling immediately, but still await the original work promise. Revoked late-output suppression, exact safe Git diff, sensitive-path denial, output bound, deadline, and durable fencing assertions are unchanged.
- Saved startup already includes `c9da61d5346a88b3a8f29f733801785cf39d686d`. The intercepted **real installed SDK 1.0.3 loader** signals grammarReady only after its promise resolves; saved-ready and empty/stopped readiness checks await that signal. The remaining 100-turn helper only reaches the immediate fixture rebind seam, not grammar imports. No observed flaw justified editing either saved-startup file. Each scenario remains a drained separate child process, isolating module controls.

## Focused and controlled proofs

Bun 1.4.2 (744846f84), Linux; executable `/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun`, `SHELL=/bin/bash`.
Evidence retained in this worktree's ignored `artifacts/item3-audit/`; probe source is retained as `.txt`, not discoverable tests. Temporary probe trees were removed after inspection. Production source was never edited.

- Baseline three files: **31 pass, 0 fail, 133 assertions**.
- Final: `bun test ./tests/t3/production-bridge.test.ts ./tests/remote-capability-runtime.test.ts ./tests/saved-transcript-startup.test.ts --rerun-each 5`: **155 pass, 0 fail, 665 assertions**, 9.89 s (`focused-final.log`). Security, EOF-latency, lifecycle, cancellation/replay, and startup interaction assertions all remain.
- Explicit fsync gate (calls real fsync after release): same-ID join stays unsettled and pending is empty while held; sequence `fsync-held, join-blocked, fsync-complete, published, execute-drained, removed`, **1 pass / 14 assertions** (`publication-success.log`). Injected failure while held produces `fsync-held, join-blocked, fsync-complete, execute-drained, removed`: only the intended failure, no ENOENT/unhandled error (`publication-failure.log`). No publication/teardown change was needed.
- Failure injection before Git spawn and during reader drain: before/after logs `path-failure-{before,after}.log`, `close-failure-{before,after}.log`. These runs are intentionally red, not acceptance passes. Observers hold actual work; they do not invent successful security outputs.
- Remove only close's in-flight wait in an isolated client copy, then run the current controlled close test: **expected failure**, received `[abort, delete, draining]` instead of `[abort, draining]` (`missing-drain.log`). The teardown fix does not hide DELETE-before-drain.
- Real grammar-loader completion held behind an extra publication gate: saved-ready cannot render before release; empty startup finishes before readiness; empty-stopped remains at **0 invalidations**, while live empty invalidates once. Three isolated scenarios pass with original theme/rebuild/interaction assertions (`startup-gate.log`). No sleep/count-based wait added.
- Direct `tsc --noEmit`, scoped Biome format/lint of all four owned test/fixture files, and `git diff --check` pass. No asset preparation/build claimed.

## Limits and handoff

An initial repetition command without `./` also discovered the deliberately failing artifact copies (275 pass / 10 intentional failures across five files). Moved executable probes outside the repository and reran exact file paths above; retained the contaminated log as `focused-probe-discovery-failure.log`, not as product failure or acceptance proof. Initial probe shell-loop syntax used fish instead of bash; an initial standalone startup probe inherited PI_PACKAGE_DIR from the parent and failed its theme assertion. Corrected the harness to match the shipped test's environment (unset PI_PACKAGE_DIR/NO_COLOR, HERDR_ENV=0); did not relax assertions.

No hosted CI, full build/release, devices, paid-provider, or cross-platform proof claimed. Existing bounded server-disconnect/EOF observations are integration assertions, not proof of server cancellation ordering with DELETE. Local passing runs cannot exclude every hosted scheduling variation. Do not extend this audit into CI/workflow/common-runner tests, item 4 prepush/actionlint, or ffmpeg.

Changed only the two observed fixture cleanup paths plus this feature wisdom. No push, PR, or release. Values unchanged: existing ownership, checked evidence, and usable handoff rules cover these findings; no new general principle.
