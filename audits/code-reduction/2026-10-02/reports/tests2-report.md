# tests2 maintenance-reduction audit (READ-ONLY; partial)

## Overview

**Not a complete line audit:** 65/91 assigned files fully read, two partly read; **6872/18041 assigned lines read**. Every displayed source chunk used for the ledger was read, including rereads of clipped output; grep-only matches are not counted. The remaining files are explicitly unrecommended, not silently classified as keep or unused. This report must not be treated as the requested exhaustive sign-off.

No production, tests, configuration, docs or wisdom changed. Only this report and its coverage ledger were written. No build, suite, Docker/SSH runner, paid provider or live/audio device was launched. Research used numbered source reads and bounded reference searches. Context: wisdom/values.md, wisdom/live/macos-live-ci-source-cli.md, and relevant portions of wisdom/live/main-orchestrator-runtime-investigation.md. Wisdom supplies context, never deletion savings.

**Prioritized savings (owned code only):** tests2-01 through -04: **gross 467–541 lines, net 233–309 lines** after replacement helpers/assertions. Optional tests2-05 adds **gross 195–225, net 175–205**. Estimates are disjoint; replacement helper code is deducted even if placed outside the manifest. No production/doc savings are included. These are engineering estimates, not measured patches.

## Ranked actionable findings

### tests2-01 — Retire the superseded synthetic Live execute investigation probe

**Classification:** safe removal of a superseded developer experiment, conditional on retaining the one bridge-paging contract; not an unreferenced-code claim. **Confidence:** high on redundant experiment scaffolding, medium-high on exact replacement size. **Gross 143; net 125–135 lines.**

- Owned target: tests/live-main-orchestrator-runtime.probe.ts:1–143. It expressly declares an offline nonproduction probe (:1, :26, :45, :75–76), builds a fake provider declaration and dispatcher (:45–52), and tests that fake dispatcher rejecting an unknown name (:69). This is not real provider schema acceptance or real Live ownership. Its second test adds a separate real manager/service fixture (:78–108).
- Stronger active coverage: tests/live-main-integration.test.ts:46–155 constructs real Pi/agent extension/MainOwner; :166–202 executes a real async shell and checks canonical tool history/completion without a text model. :204–227 checks production before/after-tool hooks and denied execution. tests/typescript-execution.test.ts:56–67 covers actual runner failures; :305–327 tool/artifact routing; :412–450 configurable capture truncation; :452–501 real registered subagent/shell bridge identity. tests/task-manager.test.ts:35–47 and :99–129 cover real async completion and incremental/Unicode inspection.
- **Counterevidence/use:** this is an explicit manual CLI entrypoint requiring BRUV_PROBE_EXECUTABLE (:1, :11–13), referenced by investigation wisdom. It is not unused just because it has no imports. CI scripts/ci.sh:33, :57 and .github/workflows/release.yml:167 run normal Live/root test suites; reference search found no CI/script invocation of this probe. Its historical purpose explains why it survived.
- Change: remove the probe; port the compact actual execute → jobs.inspect pagination assertion (:119–134) into an existing integration fixture before deletion. Keep subagent transport checks in the regular execute suite. Do not retain the fake voice dispatcher solely to test its own unknown-name branch.
- **Behavior lost:** the old ad-hoc investigation command and its synthetic adapter comparison, not a product feature. The normal source-wrapper/compiled integration routes remain. Do not delete BRUV_PROBE_EXECUTABLE from the integration suite merely because the probe is removed; it is independently used there (:33–34).
- **Check:** focused regular execute, task-manager and Live integration tests against a matching source/compiled CLI; add an actual bridged inspection check with status, nextOffset and hasMore. Deterministic checks only; no provider/audio needed. This research did not execute them.

### tests2-02 — Share the shake SDK fixture and successful-message stream constructors

**Classification:** behavior-preserving test refactor. **Confidence:** high. **Gross 200–230; net 75–110 lines.**

- tests/manual-shake-sdk.test.ts repeats ModelRuntime/create-loader/create-session/bindExtensions scaffolding at :106–117 + :149–159, :210–242, :308–339, and :412–426 + :445–455. tests/auto-shake-sdk.test.ts:81–113 already contains the same small local setup abstraction. Extract that seam, accepting the existing manager, model, extension factories and explicit settings; callers own lifetime and scenario seeding.
- Also unify the successful assistant/trace/response constructors: manual SDK :30–65 and auto SDK :23–65. The auto variant already takes a model rather than hard-coding OpenAI metadata. Preserve returned trace messages where the auto helper returns them (:36–55).
- **Counterevidence:** do not merge or delete scenarios. Transformed-call versus transformed-result preservation (manual :92–193), recovery omission (:265–294), threshold accounting (:348–393), and persistence-failure refusal before fetch (:400–473) exercise different SDK boundaries. Auto threshold/overflow/rejected preview (:121–231) is not redundant with manual /shake. Factory redaction and the failing appendEntry Proxy stay in their individual tests. Successful stream construction is shared; failed streams retain their distinct error messages/usage.
- **Behavior lost:** none; same real SDK creation, same factories/settings and same assertions. No generalized mock framework, provider fallback, or auto-disposal that hides failed teardown is needed.
- **Check:** run the two offline SDK suites and compare named cases/assertions; verify transformed secret suppression, failed persistence yields zero dispatches, and automatic overflow retries once. Ensure fixture disposal and global fetch restoration still occur on failure. Existing tests/helpers.ts:1–26 is only subprocess/environment plumbing, not an SDK session helper.

### tests2-03 — Reuse a narrow tmux test harness, not five separate polling/quoting implementations

**Classification:** behavior-preserving test refactor. **Confidence:** high on duplication; medium on savings. **Gross 90–130; net 25–50 lines.**

- Duplicated plumbing: tests/live-picker-tui.test.ts:14–25, :33–38; tests/live-gpt-tui.test.ts:13–30; tests/fullscreen-editor-tui.test.ts:13–29; tests/questions-interactive-tui.test.ts:20–36; tests/session-costs-tui.test.ts:11–21. Each rebuilds tmux invocation, capture polling with a deadline, shell quoting or source-theme arrangement. A tiny runner/capture/wait/quote helper plus a source-theme setup helper can replace these blocks without moving assertions.
- **Counterevidence:** these are not duplicate coverage. The picker uses 80/120 columns and checks re-selection/setup without starting voice (:9, :67–105); GPT checks passive JSON is absent from rendered history (:58–63); fullscreen validates actual compiled prompt/footer positions and retained frames (:56–101); questions verifies cancelled/stale submissions and 48-column rendering (:74–143); costs checks nested totals update while idle and survive restart (:41–79).
- Keep source versus compiled launch selection explicit. Preserve capture-pane viewport versus full-scroll (-S -), terminal dimensions, tmux config, target pane and caller-specific predicate/sleep timing. Do not force source trust keys into compiled tests. tests/live-tui-startup.ts:1–25 is **already shared** and intentionally uses session-only trust; retain it and its test rather than creating a second startup helper.
- **Behavior lost:** none. Preserve actual PTY/renderer evidence, not fixture-only string checks. This is a boilerplate reduction, not a proposal to skip expensive-looking TUI cases.
- **Security/data-loss boundary:** invoke tmux through tests/helpers.ts:10–25, which sanitizes inherited Herdr identity (:1–7). tests/offline-process-isolation.test.ts:14–40, :82–101 demonstrates why. Temporary HOME/socket and cleanup remain caller-owned; source theme symlinks must stay within temporary HOME.
- **Check:** the five focused real-terminal suites, including both widths/modes, stale question refusal and reopen. Do not run prepare/build implicitly during this audit. Expected helper size/call-site edits already deducted from the net estimate.

### tests2-04 — Table-drive the two remote E2E process wrappers

**Classification:** behavior-preserving test refactor. **Confidence:** high. **Gross 34–38; net 8–14 lines.**

- tests/remote-e2e.test.ts:6–25 and :28–47 repeat identical spawn/cwd/BUN_BIN/stdout/stderr/exit-code handling. Parameterize only opt-in variable, optional REMOTE_E2E_SCRIPT, title and expected PASS marker, leaving two separate tests.
- **Counterevidence/use:** scripts/remote-e2e.sh:16 copies Docker build assets, :98 selects the script; this is an actual compiled CLI Docker/SSH path, not redundant fixture mocks. RPC and rendered PTY proofs are distinct. Keep BRUV_REMOTE_E2E and BRUV_REMOTE_PTY_E2E opt-ins separate and retain the Linux gate and 300-second limits.
- **Behavior lost:** none. Never combine both cases under a single paid/live-or-global opt-in. Do not delete the runner or Docker assets.
- **Check:** compare test discovery and skip conditions without launching Docker; when authorized, each existing opt-in path separately must preserve its marker and propagate stdout/stderr on a nonzero exit.

## Feature cuts requiring human choice

### tests2-05 — Remove Google ~/.bruv/live.env import; use canonical provider credentials only

**Classification:** optional product/onboarding feature cut, **not safe dead-code deletion**. **Confidence:** high on dependency/cut boundary; medium on final net size. **Owned tests gross 195–225; net 175–205 lines.** Production savings exist but are excluded to avoid overlap with production reviewers.

- Entire tests/live-credentials.test.ts:1–60 is the literal assignment/private-file import parser contract. Import-only portions of tests/live-auth-lifecycle.test.ts:36–69, :98–146, :161–169 and no-op import assertions :85–88, :154, :212–215, :229–232 can go only with the feature. tests/live-setup.test.ts:7, :16–20, :36–38, :60–68, :78–86, :104–112 and import-specific expectations simplify. Retained setup instructions need replacement assertions, deducted from net.
- **Real production use/counterevidence:** src/live/setup.ts:14, :28–50 presents import/recheck UI and calls credentials.importLiveEnv. src/live/credentials.ts:14–51 parses and privately reads the file; :126–151 performs atomic conditional import. src/live/extension.ts:754 and :1001 call the setup flow. The file path is **current Google onboarding**, not merely an unused backward-compatibility branch. Removing it requires deciding how users configure the canonical provider key instead.
- **Behavior lost:** user-owned 0600 file onboarding/import, including its instructions, explicit migration, and preserved-file/no-overwrite semantics. Canonical stored/ambient Google API-key use, canonical OpenAI key use and provider selection remain. Do not automatically read the old file on startup as a supposed simpler replacement.
- **Boundaries to keep if feature stays:** no shell evaluation; opaque key errors; owner/mode/regular-file/link/size checks; conditional locked storage write; never replace existing OAuth/key or corrupt auth bytes; abort before persistence. These tests are essential, not defensive clutter. Cutting guards alone is not a maintenance reduction.
- **Boundaries to keep after cut:** metadata-only credential status, OAuth refusal/no token leak, Google versus OpenAI provider separation, cancelled setup cannot authorize voice, canonical auth directory and ambient-key nonpersistence. Preserve auth lifecycle :71–95 (minus import assertions), :147–160 (minus import assertion), :170–233 (minus import assertions), setup :42–58/:70–76/:88–102 with rewritten missing-key guidance.
- **Check:** deterministic credentials/setup suites, canonical provider-key onboarding with cancel/recheck, provider separation and no unintended credential writes. Explicitly choose a replacement canonical-auth setup flow before shipping. No paid/provider acceptance run is necessary for this cut's storage/UI contract.

## Per-file verdicts and keep rationale

Full line review was completed only for the following files. “Keep” means no justified removal found in this review, not a claim the file is irreducible. Exact coverage is also machine-readable in tests2-coverage.json.

| File (all lines read) | Verdict |
|---|---|
| tests/agent-session.test.ts:1–51 | Keep: durable child identity, parent linkage and explicit titles. |
| tests/auto-shake-sdk.test.ts:1–231 | Refactor shared SDK setup/messages; keep threshold, overflow and rejected-preview cases. |
| tests/ci-remote-offline-source-pty.py:1–51 | Keep: real source PTY proof of offline durable capability revocation; distinct from compiled proof. |
| tests/cli.test.ts:1–105 | Keep: standalone compiled startup, asset non-rewrite, removed options and atomic installation. |
| tests/cooperative-handoff.test.ts:1–95 | Keep: real Pi all-results-yield versus partial-yield batch behavior. |
| tests/fixtures/live-execute-cli.sh:1–2 | Keep: executable source CLI entrypoint used by macOS/execute-control fixtures, not an unused shell file. |
| tests/fixtures/remote-e2e/Dockerfile:1–12 | Keep: actual disposable SSH/container build input, copied by scripts/remote-e2e.sh:16. |
| tests/fixtures/remote-e2e/entrypoint.sh:1–7 | Keep: actual container entrypoint and private SSH key installation. |
| tests/fixtures/remote-e2e/models.json:1–10 | Keep: local fake-provider model configuration; no real credentials. |
| tests/fixtures/remote-e2e/placement-parent.ts:1–62 | Keep: already shared fake-parent implementation for three migrated runners. |
| tests/fixtures/remote-placement-e2e/scenario.ts:1–166 | Keep: deterministic parent/orchestrator/normal scenario; guards saved human reply, placement and drift. |
| tests/fixtures/remote-typed-root-placement/reply-loss.ts:1–45 | Keep: executable fault relay discards a real successful SSH reply, rather than simulating acceptance. |
| tests/fixtures/remote-typed-root-placement/settings.json:1–5 | Keep: pinned destination model/settings build fixture, exercised outside this set. |
| tests/fixtures/remote-typed-root-placement/ssh-proxy.ts:1–10 | Keep: real SSH byte proxy into isolated container; not an RPC emulator. |
| tests/foreground-stop.test.ts:1–65 | Keep: response ACK precedes scoped abort; stale session and error behavior. |
| tests/fullscreen-editor-tui.test.ts:1–106 | Refactor only duplicated tmux shell plumbing; keep real compiled/fullscreen and regular renderer assertions. |
| tests/gpt-live-request.test.ts:1–39 | Keep: overlapping provisional speech and omitted-fragment refusal. |
| tests/history-publication-collision.test.ts:1–74 | Keep: publication collision rollback and recovery in isolated subprocess. |
| tests/live-audio-lifecycle.test.ts:1–130 | Keep: worker ownership, failure cleanup, flush/backpressure and pre-aborted launch. |
| tests/live-auth-lifecycle.test.ts:1–233 | Optional feature cut only: Google file import; keep canonical auth, OAuth refusal and cancellation tests. |
| tests/live-config.test.ts:1–72 | Keep: strict model/provider validation and persisted selection across switches. |
| tests/live-credentials.test.ts:1–60 | Keep unless file-import feature is cut: parser, private-file, link, size and opaque-error security tests. |
| tests/live-dispatch-budget.ts:1–91 | Keep: paid-smoke budget is enforced at dispatch, retries disabled; imported by goals smoke tests. |
| tests/live-execute-controls.test.ts:1–69 | Keep: actual CLI scoped live.stop and jobs.stopWork ACK route; unit foreground tests are not replacements. |
| tests/live-gpt-tui.test.ts:1–68 | Refactor only duplicated tmux plumbing; keep source CLI rendering of bounded GPT provisional transcript. |
| tests/live-main-orchestrator-runtime.probe.ts:1–143 | Retire superseded offline investigation probe after migrating its remaining bridge-paging assertion. |
| tests/live-picker-tui.test.ts:1–111 | Refactor only duplicated tmux plumbing; retain both widths, navigation, persistence and setup-without-start. |
| tests/live-prompt.test.ts:1–29 | Keep: prompt delegation/speech/completion semantics and exact request schema. |
| tests/live-provider.acceptance.test.ts:1–30 | Keep: separate explicit paid opt-in real provider configuration acceptance, not a deterministic test substitute. |
| tests/live-setup.test.ts:1–112 | Optional file-import cut: remove migration cases; keep explicit-start and cancelled-choice boundaries. |
| tests/live-speaker-summary.test.ts:1–24 | Keep: hardware processing unknown/correlation disclosure, not a measured AEC-pass assertion. |
| tests/live-transcript.test.ts:1–131 | Keep: complete transcript retention versus clipped view, interleaving, exact chunk boundaries and provisional grouping. |
| tests/live-tui-startup.test.ts:1–22 | Keep: tests session-only trust behavior of shared source startup helper. |
| tests/live-tui-startup.ts:1–25 | Keep: shared source startup helper has multiple actual callers and avoids persistent trust writes. |
| tests/manual-release.test.ts:1–106 | Keep: isolated release preparation, idempotence, version validation and publication SHA/gate contract. |
| tests/manual-shake-sdk.test.ts:1–479 | Refactor repeated SDK setup/messages; keep transformed-call/result, overflow, threshold and persistence-failure tests. |
| tests/offline-process-isolation.test.ts:1–103 | Keep: sentinel socket demonstrates inherited Herdr identity cannot reach a user pane; helper sanitization is essential. |
| tests/output-buffer.test.ts:1–71 | Keep: bounded output, metadata, copied backing buffers, byte pagination and logical offsets. |
| tests/phase1-compaction-fixture.ts:1–17 | Keep: explicit Phase 1-only fixture imported by SDK/live suites; production still registers cache-affine machinery. |
| tests/product-identity.test.ts:1–37 | Keep: repository/update asset identity and old-product sentinel non-modification. |
| tests/prompt-preview.test.ts:1–140 | Keep: real prompt assembly with network forbidden and project settings excluded; isolated and selected contexts differ. |
| tests/questions-interactive-tui.test.ts:1–150 | Refactor only duplicated tmux plumbing; keep cancelled draft, stale snapshot and narrow rendered picker tests. |
| tests/remote-artifacts.test.ts:1–116 | Keep: artifact continuity/digests, private task paths, symlink/escape rejection and incomplete-download recovery. |
| tests/remote-e2e.test.ts:1–47 | Refactor repeated runner wrapper; retain independent RPC/PTY opt-ins and real Docker/SSH entrypoint. |
| tests/remote-job-artifacts.test.ts:1–40 | Keep: native job output reaches task-owned offline artifacts before buffers vanish; gaps surfaced. |
| tests/remote-jobs-placement-fixture.test.ts:1–121 | Keep: tests generated execute from actual local fake-provider process; fixture-validity evidence, not SSH acceptance. |
| tests/remote-menu.test.ts:1–167 | Keep: unknown/offline/foreign owner states, reply reconciliation, printable labels and capability eligibility. |
| tests/remote-placement-e2e-fixture.test.ts:1–151 | Keep: fixture validity guards; never mistake these source checks for real placement acceptance. |
| tests/remote-placement-entry.test.ts:1–28 | Keep: operation-owned fields reject arbitrary host/source permissions on compiled remote wire. |
| tests/remote-repository-wire.test.ts:1–184 | Keep: no-history snapshot, upload idempotency, original parent/session intent and approved-byte tamper fence. |
| tests/remote-root-client.test.ts:1–179 | Keep: durable root receipt reconciliation, unknown non-redispatch, immutable owner/model and local drift protection. |
| tests/remote-runner-placement-fixture.test.ts:1–98 | Keep: validates already-shared generated runner code and exact cancellation ID; source checks protect fixture validity. |
| tests/remote-ssh.test.ts:1–41 | Keep: hostile SSH peer bounds and TERM-to-KILL escalation; unknown outcome remains honest. |
| tests/session-costs-tui.test.ts:1–84 | Refactor only duplicated tmux plumbing; retain nested cost attribution, idle update and reopen/resume. |
| tests/session-identity.test.ts:1–17 | Keep: persistent versus stable distinct ephemeral identities. |
| tests/startup.test.ts:1–145 | Keep: nonpersistent quiet-start override and early editor ownership with draft preservation. |
| tests/stop-work.test.ts:1–115 | Keep: session-scoped partial discovery/cancellation status and already-finished native distinctions. |
| tests/t3-android-packaging.test.ts:1–33 | Keep: shipped canonical patch/build optional dependency and typed Android failure contract. |
| tests/t3-migration-acceptance.test.ts:1–120 | Keep pending migration-gate owner decision: canonical historical patch/HEAD/dependency pin preflight; not proven obsolete. |
| tests/task-monitor-source.test.ts:1–388 | Keep: merged monitor cache-only SSH routing, ownership/epoch revalidation, narrow confirmation and disposal races. |
| tests/tool-schema.test.ts:1–43 | Keep: real registered execute schema and provider argument validation/coercion. |
| tests/turn-boundaries.ts:1–22 | Keep: reusable Pi all-results-yield helper has unit and real background TUI callers. |
| tests/typescript-execution.test.ts:1–501 | Keep: process lifecycle, descendant cleanup, byte/Unicode limits and actual tool/runner bridge behavior. |
| tests/update-release-shape.test.ts:1–195 | Keep: official raw/checksum atomic replacement, concurrent owner fence and fixture validity; does not prove executable boot. |
| tests/wisdom-extension.test.ts:1–74 | Keep: extension behavior/prompt injection/root-only UI; no wisdom/docs deletion recommendation. |

## Gaps / continuation checkpoints

**The exhaustive user requirement is unmet.** No removal claim is made for an unread file. No line-review claim is made from import scans, test titles, loading file bytes to calculate chunks, or truncated previews. The two partial files were read sequentially; their findings are counterevidence, not whole-file refactor recommendations.

| File | Lines actually read | Next unread line |
|---|---:|---:|
| tests/background-ux.test.ts | none | 1 |
| tests/cache-affine-compaction-live.test.ts | none | 1 |
| tests/cache-countdown.test.ts | none | 1 |
| tests/diagnostics.test.ts | none | 1 |
| tests/execute-output-capture.test.ts | none | 1 |
| tests/execution-previews.test.ts | none | 1 |
| tests/footer.test.ts | none | 1 |
| tests/gpt-live-session.test.ts | none | 1 |
| tests/history-storage-io.test.ts | none | 1 |
| tests/instruction-continuity-sdk.test.ts | none | 1 |
| tests/live-long-audio.test.ts | none | 1 |
| tests/live-main-integration.test.ts | 1–229 | 230 |
| tests/live-main-owner.test.ts | none | 1 |
| tests/live-orchestration.test.ts | none | 1 |
| tests/llm.test.ts | none | 1 |
| tests/manual-shake.test.ts | none | 1 |
| tests/native-compaction-shake-coverage.test.ts | none | 1 |
| tests/openai-session-schema.test.ts | none | 1 |
| tests/pi-host.test.ts | none | 1 |
| tests/questions.test.ts | none | 1 |
| tests/remote-extension.test.ts | none | 1 |
| tests/subagent-placement.test.ts | none | 1 |
| tests/t3/production-bridge.test.ts | none | 1 |
| tests/task-manager.test.ts | 1–145 | 146 |
| tests/task-monitor.test.ts | none | 1 |
| tests/typescript-images.test.ts | none | 1 |

Continue these exact files/chunks before combining this report into an exhaustive repository audit. In particular, remote-extension, production-bridge, manual-shake, Live owner, history, execution-preview and subagent-placement suites are **not** candidates for deletion based on this report. No full build or suite ran; all suggested checks remain future validation. Shared-workspace edits by other reviewers were not reset or modified.
