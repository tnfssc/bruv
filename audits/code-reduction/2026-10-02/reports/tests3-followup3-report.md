# Tests3 follow-up3 — read-only code reduction audit

## Coverage and limits

**Complete: 3,260 / 3,260 assigned lines, six files.** Every assigned line was read in numbered chunks, normally 60 lines, with shorter final chunks. Initial oversized reads were superseded by bounded reads; no assigned range relies on a truncated preview. Manifest lengths were checked against the current files. Read all of wisdom/values.md. This report supplements, rather than replaces, tests3-report.md's coverage.

Only this report and tests3-followup3-coverage.json were written. No source edits, commits, builds, test runs, device sessions, provider calls, or paid tests. Repository searches and selected production-owner reads support the findings; those are **not** claims of exhaustive production-file review. Existing untracked wisdom/quality/code-reduction-audit-2026-10-02.md was left alone. No wisdom/values edits: this is a code audit, not a documentation cleanup.

Savings below are physical lines, including explicitly identified separator lines. Gross means old lines removed/replaced; net subtracts replacement/helper lines. Small exact deletions and larger unimplemented estimates are distinguished. No runtime speedup is claimed.

## Findings

### F3-01 — Reuse the already-existing Codex token fixture

- **Evidence:** tests/native-fast-mode.test.ts:111–115 defines CODEX_TOKEN, used at :128. The identical token construction is repeated at :314–320 and :383–389, with local uses at :330 and :399. Each repeated construction is seven lines because of wrapping.
- **Change:** delete both local token declarations and change those two apiKey values to CODEX_TOKEN. No new helper.
- **Gross/net:** **14 / 14 lines**, exact. Confidence **high**.
- **Behavior lost:** none; identical fake account/token bytes. No real credential consolidation.
- **Counterevidence/keep:** :309–346 and :348–410 are not redundant tests: one exercises compressed SSE body/settings, the other WebSocket response.create frames. Preserve both, normalizeContext, transport selection, assertions, and the WebSocket try/finally restoration.
- **Checks if implemented:** inspect literal equivalence and run the two named offline serialization tests (or this file alone). Keep global fetch/WebSocket mutation isolated; do not run paid provider tests.

### F3-02 — Delete unused legacy provider methods from the compaction fixture

- **Evidence:** tests/cache-affine-compaction.test.ts:26–29 assigns getApiKeyAndHeaders and getProvider. Neither method is read elsewhere in that test file or by src/agent/cache-affine-compaction.ts or src/agent/instruction-continuity.ts (repository search). The actual bound agent stream at test :23 delegates to completeSimple; production preparation obtains the bound agent at src/agent/cache-affine-compaction.ts:67–69 and dispatches through agent.streamFunction at :148–163.
- **Change:** remove :26–29 only.
- **Gross/net:** **4 / 4 lines**, exact. Confidence **high**.
- **Behavior lost:** none on this test's actual execution path; removes fake methods, not auth checks.
- **Counterevidence/keep:** completeSimple is used and must stay. The early return at :17 deliberately leaves the unavailable-preparation case unbound (:423–449). getApiKeyAndHeaders is genuinely used by the separate native-compaction implementation (src/agent/native-compaction.ts:853); this finding does not authorize removing that production API. Retain getActiveTools/getAllTools and bindCurrentCompactionSession.
- **Checks if implemented:** run this deterministic compaction file, especially successful summary, paid-unusable-response cancellation, missing preparation, and provider error cases. Confirm completeSimple call counts/usage are unchanged.

### F3-03 — Remove an exact-subset compaction test

- **Evidence:** tests/cache-affine-compaction.test.ts:170–175 calls buildCacheAffineRequest(snapshot(), event()) and checks tail-user, tail-assistant, and whole-conversation summary wording. The identical input and all three assertions already exist at :106, :113–115 in the broader :105–116 test. Its stronger wording assertion contains the exact shorter string too.
- **Change:** remove :170–175 plus separator :176. Do not remove the subsequent duplication-count test (:177–182).
- **Gross/net:** **7 / 7 lines**, exact. Confidence **high**.
- **Behavior lost:** no unique case or assertion; one separately named test disappears.
- **Counterevidence/keep:** :126–144 changes the replay preparation and verifies absence of old boundary fields; :153–164 exercises a genuinely different late assistant suffix; :177–182 checks that retained text occurs only once. These are not duplicates.
- **Checks if implemented:** run the request describe block; compare remaining fixture arguments and assertions, not just the total passing test count.

### F3-04 — Give repeated native JobService construction one test-local owner

- **Evidence:** tests/t3/native-routing.test.ts:325–337, :418–428, :536–548, :580–589, :680–692 repeat the positional constructor with four undefined slots, explicit environment, and injected adapter. Those five blocks total **60 old lines**. The signature is src/tasks/job-service.ts:191–203.
- **Change:** one file-local scoped-service factory taking manager, adapter, explicit environment, and optionally policy. Keep the five scenarios and adapter bodies separate. Preserve the unusual depth:99/type:fast policy at :420–421: it proves scoped routing ignores local policy. Keep token/URL values explicit at callers rather than introducing credential/environment fallback.
- **Gross/net:** **60 / approximately 34–42 lines**, allowing 8–10 helper lines and 10–16 replacement-call lines. Estimate, not a patch measurement. Confidence **medium-high** that duplication is removable; exact net depends on formatting.
- **Behavior lost:** none intended. No adapter methods, launch IDs, ACKs, or assertions removed.
- **Counterevidence/keep:** do not fold the real HTTP nativeServer tests (:87–208) into injected adapters. Do not replace the deliberate malformed local policy, stream ACK behavior, cancellation status, pagination cursors, or immutable worktree-base assertions with generic happy-path fixtures. Manager shutdown and bridge/server teardown remain owned by each test.
- **Checks if implemented:** run this file alone; specifically ACK ledger retirement, concurrent identical intents, changing-local pagination, completed-task stop, and pinned worktree batch. Compare constructor arguments before/after. Avoid a cross-repository fixture framework for this small win.

### F3-05 — Small optional local helper for answered mirrored-question setup

- **Evidence:** tests/remote-question-bridge.test.ts:148–150, :175–177, :193–195, :230–232, :339–341, :357–359 all perform the same sync/list-first/answer setup with only answer text different. Six three-line blocks: **18 old lines**.
- **Change:** a local answerMirrored(h, text) helper that syncs, selects the current question, and returns service.answer with the current mutation tuple. Replace each block with a const q = await answerMirrored(...). Keep helper use restricted to these six matching setups.
- **Gross/net:** **18 / approximately 6–7 lines**, after six call lines and a five/six-line helper. Confidence **high** in equivalence, **low priority** because the saving is small.
- **Behavior lost:** none intended; no authority transition, dispatch, or retry operation belongs in the helper.
- **Counterevidence/keep:** the stale-version test (:207–224) must retain its old snapshot and interposed version mutations. The real RemoteClient test (:384–431) must use its own bridge, not h.bridge. Do not merge reply tests: receipt reconciliation, uncertain-without-receipt, explicit same-ID retry, and concurrent dispatch test different durable transitions.
- **Checks if implemented:** run this file alone; retain immutable request comparisons (:152–163, :347), zero-call guards, restart service/client construction, and owner/branch/version refusal assertions.

### F3-06 — Unroll labels that do not actually invoke lifecycle hooks

- **Evidence:** tests/cache-affine-compaction.test.ts:556–561 repeats the identical scope/set/clear/set sequence for strings shutdown, reload, new. The strings only alter frame text; no lifecycle handler is emitted. Each run therefore exercises the same functions. Actual in-place session-switch protection remains at :562–567.
- **Change:** replace the six-line loop with four direct scope/set/clear/set statements using a neutral frame string. Keep the later re-scope and both switch checks. Describe this as a direct ownership-clear test, not proof of three emitted lifecycle paths.
- **Gross/net:** **6 / 2 lines**, exact for that four-line replacement. Confidence **high** about redundancy, **low priority**.
- **Behavior lost:** repeated execution with three labels, not actual hook coverage. Re-scope after clearing is still exercised by :562–563.
- **Counterevidence/keep:** src/agent/instruction-continuity.ts:54–88 keys ownership by manager object and deletes stale session state; :91–103 refuses writes without ownership. Those protections and the independent-manager test (:541–552) must stay. This reduction does not justify dropping real extension lifecycle tests elsewhere. If there is doubt about repeated-clear value, retain this tiny loop rather than making safety coverage weaker for two lines.
- **Checks if implemented:** run instruction-frame ownership tests and inspect extension shutdown/new/reload wiring separately; these direct calls alone never proved the wiring.

### F3-07 — Optional product cut: custom focus for plaintext compaction (not recommended)

- **Assigned evidence:** tests/cache-affine-compaction.test.ts:511–528 has 18 lines covering absent/blank focus and literal dollar/template-like user data. Supporting executable prompt assembly is src/agent/cache-affine-compaction.ts:223, :228–231, :271, :313 (seven lines), plus functional template placeholder src/prompts/compaction.md:27 (one line). This is feature logic, not documentation cleanup.
- **Possible cut:** make this summary instruction static and remove the test-helper override and focus rendering. Replace both tests with a small static-prompt test and explicitly refuse nonblank custom instructions before inference; never silently ignore the user's focus. Also update native fallback messaging/routing to refuse rather than promise a removed facility.
- **Gross/net:** **26 gross / roughly 14–17 net locally**, subtracting one static prompt assignment, five baseline-test lines, and three–six refusal lines. This is a **conditional local estimate only**, excluding unmeasured native fallback/API/UI changes; no repository-wide saving is claimed. Confidence **high** in these local counts, **low** that a worthwhile complete feature cut exists.
- **Behavior lost:** user-directed summary focus and the plaintext fallback's ability to honor it. Significant loss for little code.
- **Counterevidence:** src/agent/native-compaction.ts:764–778 cancels custom compaction when an opaque checkpoint exists; :780–792 explicitly falls back to cache-affine plaintext otherwise. Removing plaintext focus alone would make that promise false. Literal-data handling prevents accidental replacement-template interpretation and should remain while this feature exists. No checkpoint/cancellation/security protections are candidates for removal.
- **Checks before any decision:** trace all compact UI/API callers and native/custom-focus fixtures; verify visible unsupported-focus refusal, zero dispatch on refusal, unchanged ordinary summary, and opaque-checkpoint safety. Do not adopt this cut without an explicit product decision. It is excluded from safe totals.

### F3-08 — Stop collecting an unasserted fast-mode status history

- **Evidence:** tests/native-fast-mode.test.ts:40 allocates statuses, :86 records into it, and :95 returns it. A whole-file search finds no status-history consumer or assertion; the other setStatus implementations are already no-ops (:463, :715, :763).
- **Change:** remove the statuses declaration/returned field and retain setStatus as a no-op. Terminate notices at :39 with a semicolon. Keep the callback interface: production status updates may still call it.
- **Gross/net:** **4 / 1 line**, replacing :39, :86 and :95 and deleting :40. Confidence **high**; tiny, optional dead-fixture cleanup.
- **Behavior lost:** unused test-only recording, not production status display or any asserted behavior. If status UI coverage is desired, add a real assertion instead; this suite currently provides none.
- **Counterevidence/keep:** do not delete setStatus itself or the notices/entries collectors, which support real refusal/persistence assertions. A status callback is not dead merely because its captured history is unread.
- **Checks if implemented:** run the fast-mode file offline and confirm no returned-status consumer is introduced. No production UI change is authorized.

## Complete per-file disposition

### tests/native-fast-mode.test.ts — 1–771 read

- **1–143:** used imports and shared harness/wire/SSE/token fixtures. Reuse the token fixture (F3-01) and optionally remove unread status recording (F3-08). The hooks, entries and notices have observable test roles; fake runtime and real runtime are not interchangeable.
- **144–281:** keep provider aliases and official-surface restrictions; API-key vs OAuth refusal; status/default consent; model/session changes; unavailable seam; asynchronous stale confirmation; request-local standard-tier override and explicit opt-out. These test cost authorization and request isolation, not speculative model matrices.
- **282–411:** keep actual OpenAI serialization, Codex SSE settings/compression and WebSocket frame proof. Reuse token fixture only (F3-01).
- **412–649:** keep delayed real ModelRuntime authorization, real AgentSession swallowed-hook/late-mutation zero-dispatch guard, and corrupt-record/wrong-auth/proxy zero-dispatch scenarios. Small hand-built harness tests above cannot replace these actual upstream seams. Retain diagnostic privacy, disposal, fetch restoration and temp cleanup.
- **650–771:** keep privacy-bounded static diagnostic assertions and both append-then-throw cases. Before-append failure (:673–682) is not equivalent to partial persistence (:684–722). Failed opt-out with prior premium consent (:724–771) is a distinct fail-closed requirement. Repeated stub runtime objects are small, local and intentionally non-dispatching; sharing a mutable runtime would introduce test coupling, so no deletion is proposed.

### tests/t3/native-routing.test.ts — 1–715 read

- **1–86:** keep exact version/schema contract, real loopback MCP initialization/notifications/DELETE handling, fixture lookup and afterEach server stop. Tests are auto-discovered, not dead because application imports do not reference them.
- **87–208:** keep real scoped routing without local spawn, list/observe/cancel, unsupported native controls and faithful local shell. Do not remove stream-control refusals or cancellation results.
- **209–311:** keep ambiguous replay vs permanent rejection distinction, sanitized typed denial, durable ACK identity, bounded eviction with replay. Seeding 255 entries avoids serial fsync work while exercising real reserve/reopen behavior; it is a deliberate efficiency improvement already present, not dead setup.
- **312–485:** keep bridge ACK retirement and two identical concurrent logical calls replayed by execute ordinal. They prove distinct durable behaviors. F3-04 affects construction only; retain stream writes, bounded waits, close(false), ledger reads and cleanup.
- **486–600:** keep local task fixture, mutable-membership pagination, and completed-native-stop truthfulness. Same mixed list API does not make these duplicates of initial list/cancel checks. F3-04 only.
- **601–715:** keep concurrent ledger serialization/path release, shell credential filtering/restoration, and first-resolved immutable worktree base. Actual security and data-loss boundaries. F3-04 only affects worktree test construction.

### tests/cache-affine-compaction.test.ts — 1–569 read

- **1–103:** fixtures are used; delete only the obsolete registry methods (F3-02).
- **104–196:** keep transformed full context, once-only instruction budget, split-turn replay semantics, stale-leaf/raw-tail refusal, safe assistant suffix, changed-message-boundary refusal, no retained-text duplication, growth/overflow bounds. Remove the exact subset at :170–176 (F3-03).
- **197–279:** keep entire-wire/cache-field comparison and Anthropic policy-marker relocation vs changed/dropped policy. Summary validation for error/aborted/length/toolUse prevents destructive or incomplete summaries; do not cut.
- **280–491:** keep live identity/settings/tool frame, running-task checkpoint, usage, paid-unusable-response no-double-inference, append failure privacy, abort accounting, unavailable preparation and error/abort diagnostics. The tests' mocks do not actually execute paid inference. Distinct cancellation points and append failures are not duplicate defenses.
- **492–529:** keep tool-input cache_control distinction (ordinary tool data must not be erased). Focus tests remain unless the explicit, nonrecommended feature decision F3-07 is taken.
- **530–569:** keep object-owned independent managers and stale in-place switching. At most simplify the label-only repeated loop (F3-06).

### tests/remote-question-bridge.test.ts — 1–480 read

- **1–93:** durable temp-session harness, pinned provenance, failed/lost-receipt modes, branch membership and cleanup all used.
- **94–277:** keep once-only mirror, human-owned answer authority, immutable pinned reply, restart receipt reconciliation vs uncertain-without-receipt, stale modal/no-retarget, owner/host/parent attribution, authoritative closure/malformed questions, sibling branch refusal. F3-05 only changes identical setup in four tests, including the field-loop test.
- **278–334:** keep normal /questions command path without parent answer turn and publisher shutdown semantics. Runtime integration is not covered by service-only dispatch tests.
- **335–431:** keep explicit same-ID retry, concurrent single claim, durable launch-branch anchor, and real RemoteClient owner-receipt behavior. F3-05 affects two mock setup blocks, never the real-client bridge.
- **432–480:** keep remoteExtension polling into the owning normal runtime, timer shutdown/event cleanup, and terminal-task history-only question behavior. Direct publishRemoteQuestionState tests do not prove extension polling. Terminal task state and native question-ledger status must not be conflated.

### tests/history.test.ts — 1–403 read; keep, no reduction recommended

- **1–50:** shared message constructors, usage and persisted fixture/afterEach cleanup are used; a helper here already keeps setup short.
- **51–164:** original provenance after compaction, active-branch selection, private thinking/hidden/custom/shaken exclusions, and opt-in cross-session access are distinct permission contracts.
- **165–238:** exclusion changes must invalidate already-issued search/read snapshots and remain effective when later compaction carry trims IDs. These are different from initial filtering; retain both.
- **239–299:** read-only cross-session loading preserves bytes/mtime and rejects missing/empty/legacy/oversize/FIFO paths. Keep no-directory-creation and no-migration assertions: this guards user data and blocking reads.
- **300–355:** original UTF-16 match coordinates and explicit traversal/exclusion/text-byte work limits. Do not replace these boundary tests with tiny successful fixtures or remove fail-closed exclusions.
- **356–403:** search/read paging, append-stable cursors, branch-change refusal and lone-surrogate fidelity are different contracts. No exact redundant case or dead helper found. Repeating inMemory and service construction is readable local setup, not enough benefit for another abstraction.

### tests/live-tools.test.ts — 1–322 read; keep, no reduction recommended

- **1–47:** fake adapter/connection collects audio, responses, contexts and playback; all returned fields are used. flush drains microtasks without network/device activity.
- **48–149:** nonblocking audio during work, advisory cancellation and duplicate IDs, sanitized failures, oversized/unknown requests, preserved large results, and dispatched-work survival without post-close reply. Do not infer cancellation ownership from interruption.
- **150–214:** cumulative context beyond 65k is not the burst/flood case below; retains truthful omission signaling and audio. Bounded concurrency and revocation before host dispatch versus survival after dispatch exercise opposite sides of the boundary.
- **215–282:** completed-ID replay with changed args is distinct from pending duplicate suppression at :62–75. Coalesced packet/close and 1000-update flood cover output bounds and honest gaps, not duplicates of cumulative throughput.
- **283–322:** typed allowlisted handoff reason vs untyped/unknown-code privacy is not covered by the generic failure above. Keep all assertions. Repeated expected response envelopes are protocol evidence; extracting them would save wrapping but obscure the actual scheduling/error wire contract. No whole-test deletion or optional Live cut is justified.

## Savings and checks summary

- F3-01–03 and F3-08: **26 exact net lines**, lowest-risk removals; F3-02 and F3-08 remove dead fixture code.
- F3-04–06: **approximately 42–51 further net lines**, test-local refactors/tiny redundant loop, lower priority.
- Combined safe/behavior-preserving candidates: **113 gross / approximately 68–77 net lines**. Not implemented or runtime-verified. Do not count the optional focus cut in these totals.
- No entire assigned file is safely dead. No production security, data-loss, authorization or cancellation guard is recommended for deletion.
- Suggested implementation checks are direct, focused offline bun test invocations for the touched files/blocks, not npm test/bun run test (package.json runs a build), full builds, live acceptance or paid tests. **None were run for this read-only audit.** Keep cleanup and global-state restoration when implementing any fixture refactor.

The coverage JSON records one complete assigned-range entry per file. Supporting production reads and search hits are evidence only, outside that coverage total.
