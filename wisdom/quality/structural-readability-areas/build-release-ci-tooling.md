# Build / release / CI / tooling: area handoff

## Retained checkout and scope

- Checkout: `/home/tnfssc/.bruv/worktrees/t3-6b8c09c6-5442693331ce-task_d849d828`
- Branch: `bruv/whole-repo-structural-readability-build--d849d828`
- Initial area base: `59413c532e6422983f611915e509e8421aa2f363`; final source checkpoint: `43eade57`.
- Parent owns PR #45. No area PR, push, or whole-repository acceptance claim.
- Authoritative per-file provenance, exact accepted blobs, primary branches/worktrees, judge rounds, objections and proof: adjacent `build-release-ci-tooling.json`.
- Exact 70 baseline assignments covered. Three extra tests and one companion document are tracked separately. **All 74/74 accepted with fresh primary and independent final-blob judgment.** Related-patch judgment never substitutes for fresh primary coverage.

## Final coverage audit

Exact assignment match: 70 baseline + 4 extras (three new tests, one changed companion document). All final blobs match tip and are witnessed in accepted judge candidates. Primary IDs are unique; writers and judges are independent. Both concrete rejections were resolved by fresh rework and fresh judgment, with history retained. No unresolved objections, imported worker notes, or out-of-area changes relative to parent checkpoint db885fce. Per-file retained paths/branches remain in the JSON.

## Structural outcomes

- CI selection exposes validation, planning, publication and execution; workflow admission names its two accepted result tuples. Release source authority is centralized and downstream dependencies remain fail-closed.
- Release publication exposes tag authority, complete immutable asset identity, publication and public readback. Dependency/notices processing makes input authority and output ownership explicit.
- Installer and updater flows expose staging, ownership, publication, rollback and retained recovery. Root and script download installers have identical accepted bytes; frozen v0.16.3 updater remains byte-identical to historical source.
- Test refactors replace correlated logs, positional state and mutation/reset sequences with named contracts and owned fixtures. Offline PTY checkpoints require fresh terminal evidence, preserve confirmation before durable revoke, and accurately report owner-not-notified.
- Tiny coherent adapters/configuration and intentional frozen authority were accepted unchanged after actual-code review, not cosmetic edits.

## Explicit corrections and rejected candidates

- Dependency updater's first refactor exposed inherited object properties as versions. Fresh worker plus fresh judge resolved it with own-entry-safe comparison and constructor/__proto__/toString evidence. Original rejection remains in the JSON.
- Process-isolation candidate initially false-passed its TUI negative control because inherited BRUV_SUBAGENT_TYPE=normal disabled the startup behavior. Fresh rework explicitly launches a root child; fresh judge reproduced old false-pass, repaired TUI failure with sanitizer bypass, direct-child failure, and restored success. Sanitizer scope was not broadened.
- Accepted incidental corrections include inherited installer override handling, isolated download-test ownership, native-setup no-partial-env handoff, stale release-source test expectations, and runtime asset selection in the private updater fixture. Relative install-path normalization is a prerequisite of new staged binding, not a separately reproduced old bug.
- Stalled primary/judge attempts were confirmed stopped, retained, and never counted as evidence. All worker-local pickup notes were excluded from area integration.

## Combined verification

- Actual Linux paired build and full tsc passed after parent checkpoint db885fce was joined (task_2901b129). Pi adaptation ran only against an owned dependency copy; other dependency access is read-only.
- Final source checkpoint 43eade57: **490 tests passed, 0 failed, 2,443 assertions across 31 suites** (task_30e1b83f). Includes all area test files and three added tests, against actual compiled pair; BRUV_RUN_LLM_TESTS=0.
- Full tsc, scoped format/lint on all 57 TypeScript/JSON focus paths, and diff whitespace check passed (task_9122e3e5). Lint retains 13 warnings and 92 infos; no automated source fixes. This is not a whole-repository Biome/import-order gate.
- Current normal binary SHA256: cb7aec7df02d980207b3c8c9fc5d71aa9459a58c40cadcf225ee2c8f5dcdf50f.
- Connector SHA256: 55b58718cdfb8f87e7a947b8e67ec4911bf6fb60cb33d2acfe72f67a39d96246.
- Frozen updater SHA256: cab60e412c13277cf8a415d0c09fb0dbdfd69c9d000c42d21b2695f5b03230aa.
- Several later judges reused the rebuilt normal binary, not the earlier writer hash 4049e1a6. Their reports explicitly distinguish artifacts; final combined proof uses the current pair.

## Retained limits and parent pickup

- Linux host compilation, injected transports and synthetic target bytes are not hosted Actions, publication, authenticated API, live provider/SSH/device, Android/macOS boot or native-helper acceptance.
- Shared helper sanitizes Herdr identity, not provider credentials/network; it has no timeout/process-tree guarantee. Smoke env isolation leaves cwd unchanged. Source PTY proof has trust-resource/ambient agent-identity prerequisites; no arbitrary-environment guarantee.
- Node-path fixture reports child executable, not independently tap interpreter; generated model commands are inspected rather than executed. Architecture guard covers direct relative imports/listed homes, not transitive/package-resolution or universal uniqueness; .js-suffix gap is recorded.
- HTTP abort/shared-budget exhaustion has empirical tests, not forced hanging-Git or hosted timing proof. Frozen retained-recovery failure is inspected, not dynamically injected. Private updater wrong-version failure proves pre-publication preservation, not rollback.
- One judge's unchanged five-second private compile hook timed out; identical retry passed. The final combined batch passed without that failure. Optional diagnostic error metadata/non-ASCII and tooling RPC/secret-seeding gaps remain documented per file.
- Parent checkpoints were joined only after clean merge-tree and no area-focus overlap; latest db885fce introduced no accepted area blob changes. Other-area source remains parent-owned. Parent must run its final whole-repository reconciliation after joining this area.

## Original file-worker and judge brief

User rejected shallow rename/comment sweep and demanded whole-repo work with independent judgment. Maximize actual ease of understanding, not diff count, names, smaller files or boilerplate. Trace actual source, callers, shipped paths and tests; identify concrete mental bookkeeping before editing. Simplify tangled responsibilities, branching/hidden state, unrelated lifetimes, needless indirection and dead machinery with coherent domain operations and visible effects. No arbitrary splitting/context bags/handler registries/state-machine frameworks, forced classes/quotas or cosmetic acceptance. A genuinely readable file may remain unchanged. Preserve purposeful permission/replay/cancellation/delivery/data-loss/protocol contracts. Observed incidental fixes must be explicit and tested; no speculative defenses/dependencies, feature cuts or weakened tests.

Primary: one fresh normal worker per focus, durable worktree launched from committed area tip. Focus is not an edit-only-one-file wall: coherent related changes allowed; report overlap risks. Do not edit global/area notes. Before commit write SHORT local wisdom/quality/structural-readability-worker.md (focus/problem/why better/exact proof/limits/path/branch). Return exact base/candidate commit and changed paths with before/after journey. No push/PR. Candidate ready is not accepted.

Judge: fresh normal read-only agent independent from writer EACH round. Inspect ACTUAL source/callers/tests and FULL candidate diff, not summaries/green tests. Judge intrinsic current code and improvement separately. Return ACCEPT / REJECT / NO CHANGE NEEDED with concrete reader journeys, exact inspected commit/blobs, important behavior and limitations; REJECT gives concrete unmet targets and smallest coherent rework. Preserve prior findings/writer response/unresolved objections on subsequent rounds; never launder acceptance. Related/new/deleted source paths are included in patch judgment and need their own primary coverage. Later edits require new final-blob judgment.

Checks: explicit Bun /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin in PATH INSIDE quoted /bin/bash script; automatic fish setup cannot find it. Reuse read-only /home/tnfssc/.t3/worktrees/bruv/t3-6b8c09c6/node_modules; own generated assets/fixtures; no per-worker full builds. Focused checks per edit and batch combined checks/typecheck/lint/format. Report honest live/provider/device/SSH/binary gaps.
