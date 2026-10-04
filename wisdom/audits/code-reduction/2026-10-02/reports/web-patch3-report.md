# Maintained web patch, reviewer 3: code-reduction audit

## Completion and accounting

**Complete: all 2,698 inclusive assigned lines, patch 5801–8498, read sequentially in bounded numbered chunks.** This is the maintained production patch, not an experimental checkout. The first assigned line is inside ThreadLaunchService; its preceding header/interface was also read to establish ownership. Coverage JSON subdivides the assignment by target file and has no gaps.

Patch SHA-256: `c84fdee8b37133efe1a7fad8e3116f263fe0d6ca39fd162382a283a111946323`. In the assignment: **1,727 added lines, 95 minus lines, 601 context lines, 275 metadata lines**. Only owned added source/test lines enter estimates; never patch headers, already-deleted upstream code, context, or a second count of generated source. Lockfile lines are dependency metadata, not implementation savings.

Read wisdom/values.md and web-report.md in bounded follow-ups. Applied their authority, stopped-work recovery, truthful UI and bounded/no-loss principles. No production edits, builds, test execution, provider or Live calls. Only this report and its coverage JSON were written. No wisdom edits requested or needed.

**Actionable combined estimate: 99 gross owned lines replaced/deleted, 57–66 net lines saved**, including test changes. Production-only net: 32; test-only net: 25–34. These are proposals, not measured post-edit results. wp3-01/wp3-02 are coordinated to retain a meaningful executable-detector test. No large safe feature cut established.

## Trace quality

Canonical pin is upstream `66a91077f9abf6e171aad0ceab2519d7272f3ff3`. build/build.ts:49–94 applies bruv.patch then exact-source verification before install; 97–160 typechecks both graphs, bundles and deploys them, copies the preload and records patch provenance. No alternate source overlay was found in that build path. The default revision-keyed maintained checkout was absent and BRUV_T3_SOURCE unset. Existing Die-named checkout candidates had older revisions and were **not** treated as current source.

Read-only HTTPS retrieval of pinned upstream hostProcess.ts, NodePtyAdapter.test.ts and PiProvider.ts succeeded. A pinned upstream archive was decompressed and searched in memory (19,614 .ts/.tsx/.js/.mjs/.json entries; no checkout or archive written) for the five newly introduced helper/reference names. No upstream occurrence of HostProcessIsBun, withBunSelfExecEnvironment, withoutBunSelfExecEnvironment, isHostProcessExecutable or BunTerminalRuntimeRef was found. Canonical patch and root src/tests/integrations/scripts searches provide added-layer caller evidence. This is symbol-level tracing, not an exhaustive review of upstream.

## Findings

### wp3-01 — Delete uncalled self-exec helper scaffolding

**Exact patch/source:** patch **8233–8238** → `packages/shared/src/hostProcess.ts:73–78` (HostProcessIsBun); **8253–8272** → same source **92–111** (with/withoutBunSelfExecEnvironment). Related test import items **8196–8197** and dead-helper test **8206–8215** → `packages/shared/src/hostProcess.test.ts:5–6,15–24`.

**Evidence:** only definition/test occurrences in canonical added code; no occurrences in pinned upstream archive. The actual packaged interpreter marker is set directly at root `src/t3/web/launcher.ts:183–189`; shipped `integrations/t3/upstream/bootstrap.mjs:3` deletes process.env.BUN_BE_BUN before CLI/RPC/terminal children. These shared helpers are not on that boundary. HostProcessIsBun itself has no test or production reader.

**Counterevidence:** export names sound like essential runtime compatibility, and future consumers could use them; that does not establish current use. Do not remove the actual launcher/preload or lazy node:sea handling. No unpublished consumer was investigated; this is an internal patched workspace module, not demonstrated public compatibility policy.

**Confidence:** high. **Gross/net:** 26 production + 12 test = **38/38**; excludes adjacent blank lines. **Behavior lost:** only unused exported helpers/reference and tests of those helpers, not child environment sanitation. **Checks:** repeat full symbol search after regeneration; shared/server typechecks; packaged interpreter/RPC/terminal smoke and existing launcher process checks. Keep marker-scoping verification on the real shipped boundary, not a dead utility.

### wp3-02 — Inline a boolean identity wrapper, test the actual detector

**Exact patch/source:** **8240** (source hostProcess.ts:80) plus **8241** added separator; **8246–8249** → source **85–88**. Replace four-line isHostProcessExecutable({ isSea: ... }) call with:

`defaultValue: () => process.getBuiltinModule("node:sea")?.isSea() ?? false,`

Delete isHostProcessExecutable. Coordinate remaining `hostProcess.test.ts` imports/test after wp3-01 (patch **8192–8195,8198–8205,8216**).

**Evidence:** the wrapper returns input.isSea unchanged; only callers are that default and two true/false assertions. The existing test proves boolean identity, not missing-Bun-builtin behavior. Pinned upstream had direct NodeSea.isSea(); the lazy optional builtin replacement is essential, the identity wrapper is not.

**Counterevidence:** don't revert to eager node:sea import, treat all Bun hosts as Node SEA, or delete the detector's test coverage. Replace the residual test with a small actual-reference/default test under present/absent builtin and true/false SEA responses; restore any mocked builtin accessor. It must exercise the production detector.

**Confidence:** high on production equivalence; medium on final test LOC. **Gross/net:** production **6/5**; residual 13 test lines replaced by ~12–18 lines. Coordinated total **19 gross / 0–6 net**; wp3-01 plus wp3-02 totals 38–44 net, not double-counted. **Behavior lost:** none. **Checks:** shared typecheck; actual host-reference/default cases under Node/Bun-compatible missing builtin; packaged startup. Don't expand into a platform matrix.

### wp3-03 — Remove unused fake-PTY event plumbing and import

**Exact patch/source:** **6394,6402,6406,6413,6431–6432** → `apps/server/src/terminal/BunPtyAdapter.test.ts:9,17,21,28,46–47`.

Delete unused PtyAdapter namespace import, FakeState.emitData field, local emitData placeholder, state initializer and two assignments in fake spawn. Keep fake runtime.spawn, captured options and terminal.data option assertion.

**Evidence:** entire new test source (6386–6614) was read; no test accesses state.emitData. The field/local only feed each other. Real native cases instantiate the actual adapter and subscribe to actual output/exit, independently of fake state. The unused import has no reference elsewhere in the file.

**Counterevidence:** callback plumbing would become useful for a future synthetic data test, but none exists now. Do not remove the actual adapter's decoder, listener APIs or native output checks. No native-provider calls are required to validate this deletion.

**Confidence:** high. **Gross/net:** **6/6**, all test lines. **Behavior lost:** unused fake-only callback exposure, no assertion. **Checks:** typecheck and all BunPtyAdapter fake/native tests, retaining delayed input, resize and explicit kill cases.

### wp3-04 — Drop an unconsumed convenience re-export

**Exact patch/source:** **6834** → `apps/server/src/terminal/NodePtyAdapter.ts:310`: `export { BunTerminalRuntimeRef } from "./BunPtyAdapter.ts";`.

**Evidence:** the adapter already imports BunPtyAdapter directly at 6815 and reads its reference at 6823. No root or canonical-patch consumer imports the re-export; pinned upstream predates the symbol and had no occurrence. The direct export in BunPtyAdapter.ts:43–46 remains.

**Counterevidence:** the nearby comment intends injectable Node-PTY tests; those can import the reference from its owning module if needed. Pinned NodePtyAdapter.test.ts imports the Node adapter namespace but contains no new-symbol reference. Do not delete runtime selection/reference itself.

**Confidence:** high for repository callers. **Gross/net:** **1/1**. **Behavior lost:** unused alternate internal import location. **Checks:** full consumer search and server/test typecheck; ordinary Node-PTY tests and native Bun-PTY cases remain.

### wp3-05 — Table-drive two startup URL fixtures

**Exact patch/source:** **6258–6292** → `apps/server/src/serverRuntimeStartup.test.ts:20–54`, two fully added tests.

Use a local loop over true/false no-auth configurations, generating separate named it.effect tests. Share the web/loopback/port/devUrl object. Keep a no-auth issueStartupPairingUrl implementation that dies if invoked; the ordinary implementation returns paired:baseUrl. Assert direct URL versus pairing URL respectively. A plain local loop needs no new fixture framework or test-API assumptions.

**Evidence:** both generators, service provisioning objects and fixed address are identical except flag, pairing implementation and expected target. They execute the same production effect. Both branches must remain covered.

**Counterevidence:** a shared fake that always returns a URL would erase the strongest no-credentials negative; don't do that. Don't conflate desktop auth with loopback no-auth or weaken host/origin gates outside this test.

**Confidence:** high. **Gross:** **35**; replacement ~20–23, **net 12–15**. **Behavior lost:** none; separate named tests and negative preserved. **Checks:** patched serverRuntimeStartup suite and packaged ordinary/no-auth startup checks; source regeneration verification.

## Audited keep verdicts / rejected reductions

Every assigned hunk (including minus and context) was inspected. Table intervals cover all lines, including file/hunk metadata; only the first interval begins partway through a file diff. These are local reduction verdicts, not certification of all upstream behavior.

| Patch lines | Target source hunk path | Verdict / evidence |
|---|---|---|
| 5801–5853 | `apps/server/src/orchestration-v2/ThreadLaunchService.ts` | Keep reserved preparation ownership and workspace preservation; prepare/isPreparing have native callers. |
| 5854–5865 | `apps/server/src/orchestration-v2/ThreadManagementService.ts` | Keep parent authority routing for durable cancellation. |
| 5866–5877 | `apps/server/src/orchestration-v2/testkit/OrchestratorScenario.ts` | Keep cancellation scenario thread routing consistent with production. |
| 5878–5912 | `apps/server/src/orchestration-v2/testkit/ProviderReplayHarness.ts` | Keep injectable real MCP registry/configureMcp; tests need both live-MCP and isolated modes. |
| 5913–5964 | `apps/server/src/provider/BruvWebPi.test.ts` | Keep built-in identity positives/negatives and settings replacement proof. |
| 5965–5999 | `apps/server/src/provider/BruvWebPi.ts` | Keep operator-owned binary identity; it gates native delegation authority, not just display. |
| 6000–6052 | `apps/server/src/provider/Drivers/PiDriver.ts` | Keep executable replacement, enablement and separate Bruv update/version domain. |
| 6053–6068 | `apps/server/src/provider/Layers/PiProvider.test.ts` | Keep fallback display/mode assertions. |
| 6069–6172 | `apps/server/src/provider/Layers/PiProvider.ts` | Keep fallback mode descriptors, exact-binary version-floor exception, and ordinary-Pi error path. |
| 6173–6225 | `apps/server/src/provider/providerCompatibility.test.ts` | Keep stale advisory clearing, custom-instance negative and environment restoration. |
| 6226–6245 | `apps/server/src/provider/providerCompatibility.ts` | Keep trusted built-in-only advisory exception. |
| 6246–6296 | `apps/server/src/serverRuntimeStartup.test.ts` | Share two startup fixtures without dropping no-credentials negative or ordinary pairing. wp3-05 |
| 6297–6379 | `apps/server/src/serverRuntimeStartup.ts` | Keep finite port, Bruv model/mode seed and no-auth startup/headless behavior. |
| 6380–6614 | `apps/server/src/terminal/BunPtyAdapter.test.ts` | Remove unused import/fake event plumbing; keep all fake contract and native PTY cases. wp3-03 |
| 6615–6806 | `apps/server/src/terminal/BunPtyAdapter.ts` | Keep native PTY ownership, decoder flushing, pre-spawn/first-listener buffering and exit replay. |
| 6807–6834 | `apps/server/src/terminal/NodePtyAdapter.ts` | Keep Bun selection and Node fallback; remove unused re-export only. wp3-04 |
| 6835–7007 | `apps/server/src/terminal/SubscriberStream.test.ts` | Keep healthy-versus-slow isolation, ordered accepted events, byte overflow and repeated cleanup. |
| 7008–7157 | `apps/server/src/terminal/SubscriberStream.ts` | Keep nonblocking bounded event/byte retention, visible overflow and once-only cleanup. |
| 7158–7200 | `apps/server/src/workspace/WorkspaceSearchIndex.ts` | Keep lazy native dependency load and explicit Android unavailability. |
| 7201–7248 | `apps/server/src/ws.ts` | Keep cancellation parent mapping and bounded terminal stream adapters. |
| 7249–7345 | `apps/web/src/components/ComposerPromptEditorTiptap.test.tsx` | Keep actual unavailable view regression in both rich-text modes and deferred selection. |
| 7346–7361 | `apps/web/src/components/ComposerPromptEditorTiptap.tsx` | Keep retired-editor guard before marking initial selection applied. |
| 7362–7400 | `apps/web/src/components/ThreadRouteView.tsx` | Keep live-shell render-state input; do not reintroduce cached-snapshot redirects. |
| 7401–7435 | `apps/web/src/components/clerk/BrowserManagedAuthShell.test.tsx` | Keep provider/key/children wiring test; not evidence that auth is unused. |
| 7436–7514 | `apps/web/src/composerDraftStore.test.ts` | Keep resumed versus new draft, explicit override and persisted sticky-selection coverage. |
| 7515–7565 | `apps/web/src/composerDraftStore.ts` | Keep finite JSON persistence schemas; no removable implementation introduced here. |
| 7566–7617 | `apps/web/src/hooks/useHandleNewThread.ts` | Keep explicit project/composer intent classification; resumed model is not new intent. |
| 7618–7680 | `apps/web/src/lib/chatThreadActions.test.ts` | Keep independent resumed-model/environment-default negatives and explicit positives. |
| 7681–7710 | `apps/web/src/lib/chatThreadActions.ts` | Keep explicit-intent precedence and same-draft guard; already small. |
| 7711–7725 | `apps/web/src/main.tsx` | Keep browser-only dynamic auth import; removed Electron branch is already minus code. |
| 7726–7800 | `apps/web/src/threadRoutes.test.ts` | Keep non-live-shell states versus authoritative missing/deleted routing. |
| 7801–7827 | `apps/web/src/threadRoutes.ts` | Keep live-only absence authority. |
| 7828–7902 | `packages/contracts/src/orchestrationV2.ts` | Keep durable workspace/request inputs, notification lineage and post-settlement cancellation. |
| 7903–7998 | `packages/contracts/src/orchestratorMcp.test.ts` | Keep versioned wire shape and invalid launch cases; timeout acceptance is schema, not runtime support. |
| 7999–8134 | `packages/contracts/src/orchestratorMcp.ts` | Keep bounded/versioned wire and ACK schemas; duplicate names are independent tool entrypoints. |
| 8135–8152 | `packages/contracts/src/providerRuntime.ts` | Keep optional reported per-turn costs; not a duplicate accounting implementation. |
| 8153–8185 | `packages/contracts/src/settings.ts` | Keep enabled Bruv binary defaults and settings annotations. |
| 8186–8216 | `packages/shared/src/hostProcess.test.ts` | Remove dead helper tests; replace passthrough assertions with actual executable detector checks. wp3-01,wp3-02 |
| 8217–8276 | `packages/shared/src/hostProcess.ts` | Remove uncalled Bun environment helpers/reference and inline identity-only wrapper; keep lazy SEA detector. wp3-01,wp3-02 |
| 8277–8297 | `packages/shared/src/t3McpToolPresentation.ts` | Keep native tool display verbs; upstream definitions are context, not owned duplication. |
| 8298–8478 | `pnpm-lock.yaml` | Keep generated injected workspace dependency closure; no handwritten source savings claimed. |
| 8479–8498 | `pnpm-workspace.yaml` | Keep deploy injection and cross-platform optional native asset selection. |

### Why the tempting larger cuts are not recommended

- **Preparation/cancellation:** native resultFor uses isPreparing at patch 1636–1638 to distinguish active preparation from uncertainty; native launch calls prepare at 1941 and sets preserveWorkspaceOnCancel at 1956. The guarded cleanup at 5817–5822 protects delegated worktree inspection/retry. Parent-thread command routing at 5862,5874,7217 and durable cancellation schema at 7891–7899 preserve authority after run settlement. These aren't dead alternate lifecycle paths.
- **Authority versus compatibility:** isTrustedBruvProviderInstance gates provider-native authority at 5662 as well as advisory clearing at 6242. PiProvider's exact configured-binary version exception (6154–6157) and PiDriver's update suppression (6038–6040) are different boundaries; merging them by presentation name/environment alone is unsafe. Retain custom-instance negatives.
- **PTY buffers/cleanup:** earlyData (6757,6769,6792) spans spawn-before-wrapper, pendingData/hasHadDataListener (6689–6690,6719–6721,6738–6741) spans wrapper-before-first-subscription. They are adjacent timing protections, not independently removable duplicate queues. Stream TextDecoder flush, exit replay and terminal.close prevent output/handle loss. A larger class reconstruction would need proof and did not establish positive net savings.
- **Terminal queue:** bounded subscriber queue and downstream output ACK window solve different pileup points. Keep event and serialized-byte caps, dropping-offer failure, accepted-event delivery, explicit overflow and unsubscribe-once. Subscribe may emit synchronously before it returns the disposer (7136 handles that); acquireRelease later may also finalize it. The two once guards protect different releases; deleting them is not an evidenced simplification.
- **Frontend persistence/routing:** only live shell establishes absence (7822–7824). Cached snapshots cannot justify navigation away. Editor view availability guard must precede consuming initial selection. Explicit model intent, historical resumed model and sticky new-thread defaults are distinct; don't delete persisted choices or substitute environment defaults for explicit intent.
- **Schemas:** workspace input, durable workspace replay metadata and observed workspace status are different representations. requestKey/requestedBaseRef/requestedBranch must survive replay, not be recomputed from current Git. Root Zod versus backend Effect schemas have independently enforced trust boundaries. Identical observe/cancel shape could be aliased but replacing one one-line Struct with one one-line alias saves no implementation lines; keep distinct entrypoint names.
- **Reserved timeout feature cut:** removing timeoutMs from the schema could remove ~12 added lines at 8052–8061 plus a couple fixture lines, but raw-field allowlisting/rejection elsewhere is essential (1791–1794,2696). Default decoding can discard extra fields; a deleted schema field must never turn unsupported deadlines into silently launched work. No large net saving, no cut proposed.
- **Auth cut:** browser-auth wiring test is 29 owned lines, but auth implementation is upstream/context and supports configured cloud users. Browser-only import already removes the Electron branch (7719–7721 are minus lines). Claiming large implementation savings from that context/deleted branch would be false; no auth feature cut proposed.
- **Dependency metadata:** lock snapshots include Clerk Electron/mobile entries because pnpm injection/deploy resolves workspace peer contexts. Manual removal is not a source-code reduction; rerun the frozen resolver after any approved dependency change. Android/lazy fff handling avoids startup failure; broader supportedArchitectures requests packaging assets, not speculative fallback implementation. No generated-lock savings counted.
- **Formatting-only churn:** the two reflowed annotation descriptions (8008–8010 and 8129–8131) could make a smaller textual patch but normal formatting restores them. Not a maintained-code reduction proposal.

## Checks and limits

Executed only reads, symbol searches, source/revision inspection, read-only upstream retrieval, accounting and coverage validation. **No implementation tests, typechecks, build, source regeneration, paid-provider or browser/live acceptance ran.** Each finding names focused checks for implementation time; packaging/native tests can have platform requirements. Full range reading is complete even though runtime validation is intentionally not performed. Broader patch lines 1–5800 remain the other reviewers' responsibility, not claimed reviewed here (only named caller/header excerpts were read).
