# tests1 maintenance-reduction audit (PARTIAL)

## Overview

**75/94 assigned files, 8,047/18,083 assigned lines fully read. 19 files / 10,036 lines remain unread. This is not a completed every-line audit.** Coverage below and the JSON are explicit; unread files have no keep/removal verdict and next unread line 1. Numbered source chunks were read, including entire fixture/config bodies. Truncated previews were revisited where needed; search results alone do not count as file review.

Read-only research: no production/tests/config changes, builds, suites, provider calls, audio or paid acceptance runs. Only this report and coverage JSON written. Read values.md and relevant fast-delivery guidance; no wisdom changes or documentation deletion savings. Existing scripts remain active evidence: package.json runs all tests, scripts/ci.sh:33,57 executes Live/root inventories, .github/workflows/release.yml:167 runs root tests. Thus lack of imports is **not** unused evidence. Fixture files also have CLI, container and explicit script consumers.

No fully reviewed assigned file is proven wholly dead. Best behavior-preserving opportunities are **small shared test mechanics**, not removal of lifecycle/security assertions. Estimated non-overlapping behavior-preserving savings: **gross 378–442 / net 170–259 owned lines** (01–05,09). Optional cuts 06–08 add **gross 104–107 / net 76–98 owned lines**; adjacent production/workflow savings are separate and must not be double-counted by other audit groups. These are implementation estimates, not a measured patch.

## Ranked actionable findings

### tests1-01 — Share isolated, offline SDK resource/session construction

- **Behavior-preserving refactor; medium-high confidence. Gross 180–205, net 60–105 owned lines.**
- Exact repeated mechanical regions: attention-sdk.test.ts:52–86; questions-sdk.test.ts:21–27,59–90; live-paired-runtime.test.ts:24–32,50–67,136–144,180–197; prompt-delivery.test.ts:64–94; cache-affine-compaction-sdk.test.ts:51–57,145–152,173–187,261–267,354–361,374–387. Preserve extension factory callback bodies, provider serializers, settings and all assertions in place.
- All instantiate an isolated loader disabling extension/skill/theme/prompt discovery, reload it, then build a real AgentSession with isolated cwd/agentDir and explicit runtime/session manager. tests/helpers.ts:1–27 currently supplies only environment/subprocess helpers; no existing session fixture was found in the helper/fixture search.
- Add a **test-only** construction helper with explicit model, manager, settings, tools, loader overrides and runtime injection; keep auth stub creation opt-in. Do not create a generic fake-provider framework or abstract the different stream event shapes (start/done/end timing is part of these tests).
- Counterevidence: questions uses an on-disk manager and runtime.stream hooks; paired tests use in-memory managers and agent.streamFunction; compaction intercepts actual serializers; prompt-delivery:31–48 deliberately needs no fake runtime. These differences must remain explicit. phase2-native-live.test.ts:16–34 is paid real-auth acceptance and must **not** use an offline-auth stub.
- Behavior lost: none intended. Checks: focused offline SDK tests individually and together, clean temporary teardown, captured payload equality, zero-network assertions, subscription counts, saved-question new-turn behavior and async paired completion. Maintain no-extension/no-skills discovery and isolated auth paths; never make a missing credential silently become usable.

### tests1-02 — One small test-only tmux harness, retain distinct UI scenarios

- **Behavior-preserving refactor; high confidence in duplication, medium in net estimate. Gross 120–145, net 55–85 owned lines.**
- Repeated socket command/quoting/bounded capture loops/launch setup: subagent-settings-tui.test.ts:8–21,23–42,67–69; main-agent-mode-tui.test.ts:8–25,27–63,70–72; execution-previews-tui.test.ts:19–32,97–120,147–150; questions-tui.test.ts:13–15,21–23,36–44,65–87,108–110.
- Supply socket/session name, isolated home, dimensions, explicit launch argv and capture(history?) to a helper built on existing run()/offlineTestEnv(). Expose raw key sending; keep scenario-specific command-completion logic and reload in each test. This is not permission to merge the four tests or reduce real-screen assertions.
- Counterevidence: questions-tui:24–34 waits for composer consumption/conditional second Enter; preview:104–106,141–142 deliberately uses regular mode and scrollback for expanded details; mode sets depth 0 and tmux.conf; settings relies on selection persistence. Preserve these rather than forcing one universal send routine.
- scripts/tui-harness.ts:4–10,14–29 is a stateful user CLI with defaults and repository artifacts, not an importable test fixture. Reusing that CLI would add state and unsafe/default provider behavior. Keep the new helper minimal, not another user-facing harness.
- Behavior lost: none. Checks: same four compiled offline TUI tests, startup binding wait, 38-column rendering, reload/cancel, profile save and mode instructions-only behavior. Keep unique sockets, kill **only that socket**, isolated homes, offline flags and HERDR scrubbing. Correct centralized shell quoting must preserve paths containing apostrophes; current copies are not all spelled identically.

### tests1-03 — Remove assertions already enforced by stronger checks in the same inventory

- **Safe test removal (individual duplicate expectations, not entire tests); high confidence. Gross 17–25, net 13–21 owned lines.**
- release-workflows.test.ts:128–130 repeats immutable setup pins/versions already checked at :48–89 for ci/live/release; :141 and :176 repeat audited upload/download SHAs from that same map; :182–183 repeats structured permission checks at :68–72 and :245–246. :158 repeats the exact macOS test command at :44. :398–399 repeats the cache setup strings checked at :100–105.
- :179 duplicates exact publish.needs checked structurally at :237–242. :169 duplicates structured push tags at :232–233 and ci-selective-workflow.test.ts:134. :170 duplicates structured dispatch existence at ci-selective-workflow.test.ts:135. Remove only these expectations and any newly redundant read; preserve surrounding unique checks.
- Counterevidence: do **not** delete the full action pin map (it checks approved immutable commits, not merely SHA shape), action permission enforcement, build-before-test ordering, exact binary payload paths, release gating, notice/license generation, or smoke-script.test.ts:63–77 (it proves actual ordering and log routing beyond a substring). A literal publish.if guard is not wholly redundant with the evaluator, whose always() is hardcoded true (:23–44); preserve its always/run-after-skipped semantics unless separately tested.
- Behavior lost: duplicate assertion failure locations only; security and release contracts retain an owner. Checks: release-workflows, ci-selective-workflow and smoke-script focused tests; deliberately alter a pin, version, permission and required gate in a future isolated verification patch to ensure remaining checks reject it. No deletion just because a test reads source text.

### tests1-04 — Stage one canonical SSH fixture config into three Docker contexts

- **Behavior-preserving refactor; high confidence. Gross/net 28 owned lines (remove two duplicate copies; canonical relocation is zero savings); repository-wide net about 22–28 after runner edits.**
- tests/fixtures/{remote-e2e,remote-placement-e2e,remote-typed-root-placement}/sshd_config:1–14 are byte-identical (read and compared). Keep one 14-line common file and delete the three local copies; moving a canonical copy is not a further 14-line saving. Alternatively retain remote-e2e as canonical and remove just the other two; same content savings.
- Real consumers: scripts/remote-e2e.sh:16; scripts/remote-placement-e2e.ts:158–168; scripts/remote-root-placement-e2e.ts:186–197; scripts/task-placement-clean-capture.ts:203–216; all three fixture Dockerfiles COPY the staged filename. Update staging to copy the common source as build/sshd_config, without changing the container destination. Update remote-typed-root-placement-fixture.test.ts:235 to read the canonical source. No symlink across Docker build contexts.
- Counterevidence: these are independent script-created build contexts, so deleting copies without staging changes breaks externally invoked acceptance/demo runners. wisdom/experiments/remote-ssh-probe also has a config consumer and is **not** included in this saving.
- Behavior lost: none. Checks: static byte/COPY inventory, build-context dry staging, fixture safety test; actual SSH acceptance only when authorized later. Keep public-key-only login, private key permissions, no TTY/forwarding/agent forwarding/X11 and StrictModes. Do not weaken policy while consolidating it.

### tests1-05 — Eliminate a target-label-only test matrix

- **Safe coverage-preserving test reduction; high confidence. Gross 13–15, net 2–4 owned lines after writing a single direct invocation.**
- packed-web.test.ts:100–119 loops over four compile target strings at :105, but the target is used **only** in unexpected-action error messages (:108,:111). Each iteration calls identical prepareWebPayload(root,"packed",actions), hashes the same archive and rereads its bytes. scripts/packed-web.ts:144–154 takes no target and performs no compile.
- Replace the four labels with one packed reuse invocation (or two invocations if repeated reuse is explicitly the contract), retain throwing fresh/repack callbacks, immutable byte/hash/mtime and packs()==1 assertions; rename to accurately describe reuse after deleting mutable staging. It never proved four cross-compiles.
- Counterevidence: the real native embedding test :170–183 is distinct and must remain; production release cross-target builds are also distinct. Do not remove actual targets from release automation or tests based on this finding.
- Behavior lost: repeated identical verification calls/target labels only; no target-specific coverage existed here. Checks: packed-web focused tests, retain missing/tampered/receipt failure cases and native embedding probe in future authorized validation. Savings are modest; useful chiefly because it removes misleading evidence.

### tests1-09 — Table-drive the no-traffic emitter fixtures

- **Behavior-preserving refactor; high confidence. Gross 20–24, net 12–16 owned lines.**
- t3/web-task-events.test.ts:59–81 repeats the same throwing write callback and emitter object three times for rpc/no-flag, tui/flag-on and json/flag-on. Loop over [mode,env] pairs and invoke the actual emitter with spawned.
- Preserve all three independent combinations; retain :30–57 public-field/bounded/redaction checks and :83–93 activity/stopping suppression. Behavior lost: none. Counterevidence: modes differ; removing combinations outright would lose routing coverage. Checks: focused web-task-events tests, confirm thrown write fails the test if any forbidden mode emits.

## Feature cuts requiring human choice

### tests1-06 — Retire the dated private dependency-update acceptance mode, if no longer needed

- **Feature cut; high confidence in cost, no claim it is unused. Gross 32 / net 24–30 owned test lines; adjacent script/workflow gross roughly 24–30 / net 19–27.**
- dependency-updates.test.ts:68–99 exists solely for --fixture mode restricted to tnfssc/die-dependency-pr-fixture-20260930. scripts/update-dependencies.ts:9–14,18–27,103–111 carry options, fixed repository restriction and CLI plumbing. .github/workflows/dependency-updates.yml:7–11,47,52–54,87,93,144,166 adds the input, args/env and explicit TEST ONLY review labels.
- Human choice: lose the hosted one-dependency synthetic candidate path for proving a real PR without updating the full dependency set. Default updater selection/validation/publication remains. It is deliberately reachable through workflow_dispatch, not dead by missing import. dependency-workflow.test.ts:25–72 confirms other security gates must remain.
- Keep arbitrary CLI arguments rejected **before Bun update spawns**, replacing the fixture denial test with unsupported-argument denial rather than just deleting it. Keep credential split, exact-candidate validation, fixed allowed changed files, force-with-lease and no automatic merge/release.
- Checks: focused dependency tests and parsed workflow after removal; future hosted real-changing PR acceptance is a separate authorization/expense decision. Do not use the absence of a local call as evidence that external dispatches ceased.

### tests1-07 — Stop reconstructing old JSON-embedded voice user prompts, fail closed instead

- **Feature cut; high confidence in code boundaries, medium in acceptable product tradeoff. Gross 45 / net 25–38 owned test lines; adjacent production gross about 35–40 / net 25–33.**
- live-passive-history.test.ts:61–85,113–132 exercises the old prefix and fragment dedup/reconstruction, including string and block-shaped user contents. src/live/passive-history.ts:5–38,45,79 carries its parser, seen-fragment set and dispatch. Current extension context filtering remains active (src/live/extension.ts:90).
- Choice loses actionable speech recovery from old transport-dump prompts on resume; these are durable saved sessions, so compatibility is a real product feature, not proven-dead code. Replace the legacy-prefix case with a minimal historical/non-actionable fact or drop it from coder context while retaining raw audit records. **Never merely delete legacySpeech and leave the old dump as ordinary user instructions.**
- Retain current snapshot request matching, source-only uncertainty facts, overlap handling, nonmutation and :134–150 missing-speech replay regression. Keep tests for both string and text-block legacy inputs failing closed, no manufactured request and unchanged stored audit bytes. Do not delete history files or rewrite old requests.
- Checks: passive-history, gpt-live-request/delegation and actual restored-session owner/context tests (some outside this assigned/read subset); a human must accept losing old actionable replay.

### tests1-08 — Remove the compaction test's extra failure-artifact feature, not its assertions

- **Feature cut of developer diagnostics; high confidence. Gross/net 27–30 owned lines.**
- cache-affine-compaction-sdk.test.ts:42–45,73,159–168,203–216,246 collects notices/untransformed attempts, replaces ui.notify, writes timestamped artifacts/compaction/sdk-failure-*.json and logs mismatched fields solely when the expected strategy fails.
- Keep captured transformed provider payloads, real header hook, serializer interception/sentinel and all :217–244 assertions. Delete only extra diagnostic instrumentation, not error-stream handling (:103–117,:300–314), which prevents stalled tests and propagates failures.
- Behavior lost: failure-only raw-attempt artifact and notification/mismatched-field convenience. Counterevidence: this evidence can diagnose actual upstream payload mismatches, which normal assertion output might not show. User may prefer keeping it; no assertion or runtime-coverage gain from its removal.
- Checks: offline compaction tests and a deliberate strategy failure in a future isolated validation patch; assert original failure remains visible and no repository artifact is required for success/failure. Estimate excludes resource-construction regions in 01.

## Keep rationale / per-file verdict

Each fully read file has a specific verdict here; finding IDs are also in the coverage JSON. Shared fixtures are executable/script inputs even when not imported by production. A skipped paid test is not dead. Keep the core boundaries: human-only question/capability authority, child depth/place restrictions, credential scrubbing, approved untracked transfers, staged-index/drift preservation, private extraction/integrity, stable replay IDs and truthful partial cancellation. Backend, compiled-runner, SDK and rendered-TUI tests cannot generally substitute for each other.

| Fully read assigned file | Verdict |
|---|---|
| `tests/attention-sdk.test.ts` | Keep real print-session subscription/wait boundedness; share offline resource setup. |
| `tests/cache-affine-compaction-sdk.test.ts` | Keep actual provider serializers, cache-prefix/thinking preservation and fresh-hook tools; share setup; optional failure evidence cut. |
| `tests/ci-selective-workflow.test.ts` | Keep executed shell gates, merge-tree trust and publication truth tables; absorbs duplicate textual release checks. |
| `tests/ci-selective.test.ts` | Keep docs classification, NUL filenames, dirty/mode/history fail-closed cases. |
| `tests/completion-batcher.test.ts` | Keep burst, maximum wait, callback isolation, reset and disposal cases; no duplicate implementation found. |
| `tests/dependency-updates.test.ts` | Keep updater selection, Pi alignment and version/lock summaries; dated private fixture mode is optional. |
| `tests/dependency-workflow.test.ts` | Keep credential split, exact candidate, leased push, bounded logs and fixed-PR policy; fixture input may be retired. |
| `tests/editor.test.ts` | Keep real editor render/input/mouse/Unicode/wrap/history/autocomplete checks; compact local fixture already reused. |
| `tests/error-diagnostic.test.ts` | Keep thrown-getter/conversion safety, missing stack message and bounded diagnostic assertions. |
| `tests/execute-handoff.test.ts` | Keep mock extension plus real TaskManager survival and exactly-once completion; not interchangeable with runner tests. |
| `tests/execution-previews-tui.test.ts` | Keep actual narrow-screen, restore and expansion assertions; share terminal harness. |
| `tests/find-ci-baseline.test.ts` | Keep trusted ancestor/API identity and failure cases; actual selector demonstrates skipped-source regression. |
| `tests/fixtures/live-picker-tui.ts` | Keep active extension entrypoint used by tests/live-picker-tui.test.ts:51; provider/mic/session denial is essential offline fixture behavior. |
| `tests/fixtures/live-spoken-tui.ts` | Keep active extension entrypoint used by tests/live-spoken-tui.test.ts:40; real owner/renderer and incomplete-speech refusal differ from picker fixture. |
| `tests/fixtures/remote-e2e/subagents.json` | Keep destination normal profile consumed by remote-e2e build/script; no inert-import inference. |
| `tests/fixtures/remote-placement-e2e/entrypoint.sh` | Keep container PID1 sshd and local fake-provider startup; ownership differs from typed fixture logging. |
| `tests/fixtures/remote-placement-e2e/fake-provider.ts` | Keep active HTTP/SSE fixture entrypoint; almost duplicated with typed fixture, but generic server/wrappers likely save too little to justify extra indirection. |
| `tests/fixtures/remote-placement-e2e/models.json` | Keep parent/orchestrator/normal profiles and local inert key used by actual placement runner. |
| `tests/fixtures/remote-placement-e2e/subagents.json` | Keep distinct normal/orchestrator fixture model IDs; profile test checks depend on these roles. |
| `tests/fixtures/remote-typed-root-placement/fake-provider.ts` | Keep active loopback-only HTTP/SSE entrypoint; do not erase loopback binding or scenario-specific logs while deduplicating. |
| `tests/fixtures/remote-typed-root-placement/models.json` | Keep typed root/normal model identities; no catalog conflation with placement profiles. |
| `tests/fixtures/remote-typed-root-placement/proof.ts` | Keep shared fail-closed evidence predicates used by focused tests AND scripts/remote-root-placement-e2e.ts. |
| `tests/fixtures/remote-typed-root-placement/subagents.json` | Keep destination normal profile; actual descendant launch depends on it. |
| `tests/foreground-execution-sdk.test.ts` | Keep SDK streamed argument/rendering/image/animation/failure integration; mocks and compiled runner have different jobs. |
| `tests/history-projection-parity.test.ts` | Keep isolated native/adapted SDK comparison, disk reopen, edits, branch and repeated checkpoint semantics. |
| `tests/instruction-mode.test.ts` | Keep branch authority, corrupt/latest record, persistence failure and disk-reopen framing checks. |
| `tests/live-audio.test.ts` | Keep handshake/start/stop, malformed frames, backpressure, redaction and channel metadata; existing open/running helpers are useful. |
| `tests/live-cost.test.ts` | Keep modality-specific accounting, duration/cumulative dedup and explicit unknown pricing; no blanket matrix removal. |
| `tests/live-embedded-helper.test.ts` | Keep private extraction/integrity/symlink/platform and actual compiled-bundle tests; neither source nor inert bytes prove all of this. |
| `tests/live-gpt-live-provider.acceptance.test.ts` | Keep explicit paid opt-in transport acceptance; never infer dead code from its default skip. |
| `tests/live-host-access.test.ts` | Keep shared host identity and refusal to resurrect text/provider fallback without a main Pi owner. |
| `tests/live-paired-runtime.test.ts` | Keep canonical backend tool execution, admitted-work survival and async completion without synthetic user turns; share offline setup. |
| `tests/live-passive-history.test.ts` | Keep current voice audit exclusion and uncertainty/data-only matching; legacy reconstruction is a human-choice cut. |
| `tests/live-platform.test.ts` | Keep shipped/source helper paths and model credential scrubbing. |
| `tests/live-setup-diagnostics.test.ts` | Keep Swift startup ordering/stage coverage and private-domain redaction; mock protocol tests cannot observe native source ordering. |
| `tests/live-status.test.ts` | Keep local interactive root restriction; not dead simply because other callers also check locality. |
| `tests/main-agent-mode-tui.test.ts` | Keep rendered root mode switching; share terminal harness, not the behavioral assertions. |
| `tests/no-web-voice.test.ts` | Keep maintained-patch no-voice boundary and CLI provider catalog; patch assets are active build inputs. |
| `tests/packed-web.test.ts` | Keep receipt/input/integrity/environment/symlink and native embedding tests; remove target-label-only repetition. |
| `tests/phase2-native-live.test.ts` | Keep explicitly gated real paid native compaction/disk recall/repeat acceptance; do not route through fake-auth helper. |
| `tests/prepare-assets.test.ts` | Keep exact payload inventory and unchanged-mtime check; it is build-script behavior, not an unused asset list. |
| `tests/prompt-delivery.test.ts` | Keep registered and actual stream prompt/tool propagation, project/appended guidance and next-turn consistency; share offline setup only. |
| `tests/provider-prompt.test.ts` | Keep real Codex serializer onPayload interception and zero-network proof; not equivalent to local prompt assembly. |
| `tests/questions-sdk.test.ts` | Keep saved-answer fresh-turn, hidden metadata and duplicate-answer behavior in real SDK; share isolated resource setup. |
| `tests/questions-tui.test.ts` | Keep progress, persistent footer, shortened IDs, cancellation and reload; share terminal mechanics only. |
| `tests/release-workflows.test.ts` | Keep security pins/permissions, actual notice/tag/notes functions, CLI probes and gate inventory; remove demonstrably duplicate source assertions. |
| `tests/remote-capabilities.test.ts` | Keep grant/task/kind binding, traversal/symlink/size/binary denial, revoke/late-result and handler limits. |
| `tests/remote-descendant-environment.test.ts` | Keep human facet tokens and parent checkpoint authority out of child/model tool environments. |
| `tests/remote-job-delivery.test.ts` | Keep durable claims, replay/lease, stable completion IDs, attention supersession and bounded retries. |
| `tests/remote-job-observations.test.ts` | Keep per-session observation privacy, unknown-not-terminal, protected repository-return priority and bounded real child result. |
| `tests/remote-placement-legacy-launch.test.ts` | Keep explicit legacy-launch rejection: a security/policy bypass regression, not compatibility support to delete. |
| `tests/remote-repository.test.ts` | Keep tracked/staged preservation, approved untracked transfer, orphan baseline, drift/creation/hidden-edit review boundaries. |
| `tests/remote-typed-root-placement-fixture.test.ts` | Keep scenario parsing, negative proof tests and actual relay mechanics; update common SSH path if deduplicated. |
| `tests/resume-stream-cancellation.test.ts` | Keep subprocess isolation for late/active stream abort and invalid-header preservation; scoped list/listAll are distinct paths. |
| `tests/root-placement-options.test.ts` | Keep explicit authorized target/source parsing, offline thin-client behavior and explicit project trust. |
| `tests/root-placement-policy.test.ts` | Keep root-startup child/scoped-native rejection; prevents authority reset. |
| `tests/root-runtime.test.ts` | Keep private IPC human token/owner/version fencing, exactly-once question delivery, partial-stop truth and task-row projection. |
| `tests/session-boundaries.test.ts` | Keep architectural dependency boundaries; inexpensive sentinels are not evidence of runtime coverage but enforce intentional separation. |
| `tests/session-costs.test.ts` | Keep descendant/fork identity, partial JSONL, failed attempts, truncation/rotation and refresh coalescing; helpers already reduce repetition. |
| `tests/session-input.test.ts` | Keep finality-not-authority, revoked/expired/oversized input and fail-closed request capacity. |
| `tests/smoke-script.test.ts` | Keep fake executable tests proving build/reuse and actual invocation guards/order; avoid deleting checks because release also mentions smoke. |
| `tests/sol-model-catalog.test.ts` | Keep offline registry plus real selector and prices/capabilities; hardcoded expected model data is intentional upstream contract evidence. |
| `tests/subagent-profiles.test.ts` | Keep explicit off/inherit, invalid input, delegation depth and private roundtrip/malformed settings. |
| `tests/subagent-settings-tui.test.ts` | Keep actual searchable picker/save; share terminal setup, not the UI flow. |
| `tests/subagent-settings-ui.test.ts` | Keep discard/save/unavailable/inherit/narrow/focus/search and malformed-file preservation; component vs TUI checks are not duplicates. |
| `tests/system-prompt.test.ts` | Keep explicit project/global/CLI override and trust boundaries; no permission bypass or implicit override removal. |
| `tests/t3/local-notifications.test.ts` | Keep durable outbox/ACK/late connection/retry/stop/capacity/priority cases; protocol resembles SSH delivery but is a separate implementation. |
| `tests/t3/web-chunks.test.ts` | Keep real Node graph gate against cyclic/missing/empty/lazy-DAG output; not a sampled source-shape test. |
| `tests/t3/web-runtime.test.ts` | Keep private deterministic archive, corrupt/concurrent/symlink safety and shipped CLI/bootstrap teardown probes. |
| `tests/t3/web-task-events.test.ts` | Keep public-field/redaction/bounded traffic semantics; table-drive identical no-write emitter cases. |
| `tests/turn-boundaries.test.ts` | Keep complete all-yield batch and error/mixed/incomplete rejection; a tiny test already uses a shared helper. |
| `tests/worker-handoff.test.ts` | Keep compiled handoff ACK/unwind/unavailable and cleanup-error preservation; unit diagnostic coverage does not replace shipped runner. |
| `tests/fixtures/remote-e2e/sshd_config` | Keep one canonical copy; other two byte-identical copies can be eliminated with staging-path updates. |
| `tests/fixtures/remote-placement-e2e/sshd_config` | Replace duplicate with common canonical config staged into unchanged Docker context. |
| `tests/fixtures/remote-typed-root-placement/sshd_config` | Replace duplicate with common canonical config; update infrastructure safety test path. |

## Gaps / next work

**Every file below is wholly unread; next unread line is 1.** No keep/removal conclusion and no savings assigned to these. In particular this partial report cannot evaluate the largest Live/subagent/owner fixtures, state duplication or coverage overlap hidden there. Complete them before treating this group as an exhaustive audit. All completed files were read through their manifest line count; JSON linesRead is an integer count, not grep hit count.

- `tests/background-ux-tui.test.ts`: next unread line 1.
- `tests/conversation-density.test.ts`: next unread line 1.
- `tests/goals-sdk.test.ts`: next unread line 1.
- `tests/gpt-live-delegation.test.ts`: next unread line 1.
- `tests/gpt-live-playback.test.ts`: next unread line 1.
- `tests/herdr-agent-state.test.ts`: next unread line 1.
- `tests/job-attention.test.ts`: next unread line 1.
- `tests/last-used-cli-model.test.ts`: next unread line 1.
- `tests/live-extension.test.ts`: next unread line 1.
- `tests/live-playback.test.ts`: next unread line 1.
- `tests/live-session.test.ts`: next unread line 1.
- `tests/remote-client.test.ts`: next unread line 1.
- `tests/remote-owner.test.ts`: next unread line 1.
- `tests/remote-root-presenter.test.ts`: next unread line 1.
- `tests/root-owner.test.ts`: next unread line 1.
- `tests/subagent-extension.test.ts`: next unread line 1.
- `tests/task-monitor-tui.test.ts`: next unread line 1.
- `tests/task-rows.test.ts`: next unread line 1.
- `tests/typescript-runner.test.ts`: next unread line 1.

No tests were executed: this is source/reference evidence, not proof that the proposed refactors pass. Read-only checks were source searches, exact duplicated-config comparison and source/signature inspection. Cross-file searches were bounded to relevant callers/scripts/build assets; not a repo-wide unused-code claim. Net ranges remain rough until an actual patch is measured. Other audit groups own adjacent production/workflow files: reconcile savings at integration, particularly 04,06,07.
