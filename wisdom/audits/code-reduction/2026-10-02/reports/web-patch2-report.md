# Maintained web patch — reviewer 2 reduction audit

## Completion and accounting

**Complete assigned line review: integrations/t3/upstream/bruv.patch:2901–5800 inclusive, 2,900/2,900 lines.** Read sequential, numbered, bounded chunks (at most 3,900 characters); no assigned chunk was truncated. Coverage JSON partitions that interval at file-diff boundaries. The first and last files are partial-file assignments, not whole-file audit claims.

Patch SHA-256: `c84fdee8b37133efe1a7fad8e3116f263fe0d6ca39fd162382a283a111946323`.

Read wisdom/values.md and the complete web-report.md for context. This is the maintained production patch, not wisdom/experiments/t3-v2. No production edits, builds, tests, provider requests, or live sessions were performed. Only the two requested audit artifacts were written.

Counting: estimates are **source lines**, not diff metadata, patch context, removed upstream lines, generated output, or a second count of the same patched source. Formatting-only replacement hunks are not substantive reduction opportunities. New helper/adapter lines count against net savings even outside this assignment. Estimates are implementation proposals, not measured post-refactor results.

Best opportunities: reuse existing real orchestrator test setup without dropping local-job scenarios, and simplify deterministic fixture response construction. Recommended candidates below total approximately **183–216 net lines** (110–120 + 55–68 + 15–25 + 3); the ancestry consolidation needs more care than the fixture reductions. No safe large-saving production feature cut established.

## Production provenance / tracing

integrations/t3/upstream/source.json pins pingdotgg/t3code at **66a91077f9abf6e171aad0ceab2519d7272f3ff3**. build/build.ts:52–79 applies this exact canonical patch and verifies source; prepared builds also verify it at 99–108. No separate overlay is applied in that inspected path. Source-level work must be regenerated into the canonical patch and pass source verification, not merely edit an old cache.

Available .cache checkouts were older revisions, including the old v2-production experiment. They were **not used as current-source evidence**. Read the relevant pinned GitHub raw files instead. Applied the patch hunks **in memory only** to pinned PiAdapterV2.ts (17 matching hunks), Orchestrator.ts (53), and ProviderSessionManager.ts (5); every original/context hunk matched. Those reconstructions support the full-file reference checks below. This was not a build or an on-disk git apply.

scripts/ci-web-validation.sh:16–23 explicitly runs NativeBruvIntegration.production.test.ts, LocalJobNotification.test.ts and PiAdapterV2.test.ts. gates/native-acceptance.ts:18,95 runs the native production test separately; 122–145 consumes its evidence contract. These tests are not dead simply because they are new patch files.

## Findings

### web-patch2-01 — Reuse existing orchestrator test setup; retain all local-job tests

**Class:** duplicated test implementation, behavior-preserving consolidation. **Confidence:** medium-high. **Gross:** 129 owned lines; **net:** approximately 110–120 after layer selection/import/caller changes. **Behavior lost:** none intended.

**Exact owned location:** patch:3397–3525, target **apps/server/src/orchestration-v2/LocalJobNotification.test.ts**, new-file hunk @@ -0,0 +1,409 @@. Imports and PlatformTestLayer, ServerConfigLayer, codex selection/adapter/registry, checkpoint/VCS layers and enrichment mocks reproduce the existing setup in pinned **apps/server/src/orchestration-v2/DelegatedCompletionDelivery.test.ts:1–140**. Upstream 45–104 and 106–140 are the principal corresponding definitions; the server config prefix is even the same.

**Proposal:** move the owned seedOwnedLocalJob / completionCommand and five test cases (patch:3527–3805) into the existing delivery test module, reusing its imports and setup. Do not copy the setup into a new testkit: that would relocate nearly all of the lines and provide little assigned-source net saving. Add FileSystem import, adapt service names to the existing namespace imports, and parameterize the existing layer's workspace dependency where necessary. Update scripts/ci-web-validation.sh to select the combined suite instead of the deleted path, so these tests remain mandatory. Count the added imports/layer selection against savings; do not count any upstream fixture removal.

**Counterevidence / required distinction:** upstream TestLayer supplies a mocked WorkspacePaths.normalizeWorkspaceRoot at 108–112 and only Layer.provide(PlatformTestLayer) at 139. The local suite supplies real WorkspacePaths.layer and provideMerge(PlatformTestLayer) (patch:3523–3524), and uses a scoped real temp workspace/project. Preserve a local-suite layer variant with exactly those semantics. Simply importing the upstream .test.ts or putting another Layer.provide around an already closed layer is not a demonstrated equivalent.

**Checks:** run both suites before/after, with identical scenario names/counts: atomic Stop no-wake receipt; cancelled/failed/rolled_back receipts; stable command replay; concurrent user/completion queue ordinals; stale-attention disposal. Verify separate scoped temp cleanup and persistence isolation. Update the gate path and inspect actual selected tests. None of those assertions/scenarios is counted as removable.

### web-patch2-02 — Narrow helpers within the deterministic native integration fixture

**Class:** behavior-preserving local refactor, not elimination of an acceptance feature. **Confidence:** high for duplicated shapes; medium-high on final line estimate. **Gross:** 100–109; **net:** 55–68. **Behavior lost:** none.

**Target:** **apps/server/src/orchestration-v2/NativeBruvIntegration.production.test.ts**, new-file hunk @@ -0,0 +1,868 @@.

Three independent, non-overlapping reductions:

- **patch:4045–4072,4118–4140,4145–4157** (64 lines): two identical execute-tool delta + tool_calls-finish constructions, and a text-delta + stop-finish construction. Existing sse at 3871–3874 already owns wire framing. Add small local tool/text frame constructors taking base, tool-call ID/code or text, then keep each scenario's branch and sse call. About 20–26 replacement/helper lines, approximately 38–44 net.
- **patch:4454–4460,4462–4468,4470–4476** (21 lines): identical request filtering by user-role content containing a marker. One local filter helper plus three calls replaces about 8–10 lines, approximately 11–13 net. Do not replace with matching all history roles; that would repeat the history-marker ambiguity described at 4103–4110.
- **patch:3973–3988,3992–3999** (24 lines): three identical promise/resolve barrier pairs. A tiny local deferred-void helper and three bindings can save approximately 6–11 net after formatting and adapters. Keep acquisition, waits, release handles and unconditional finalizer release locations.

**Counterevidence:** patch:4079–4101 deliberately streams success content before waiting on successRequestRelease and only later emits stop/DONE. Leave this branch custom. Keep initial/replay/terminal classification, exact repeated execute code/identity, parent-ready and terminal-response timing. Do not introduce a generic mock server, export a fixture framework, or normalize per-branch headers/timing. No overlap claimed with web-report.md's cross-gate SSE proposal; this finding is local to this newly owned file.

**Checks:** compare decoded frames/IDs/finish reasons and raw DONE framing; test barriers still prove preterminal state; run the production native test and native acceptance launcher with a reviewed executable. Preserve child/grandchild cancellation, unaffected sibling, credential separation, 401 negative, no competing MCP model tools, single context transfer, same-key replay, exact owned-PID teardown, no extra child session files, and evidence JSON consumed by native-acceptance.ts:122–145. No checks were run in this audit.

### web-patch2-03 — Make the real ancestry policy implementation the shared, tested owner

**Class:** duplicate implementation consolidation. **Confidence:** high on duplication, medium on change mechanics. **Gross assigned implementation:** 37 lines; **net:** 15–25, charging shared-helper conversion and test-adapter additions. **Behavior lost:** none; authority must remain fail-closed.

**Exact assigned location:** patch:5667–5703, target **apps/server/src/orchestration-v2/ProviderSessionManager.ts**, hunk @@ -430,9 +435,71 @@. The loop checks trusted provider, root lineage, relationship, cycles, app_owned edge, parsed profile, terminal statuses, disposed state, nearest profile and depth.

**Evidence:** existing owned **apps/server/src/mcp/BruvDelegationPolicy.ts**, patch:618–651, implements the same walk with Promise-based load. Complete canonical-patch reference search finds deriveBruvDelegationPolicy only in its definition and BruvDelegationPolicy.test.ts, not production callers. The manager is the real implementation. Thus current helper tests do not exercise this exact production walk. Its parser, profileFromMarkedPrompt, IS used by production.

**Proposal:** move the manager's Effect-based walk into the policy module, replacing rather than retaining the Promise-only walk; manager calls it with the Effect projection loader. Retain the manager's existing catch/log-to-undefined wrapper at 5704–5711 and all capability/reuse logic at 5712–5761. Adapt existing policy tests to run the real shared Effect helper. No asynchronous runtime-within-runtime adapter or parallel compatibility helper. Counts exclude deletion credit for the cross-reviewer helper; net charges additional helper/import/test adapter lines, and must be reconciled with its reviewer before implementation.

**Counterevidence:** Promise versus Effect execution is a real cancellation/error-context difference, not syntax. Calling the old helper via detached Effect.runPromise loaders is not the proposed safe shortcut. Do not conflate the Orchestrator creation fence at 5208–5257 with this routine: it rejects with command-specific errors and uses startsWith marker semantics, whereas credential issuance parses profile and yields undefined. Leave creation logic distinct unless its contract is explicitly preserved.

**Checks:** trusted/untrusted root, depth and nearest profile, forged/non-app-owned edge, relationship mismatch, cycles, terminal/disposed ancestor, loader failure. Run policy tests and ProviderSessionManager's real negative credential rotation test (patch:5477–5632), plus native credential separation. Exact capability-set equality and profile/depth equality (5739–5746) and restrictToCapabilities (5761) must remain.

### web-patch2-04 — Remove three dead owned lines and two unused import specifiers

**Class:** safe dead source. **Confidence:** high after full pinned-source reconstruction. **Gross/net:** **3 full source lines** plus two specifiers (not two additional line savings). **Behavior lost:** none.

- **patch:2956**, **apps/server/src/orchestration-v2/Adapters/PiAdapterV2.ts**, import hunk @@ -45,6 +45,7 @@: TurnTokenUsage occurs only at the added import in the full reconstructed production file (source:48). The actual upstream token routine uses OrchestrationV2ProviderTurnTokenUsage. Remove this import line; do not infer use from the older experimental adapter, which had a different normalizePiTurnTokenUsage routine.
- **patch:2981,3051**, same source, hunks @@ -269,6 +272,15 @@ and @@ -1114,6 +1130,102 @@: PiBruvShellTask.externalId is assigned but never read. Remove the interface member and object shorthand. Keep the local externalId variable, map get/set key, and nativeItemId; those are the stable card identity. Source reconstruction finds no task.externalId read and no consumer of this private interface.
- **patch:3833,3835**, **apps/server/src/orchestration-v2/NativeBruvIntegration.production.test.ts**: McpSchema and copyFile each occur once, in their imports. Remove only those specifiers; McpProtocol/McpServer and filesystem setup/cleanup remain. Each import stays on one line, so do not claim entire line savings.

**Checks:** server typecheck, Pi shell-card stable-ID/pending-work test, and native production test. No assertion or public protocol member is removed.

## Important non-removal finding

### web-patch2-05 — Unused cancellation semaphore is not permission to erase the promised boundary

**Confidence:** high that it is unused; medium on runtime race impact (no race test executed). **Gross theoretical dead lines:** 5 (patch:4693,4736–4739). **Recommended reduction savings:** **0** until boundary ownership is settled.

Target **apps/server/src/orchestration-v2/Orchestrator.ts**, import hunk @@ -59,6 +60,7 @@ and initialization hunk @@ -678,6 +678,10 @@. Full pinned patched reconstruction contains delegatedTaskMutationPermit only at its declaration and Semaphore only at import/allocation. dispatchWithReceipt at reconstructed source:9692–9693 still uses only threadDispatch.withLock(commandThreadId(command), ...).

The comments at patch:4736–4739 and 5208–5211 claim a shared serialization boundary for cancellation and descendant creation. Current code does not consume this permit. Parent-edge cancellation and descendant creation can involve different thread lock keys. BruvTaskService cancellation's ancestor-first disposal is counterevidence against unconditional failure claims, but is not proof that the advertised shared permit is implemented. No observed lost cancellation is claimed.

Do not advertise deletion of an unused guard as preserving an implemented cancellation guarantee. Trace/prove cross-thread ordering and durable fencing first; test concurrent ancestor cancellation versus child/grandchild creation and late terminal arrival. If an existing authoritative owner provides the guarantee, remove the dead declaration/import/comments; otherwise fixing the missing boundary is correctness work, not a reduction. Durable cancelled/disposed edges and their checks stay.

## Line-review verdicts / rejected cuts

- **2901–2947 — PiAdapterV2.test.ts:** retain owned shell lifecycle checks. The running/completed item ID/node/native-ref/ordinal/run equality is replay/persistence coverage, not duplicated assertions to drop. Last three lines are upstream context.
- **2948–3219 — PiAdapterV2.ts:** retain command-only filtering, bounded task map, completed-state deduplication, pending-work settlement, scoped cancellation escalation, instruction-mode validation/application/reset, and trusted settings. Apply web-patch2-04 only. Running and terminal card emissions differ in timestamps/status and ownership; no large safe shared-emitter saving established.
- **3220–3263 — piT3McpExtensionSource.ts:** retain schema return typing, Bruv early return AFTER permission-hook setup, and hidden host-only local notification tool. The remainder is existing upstream MCP code, not owned duplicate source savings.
- **3264–3303 — piT3McpInjection.test.ts:** retain scoped credential/env and no-competing-tools regression. Source-text assertion alone is limited proof, but deleting it is not a substantial reduction.
- **3304–3317 — piT3McpInjection.ts:** only added ownership comments; no executable removal.
- **3318–3359 — DelegatedCompletionDelivery.test.ts:** retain duplicate cancellation and cancelled/disposed durable projection checks. Different command IDs test repeated authority, not merely exact receipt replay.
- **3360–3390 — DelegatedCompletionWake.ts:** retain native execute/jobs.inspect versus generic task_status routing, including mixed/non-native fallback. It has real Orchestrator callers at patch:4881,5107,5349. Joining singular/plural text saves little and risks instructions changing; no worthwhile cut.
- **3391–3805 — LocalJobNotification.test.ts:** reuse setup (01), keep all receipt/concurrency/fence scenarios.
- **3806–4679 — NativeBruvIntegration.production.test.ts:** narrow helpers (02), imports (04), retain integration/evidence contract. Recomputed acceptance metadata is not dead: launcher consumes it. Finalizer release/owned PID/session checks and failure-state retention are not expendable diagnostics.
- **4680–5420 — Orchestrator.ts:** retain local-job ownership validation and no-wake durable receipt (5056–5098), persisted ancestor fence (5208–5257), deferred worktree start and workspace propagation (5266–5290), cancelled/disposed late-event suppression (5358–5361), completion text routing and cancellation command wiring. Investigate unused permit (05). Numerous expanded object/type literals are formatting-only changes over upstream; counting their minus/context lines as removable current Bruv code is invalid.
- **5421–5632 — ProviderSessionManager.test.ts:** retain injected adapter and terminal/disposed/forged rotation scenarios. Generic-to-restricted credential rotation is distinct from ordinary credential creation.
- **5633–5772 — ProviderSessionManager.ts:** consolidate the duplicated walk (03); retain trusted process source, logging/fail-closed behavior, exact credential authority equality/rotation and capability restriction.
- **5773–5784 — ThreadLaunchService.test.ts:** retain ...launches; it supplies newly required service methods around the deliberate lost-response fixture.
- **5785–5800 — ThreadLaunchService.ts:** retain preserveWorkspaceOnCancel contract/comment. Only beginning of next interface hunk is assigned. Additional reference read at 5801–5825 confirms this flag controls keeping owned workspace on cancellation; removing it risks loss of inspectable/retryable work. No whole-file verdict.

**Feature-cut assessment:** no high-net, small production feature cut was demonstrated safe. Retiring local shell cards would also affect pending-work pinning/settlement and Stop escalation; retiring native acceptance would remove required authority/replay/cancellation proof. Removing evidence generation breaks a current gate. None is recommended merely to meet a savings target.

## Checks and limits

Executed only read-only file/search operations, revision/object availability checks, pinned raw-source reads, and in-memory hunk matching/reference counting. No build/typecheck/test/provider/live calls. Future checks above are requirements, not results. Cross-range references are targeted evidence reads, not an exhaustive audit of other reviewers' assignments. Coverage exhaustiveness applies to the assigned interval, not every caller or runtime state.

Wisdom/values unchanged: this audit applies existing one-owner, honest-proof, cancellation and data-loss values; no new wisdom edit is needed or permitted by the output scope.
