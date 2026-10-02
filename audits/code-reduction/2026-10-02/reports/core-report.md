# Core code-reduction audit

## Overview

Read **all 45 assigned files, all 11,545 lines**, in numbered, bounded chunks. Coverage is complete, not sampled. This was read-only research: no production, test, config, prompt, or wisdom changes; no build, suite, provider, or Live launch. Only this report and its coverage JSON were written.

Most complexity here protects durable history, human authority, billing, or one-owner delivery. The best behavior-preserving reduction is to retire an obsolete compaction test implementation and no-op integration state, not flatten those boundaries. Findings core-01–06 offer approximately **150–200 net owned-source lines**, plus **13–38 net test lines** after migrating assertions. Estimates are physical lines, gross means existing lines removed, net subtracts replacement code. Those six findings have disjoint removal scopes. Optional feature cuts are separate, not approved or included in this total. No Markdown/docs/wisdom deletion savings are counted.

Context: read wisdom/values.md completely; consulted relevant diagnostic, disk-history, native-fast and compaction-incident notes. Current code wins where those notes mention older Pi versions. Package is private with no exports map; repository source/CLI/build/test/script consumers were traced with rg. Absence of imports alone was never used to classify an entry point or asset as dead.

## Ranked actionable findings

### core-01 — Retire the captured-context compaction implementation used only by tests
**Behavior-preserving refactor; high confidence on reachability, medium on final test savings.**

- **Evidence:** src/agent/cache-affine-compaction.ts:268–316 explicitly says this builder is compatibility-only. Its sole repository calls are tests/cache-affine-compaction.test.ts:106–194,513,523. The real handler calls prepareCurrentConversation at :488 and prepareCacheAffineRequest at :542; it builds current branch history and runs actual transforms at :62–165. The helper instead reconstructs a previous prefix and rejects transformed message boundaries/raw tails, a different implementation of a job production no longer performs.
- **Remove/refactor:** move the meaningful request-shape/budget/focus assertions onto the live preparer or production handler, then delete buildCacheAffineRequest. Delete production Snapshot.messages (:22–23,:414) and leafId (:26,:417,:454), which then have no consumers. Snapshot.headers (:31,:421,:426–428) already has no reading consumer at all; remove that unnecessary header retention too, but preserve providerPayload and its affinity diagnostic (:618–621,:698). Change tests to import canonical instruction-continuity bindings, removing re-export-only scaffolding at :53–60 and the old alias at src/agent/instruction-continuity.ts:120–121.
- **Counterevidence:** tests genuinely exercise frame budgeting, whole-history summarization, literal custom focus, and overflow. They must be migrated, not blindly deleted. tests/cache-affine-compaction.test.ts:146–168 specifically tests obsolete stale-prefix/raw-tail restrictions; those restrictions are not live behavior. The production lifecycle fixture at :281–350 already captures real request framing; SDK checks also exist in tests/cache-affine-compaction-sdk.test.ts:38. Export removal would affect an undocumented external source embedder, if one exists; no shipped exports API or in-repository caller establishes that obligation.
- **Savings:** owned source GROSS **65–80**, NET **60–75**; targeted tests GROSS **50–95**, NET **10–35** after replacement assertions. Do not count deleting the entire 569-line test file. **Behavior lost:** only the obsolete test/source-helper API and unused captured bytes, not current compaction behavior.
- **Checks:** preserve production assertions for current tool results, context rewrites/redaction, transformed growth, one frame charge, low reserve/overflow, fresh versus already-framed sessions, literal dollar/template focus, standard-tier scope, paid failure/abort, and independent manager identity. Run focused cache-affine unit/SDK tests and instruction-continuity tests offline after an implementation.

### core-02 — Delete the no-op wisdom job lifecycle and its command-only context cache
**Safe removal; high confidence. This is executable wiring cleanup, not wisdom/docs cleanup.**

- src/wisdom/extension.ts:8–10,49 defines a runtime whose only method is async no-op jobsChanged. src/agent/extension.ts:440–454 maintains runtime state and invokes that no-op twice with Promise reconciliation; :524 invokes it at every job completion; :655 stores its return solely for this path. tests/wisdom-extension.test.ts:71–73 explicitly locks in the no-op.
- Register the extension for its actual command/prompt hooks without a return runtime. Its currentContext and notify closure (:21–23) serve only /wisdom, which already receives ctx (:27–31). Notify directly through that ctx; remove assignments and the now-unnecessary session_start/shutdown hooks (:28,:35–40,:42).
- **Counterevidence:** rootAllowed's fail-closed behavior and before_agent_start guidance (:12–18,:41–47) are live and must stay. Preserve the root-only command and exact guidance text. **Behavior lost:** none except the inert returned integration API. Owned source GROSS **32–39**, NET **27–33**; the no-op test contributes exactly **3 gross / 3 net** additional lines.
- **Checks:** wisdom root/child guidance and root-only command tests, plus job-completion regression to show dispatch is unchanged. No new reconciliation test is needed for a removed no-op.

### core-03 — Use the canonical Question view instead of fixture-shaped compatibility
**Behavior-preserving internal refactor; high confidence for the shipped consumer.**

- src/questions/extension.ts:9–28 duplicates an all-optional Question shape with an extra question alias. records (:36–44) accepts three object envelopes plus arrays, and render/inbox/completion paths repeat text ?? question (:64,:166,:172,:213,:217).
- There is one production registration: src/agent/extension.ts:560 supplies questions.commands. That runtime returns service.list arrays / get records via src/questions/runtime.ts:264–326 and src/questions/service.ts:199–215,525–544. The service's canonical shape (:31–54) requires text. The older question field is visible in tests/questions-extension.test.ts:10; it is a mock compatibility contract, not a production ledger version.
- Import the canonical type (or a small Partial<Question> & Pick<Question, "id"> test/view type), retain a single array assertion boundary if the command port still returns unknown, and remove object-envelope/field-alias paths. Tighten fake fixtures to the actual contract. **Counterevidence:** optional fields and unknown port results currently let small mocks omit ownership metadata; do not force every UI-only test to fabricate full durable records. Keep malformed-ledger error handling, stale context handling, owner/version checks and all narrow-screen interaction tests.
- **Savings:** GROSS **29–40**, NET **22–27**, no test deletion counted. **Behavior lost:** unsupported injected service envelopes/field aliases, not persisted service records or human controls. Check inbox/filter/detail/answer/cancel/resume, saved-versus-delivered labels, stale-open question, remote mirror and corrupt-ledger cases.

### core-04 — Remove native-fast evidence state that cannot vary
**Safe state/signature removal; high confidence.**

- src/agent/native-fast-mode.ts:98 defines FastEvidence as the sole literal requested. statusText (:225–227) ignores its argument. evidence (:394) is only reset to that same literal at :618,:630,:639 and passed at :479,:498. Remove the type, variable, resets, and ignored parameter while preserving the honest requested/unavailable wording.
- withStandardProviderTier (:79–84) accepts an unused owner solely for source compatibility; AsyncLocalStorage is the actual request-local owner. Update its two tests (tests/native-fast-mode.test.ts:259,263) and src/agent/cache-affine-compaction.ts:612 to pass only run. RequestAuthorization.sessionId (:230) is emitted at :402,:415,:426,:449 but never consumed; the real session match is checked before capture (:396–399). Remove that redundant payload field, not the actual match or durable Setting.sessionId (:91).
- **Counterevidence:** enabled/costAcknowledged, branch/model/auth consent, volatile opt-out on persistence failure, and final payload identity/tier checks are essential, even if some values appear correlated. Do not replace request-local ALS with a mutable session boolean. **Savings:** GROSS **22–28**, NET **12–18**. **Behavior lost:** inert source signatures only. Check /fast status/on/off, cost consent, scope changes during auth, overlapping standard compaction versus premium ordinary request, and malformed/failing persistence tests.

### core-05 — Remove proved identity wrappers, not real failure boundaries
**Safe removal; high confidence.**

Disjoint small sites:
- src/session/host.ts:271,282–285 wraps dispatch in catch(error) { throw error }, with no cleanup or conversion. Remove it; snapshot ownership/branch checks and immutable snapshot retention remain.
- src/agent/native-compaction.ts:413–418 catches a synchronous fetch throw only to rethrow it. Directly assign the fetch result; onDispatch still occurs only after fetch returns (:419). A sync throw still propagates and must still not count as observed dispatch.
- src/history/session-manager.ts:199,215,399–403,553–554 saves/reinstalls unchanged inMemory and getSessionName implementations. Keep the explanation that name lives in skeleton metadata, but let the original methods remain installed. No alternate body or interception policy exists in these wrappers.
- src/agent/extension.ts:435–436 and :985 call an empty attention dispose method; the shared batch is already disposed by completions at :983/:419. Delete only that empty method/call.
- src/agent/cache-affine-compaction.ts:724 selects provider_failed in both payloadAccepted arms; simplify the expression without changing dispatch classification (:727).

**Counterevidence:** leave finally cleanup, partial append rollback, observer exception containment, billing checkpoint attempts, and request-capacity tombstones intact. GROSS **23–29**, NET **17–22**. **Behavior lost:** none. Check sync-fetch failure produces no dispatch observation, host failure retains shared snapshots, SDK session-name/inMemory parity, and shared batch shutdown behavior.

### core-06 — Share the three identical leaf-restoration helpers
**Behavior-preserving refactor; high confidence, modest payoff.**

src/agent/manual-shake.ts:48–57, src/agent/native-compaction.ts:574–583 and src/agent/native-fast-mode.ts:16–25 implement the same undefined/no-op, null/resetLeaf, string/branch, swallow-original-failure-preserving algorithm. Put that exact algorithm in one small session utility; keep their call sites and distinct diagnostic/transaction wrappers. GROSS **30–34**, NET **15–21** after utility/imports. **Behavior lost:** none.

**Counterevidence/security boundary:** src/diagnostics-extension.ts:29–55 is NOT equivalent: it probes whether restoration is possible before an optional append. Do not merge away that preflight. Nor should restoration failure authorize another provider request or resurrect old state. Check all three features' append/diagnostic failure cases with absent leaf, null leaf, string leaf and throwing restore. These cases belong in existing targeted tests, not a new broad matrix.

## Feature cuts requiring human choice

### core-07 — Drop the optional Herdr pane integration
**Feature cut, not dead code; high confidence on boundary/savings.**

src/herdr-agent-state.ts:1–410 is isolated reporting for HERDR_ENV/pane/socket and root TUI identity (:52–75,:119–126). It maintains pane ownership, queue coalescing, transport retry/timeouts and quit release (:238–401). It is dynamically loaded by src/cli.ts:210–220 and registered at :277; src/agent/extension.ts:274 sends task counts. This proves use despite no static application import. Remove this entire integration and those wiring lines only if Herdr users do not need pane working/blocked/idle state, session links or quit release. Normal Bruv task status at extension :275 remains.

Owned GROSS **415–420**, NET **410–420**; tests/herdr-agent-state.test.ts has 581 lines but its deletion is **not included** because it was not reviewed in full. Keep core diagnostics, task execution and cancellation. Check startup/help/root-child gating and task footer without Herdr. No provider/voice acceptance needed; actual Herdr acceptance would intentionally cease to exist.

### core-08 — Remove persistent autonomous goal mode
**Feature cut; high confidence on implementation boundary, medium on total cross-subsystem savings.**

The four owned goal files total **731 lines**: controller, extension, store, types. This is real product behavior: /goal parser/control at src/goals/extension.ts:155–184, model context at :197–217, owned-job waiting at :138–153,:248–258, bounded automatic progress at controller :29–48 and continuation at extension :276–299. It is not ordinary jobs completion, questions, or prompt continuity.

Cut registration/wait callbacks/goal dispatch at src/agent/extension.ts:439,490,562–579,677 and sample preview at src/prompt-preview.ts:20,33–34,99–107,209. Trace and remove goal bridge surface at src/typescript/job-bridge.ts:369–372 and its schemas/declarations with the owning reviewer. Existing bruv-goal entries should remain immutable history, simply no longer drive turns; do not rewrite journals or question ledgers.

Owned GROSS **765–775**, NET **750–775**. External helper/test savings are not counted. **Behavior lost:** /goal, goal.* tools, saved objectives/progress and self-continuation/no-progress pause. No human approval or persistent question feature is removed. Keep question dispatch claims and foreground stop even if the goal-specific hasBlockingQuestions caller goes away. Check ordinary print/JSON job completion, user interruption, questions replies and offline prompt-preview after removing goal options. Goal tests are feature tests, but do not erase mixed job/question regression coverage with them.

### core-09 — Drop the informational provider-cache TTL estimate
**Feature cut; high confidence on owned code, medium on footer integration savings.**

src/agent/cache-countdown.ts:1–389 implements settings, duration parsing, persisted per-model observations, conservative HTTP/terminal correlation and /cache-ttl. It explicitly cannot guarantee cache hits (:104–108). The complexity at :192–258,:293–356 exists to make a non-authoritative badge truthful, not to perform compaction. src/ui/footer.ts:500–531 adds a render timer/subscription solely for this badge. src/agent/extension.ts:113–115 registers it and :260 invalidates it after shake.

Remove the badge/settings/command and countdown implementation if that informational feature is not worth its maintenance. subscribeProviderAttempts has only countdown as its production subscriber (src/agent/cache-countdown.ts:267); the subscription/listener dispatch can then be removed from src/agent/provider-attempts.ts:19–30,49–62. **Keep** reportProviderAttempt's diagnostic record (:42–48) and src/agent/native-compaction.ts:596–604,909; dispatch evidence is not equivalent to successful response or billing.

Owned GROSS **420–435**, NET **410–430**; footer **approximately 35–55 additional net lines**, subject to its owner's integration review, not part of owned total. Countdown test-file deletion is not counted. **Behavior lost:** cache estimate badge, /cache-ttl and restored estimates; no compaction/cache-affinity request policy. Leave saved cache entries/settings untouched. Check footer redraw/disposal, shake invalidation and native provider diagnostics; do not delete native-compaction observer-evidence assertions merely because the subscriber changed.

## Keep rationale and essential boundaries

- **History:** src/history/disk-entry-store.ts:365–433 preserves partial-write/publication rollback; :124–159 atomically rewrites rather than overwriting valid originals. src/history/session-manager.ts:123–137 preserves prior active state on failures; :252–269 distinguishes metadata skeletons from originals. src/history/service.ts:71–161 is intentionally a different parser: strictly read-only cross-session retrieval must NOT use a persistent open path that migrates/repairs (:259–285 of disk-entry-store). Keep explicit cross-session permission (:345–361), cursor ancestry (:364–370) and durable shake exclusions (:174–188). Old-session migrations at disk-entry-store :161–198 are actually invoked by session-manager :181–184,:577–579, not unused compatibility.
- **Native compaction/shake:** native-compaction :745–828 allows plaintext fall-through only before an opaque checkpoint exists and before unsafe native dispatch. :648–702 blocks incompatible/lost opaque state, :447–483 proves discarded coverage, :948–979 avoids a second paid inference. manual-shake :288–428 preserves uncertain/redacted protocol groups; :730–769 guards carry-forward failure. The circular import between shake and native compaction represents real replay/projection collaboration; deleting one side by import count would break persisted context.
- **Billing and human authority:** native-fast :552–588 keeps consent and stale identity checks, :285–360 enforces request-local final payload authorization. questions/service :161–198,:299–321 protects original branch/version; runtime :74–104 saves a dispatch claim before triggering a turn and refuses blind replay. host :296–334 requires trusted stop confirmation; input :28–40 tombstones and consumes before dispatch. Keep these, not guessed transcript-based authority.
- **Ownership/delivery:** job-delivery :47–75 preserves delivery metadata across local cancellation; task callers exist in src/tasks/task-manager.ts:490, src/tasks/foreground-stop.ts:19 and src/typescript/extension.ts:147. agent/extension :307–404 and :729–867 have different Live/T3/CLI completion ownership and durable outboxes, not interchangeable fallback wrappers. delegation-environment :5–22 is used by job-service and execute child environments and must continue scrubbing credentials/root authority.
- **Diagnostics:** diagnostics :165–208 is a strict metadata/privacy boundary, :216–256 prevents optional observers from changing inference, :270–345 bounds durable replay. A passing record does not establish billing or completion. Keep attach generation and diagnostic leaf isolation. Removing all best-effort catches is not a safe simplification.
- **Entrypoints/assets:** scripts/build.ts:46 compiles src/cli.ts; CLI dynamically loads web, internal remote owners/control, source-host check, disk manager, tasks, Live and Herdr. Embedded paths in CLI :8–15,:103–135 and WASM import at src/typescript/images.ts:4 require the declaration files. src/pi-host.ts:21–31 intentionally rejects incomplete prepared dependencies. src/update.ts:44–53,83–91,111–138 preserves compiled-only update, official URL/checksum and same-executable atomic replacement.
- **Small wrappers worth keeping:** tool-schema converts a real Zod/Pi type boundary; host-access bridges distinct extension API wrappers on the shared bus; sessionIdentity provides nonpersistent attribution without fake writes; output-buffer avoids whole-log copies and reports loss. prompt-preview is used by package script prompt:preview and scripts/probe-live-recorded.ts, probe-live-controlled.ts and probe-live-capability.ts, not dead debug code. workingValues/diagnosticRecords/UPDATE_ASSET have actual prompt/diagnostic/update-fixture users; moving their tiny wrappers to tests is not a material net reduction on present evidence.

### Per-file verdict (all assigned lines reviewed)

| File | Lines read | Verdict | Findings |
|---|---:|---|---|
| src/agent/cache-affine-compaction.ts | 1–747 | Refactor legacy test-only builder/capture; keep live preparation, budget and no-double-inference guards. | core-01, core-05 |
| src/agent/cache-countdown.ts | 1–389 | Keep if estimate remains a product feature; optional whole-feature cut. | core-09 |
| src/agent/extension.ts | 1–998 | Keep composition/ownership/delivery; remove obsolete wisdom and empty attention hooks. | core-02, core-05, core-07, core-08, core-09 |
| src/agent/instruction-continuity.ts | 1–169 | Keep manager-scoped framing/private-seam gate; retire old binding alias. | core-01 |
| src/agent/instruction-mode.ts | 1–142 | Keep authoritative branch mode and append-before-frame-update ordering. | — |
| src/agent/last-used-cli-model.ts | 1–68 | Keep explicit root-TUI-only defaults; restore/worker events must not overwrite human defaults. | — |
| src/agent/manual-shake.ts | 1–895 | Keep exact paired projection, carry-forward and request guard; share leaf restoration only. | core-06 |
| src/agent/native-compaction.ts | 1–997 | Keep opaque replay/coverage, credentials and billable accounting; simplify rethrow/share leaf helper. | core-05, core-06 |
| src/agent/native-fast-mode.ts | 1–650 | Keep consent/request-local guard; remove constant evidence/unused authority payload fields and old owner parameter. | core-04, core-06 |
| src/agent/provider-attempts.ts | 1–63 | Keep diagnostic evidence reporting; observer bus can go only with countdown cut. | core-09 |
| src/assets.d.ts | 1–14 | Keep compile-time declarations for embedded PNG/vendor JS/WASM, not dead executable code. | — |
| src/cli.ts | 1–288 | Keep executable/dynamic dispatch and immutable asset extraction; optional Herdr removal only. | core-07 |
| src/delegation-environment.ts | 1–22 | Keep credential/presentation-authority scrubbing and child checkpoint isolation. | — |
| src/diagnostics-extension.ts | 1–116 | Keep restorable-leaf preflight, captured owner and bounded metadata view. | — |
| src/diagnostics.ts | 1–350 | Keep privacy allowlist, generation, bounded ring/replay and observer failure containment. | — |
| src/goals/controller.ts | 1–63 | Keep no-progress accounting if goal continuation retained; optional feature cut. | core-08 |
| src/goals/extension.ts | 1–355 | Keep continuation epochs/wait ownership/question blocking if goals retained; optional cut. | core-08 |
| src/goals/store.ts | 1–269 | Keep append-first persistence, corrupt-marker authority and progress bounds if goals retained. | core-08 |
| src/goals/types.ts | 1–44 | Keep shared goal wire contracts if goals retained. | core-08 |
| src/herdr-agent-state.ts | 1–410 | Live optional integration, not dead; cut only by human product choice. | core-07 |
| src/history/disk-entry-store.ts | 1–530 | Keep streaming index, serialized LRU, atomic rewrites and append rollback; migration is real compatibility. | — |
| src/history/service.ts | 1–440 | Keep branch/cursor provenance, explicit cross-session permission, read-only parser and shake exclusions. | — |
| src/history/session-manager.ts | 1–608 | Keep disk-backed projection and recovery; remove identity-only SDK reassignments. | core-05 |
| src/history/shake-record.ts | 1–57 | Keep strict bounded persisted projection validation and fail-closed error. | — |
| src/history/types.ts | 1–35 | Keep small shared original-history provenance/result contract. | — |
| src/job-delivery.ts | 1–81 | Keep cancellation versus response ACK and durable execute-call identity separation. | — |
| src/output-buffer.ts | 1–136 | Keep bounded byte FIFO, owned slices and explicit loss offsets; no simpler equivalent demonstrated. | — |
| src/pi-host.ts | 1–32 | Keep prepared pinned-host gate; a private import is not unused when source CLI loads dynamically. | — |
| src/prompt-preview.ts | 1–234 | Keep offline production-hook preview used by scripts/probes; remove sample goal only with goals cut. | core-08 |
| src/prompts.ts | 1–75 | Keep embedded guidance/owned-mode markers; exports used by runtime and prompt tests. | — |
| src/prompts/markdown.d.ts | 1–4 | Keep text-import declaration for compiled prompt assets. | — |
| src/questions/extension.ts | 1–369 | Refactor loose duplicate view/legacy shapes; keep human inbox and truthful delivery statuses. | core-03 |
| src/questions/picker.ts | 1–126 | Keep searchable/scrollable narrow-screen human controls, not an unused wrapper. | — |
| src/questions/runtime.ts | 1–331 | Keep new-turn scheduling, durable dispatch claim and no guessed tool/voice answers. | — |
| src/questions/service.ts | 1–562 | Keep durable branch ownership/CAS/remote-human authority; canonical type should serve UI. | core-03 |
| src/session/host-access.ts | 1–30 | Keep event-bus bridge across distinct extension API wrappers; not duplicate host state. | — |
| src/session/host.ts | 1–448 | Keep request tombstones, trusted stop and branch-only bounded transcript snapshots; remove inert rethrow. | core-05 |
| src/session/identity.ts | 1–18 | Keep stable ephemeral attribution without writing a fake transcript. | — |
| src/session/input.ts | 1–42 | Keep completed-input expiry, single-use consume and attempted-ID tombstones. | — |
| src/session/operations.ts | 1–19 | Keep shared session/input adapter contract; optional delegate reflects concrete capabilities. | — |
| src/session/transcript.ts | 1–63 | Keep received-text versus heard-audio status and durable bounded chunks/viewport. | — |
| src/system-prompt.ts | 1–42 | Keep explicit/project/global override precedence and trust flag boundary. | — |
| src/tool-schema.ts | 1–17 | Keep one real Zod-to-Pi JSON Schema type boundary; tiny useful wrapper. | — |
| src/update.ts | 1–147 | Keep compiled-only official/checksummed atomic self-update and concurrent-change detection. | — |
| src/wisdom/extension.ts | 1–50 | Remove obsolete runtime hook and command-only cached context; retain wisdom guidance/command intact. | core-02 |

## Gaps / next validation

- No assigned-file reading gaps. Every file's numbered lines were read; large files were continued at the next unread line. Initial oversized previews were not treated as complete review; missing assigned content was reread in smaller chunks. Coverage JSON uses linesRead as the exact number of physical lines.
- External tests/scripts/build consumers were traced and selected relevant ranges read, not exhaustively audited. Large Herdr/goals/countdown test-file removal savings are deliberately excluded. External footer and goal-bridge changes need their owning audit group's review; do not add this report's external estimates to theirs twice.
- No execution acceptance claimed. No full build, generated-asset preparation, paid/provider or Live system was launched, and no test suite ran. Each finding lists focused post-change checks. A repository rg result cannot rule out private external source embedders; confirm only if those contracts actually matter rather than preserving unused APIs speculatively.
- The feature-cut totals are alternatives requiring human choice. If combining cuts with refactors, recompute by deleted ranges: core-07/core-08/core-09 remove their own wiring; none authorizes deleting shared task, question, history or diagnostic code. Do not count wholesale tests/docs on top of unreviewed feature savings.
