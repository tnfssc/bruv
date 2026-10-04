# tests3 follow-up 1 — exhaustive code-reduction audit

## Scope and proof

Read **all 3,525 assigned lines** in all six ranges in `tests3-followup1-ranges.json`. Coverage below and the companion JSON describe this follow-up only; they do not mark the rest of the prior partial audit complete. Read `wisdom/values.md`, especially bounded use, durable ownership, honest proof, simple local ownership, and security/data-loss preservation. No source, wisdom, or values edits; no commit. No build, test suite, Live session, or paid/provider request was run. Findings are static review proposals, not verified patches.

Assigned source was read in numbered bounded chunks (each under 3,600 output characters), without relying on truncated previews. Ancillary searches initially overflowed previews; relevant evidence was reread in smaller outputs. Line counts were checked against current files. Repository traces confirm these are active suites for registered features, not abandoned test files. Prior `tests3-report.md` explicitly left these six unread; its offline-envelope finding tests3-01 is not counted again here.

**Estimated independent mechanical savings: 163 gross / 115–123 net physical lines** across F1–F5. F6 separately offers two lines of duplication reduction, but its required restoration correction has unestimated cost and is excluded from the total. These are estimates for proposed formatting, not measured diffs. F7 adds an optional 16-line evidence cut. F8 is a mutually exclusive product choice, not additive to goal-test refactoring. Do not interpret tiny token removals as whole-line savings.

## Findings

### F1 — Remove genuinely unused fixture affordances

**Safe local dead code; high confidence. Gross/net: 5 lines, plus zero-line token reductions.**

- `tests/questions-runtime.test.ts:61–63`: returned `session(v)` setter is never called by any of the eleven tests. `getSessionId` at 18 still needs its fixed fixture identity. Remove only the three-line setter; retain leaf navigation at 58–60 and the deliberately different manager at 169–178. The latter is real stale-session coverage, not a use of this setter.
- `tests/native-shake-sdk.test.ts:47–66`: all four `appendTrace` calls (131, 137, 306, 395) discard the return and omit the fifth input argument. Remove the unused forwarding line 54 and array-return line 66; remove the unused customization parameter and change the return annotation to `void` on 47. `assistant` already defaults input to 20 at 34. Keep both journal appends at 64–65. Gross/net two deleted lines; signature edits are zero-line savings.
- `tests/live-host-bridge.test.ts:5`: named `stat` import is unused. The permission checks at 356 and 373 call `Bun.file(...).stat()`, not that binding. Remove the import token, **0 physical lines**.

**Counterevidence:** these helpers support valuable active tests; deleting their whole fixtures or assertions would be wrong. The functions are module-local, not exported APIs. **Behavior lost:** only unused test customization/return values; no exercised scenario. **Checks:** focused offline suites for these three files; verify all four appendTrace calls still append the same assistant/tool-result pair and retain input=20 accounting; search again for the setter/import before applying.

### F2 — One file-local compaction-event fixture, not a new harness

**Simple duplication refactor; high confidence in equivalence. Gross 52 / net approximately 30–36 lines.**

`tests/native-compaction.test.ts:892–904,950–962,999–1011,1053–1065` repeat the same 13-line event shape: branch, fresh abort signal, first branch entry, empty summarized/prefix messages, token count, file-operation sets, settings. One small `compactEvent(branch)` function (~12–18 lines) and four one-line uses replace those 52 lines. Preserve that 892 currently wraps creation in a function: keep lazy creation there rather than sharing one mutable event.

**Counterevidence:** other preparations differ: 462–470 has auto/retry/split-turn fields, 516–524 has required messages, 719–727 uses split custom messages, 803–811 explicitly includes `isSplitTurn: false`. Do not normalize absent fields, reuse mutable Sets, or widen this into a universal builder. Deferred credentials, deferred HTTP, and model-selection tests at 940–1093 exercise different fences; **do not merge their assertions**. **Behavior lost:** none intended. **Checks:** run this file offline; ensure each creation has new Sets and a new signal and preserves absent optional fields. Retain cancellation, dispatch-only observation, empty new-session state, and unchanged old branch assertions.

### F3 — Parse quoted voice handoff envelopes once in this test file

**Simple duplication refactor; high confidence. Gross 35 / net approximately 22–23 lines.**

Seven five-line parse expressions in `tests/live-host-bridge.test.ts:167–171,256–260,289–293,311–315,322–326,387–391,402–406` repeat `JSON.parse` and the same two literal separators. A file-local parser (~5–6 lines) and seven one-line calls suffice. Keep callers' `entries`, omitted count, snapshot path, durability, expiry and immutable-file assertions separate.

**Counterevidence:** the literal framing is itself a contract; keep those literals in the test helper, not imported from production. A production parser shared with the test would make coordinated mistakes invisible. The ordinary recent-message path (182), delegated unwrapped GPT-Live payload (470–474), and quoted send/steer payloads are different contracts. **Behavior lost:** none. **Checks:** focused file run offline; wrong/missing separators must still fail, and all current payload/snapshot assertions remain. Do not replace this with a general protocol abstraction.

### F4 — Merge the two unavailable-goal restore examples without losing either assertion

**Small duplicate scenario; medium-high confidence. Gross 16 / net 12 lines.**

`tests/goals.test.ts:440–454` restores an unavailable waiting job and checks paused status plus an explanation containing “unavailable.” `551–566` repeats the restore with two valid task references and checks status plus both IDs. Delete the first 15-line test and replace the one-line status assertion at 564 with a four-line `toMatchObject` asserting both paused status and the “unavailable” explanation; keep both ID assertions at 565.

**Counterevidence:** “job_1” and “task_*” take different explanation suffix paths. Production `src/goals/extension.ts:138–148` always pauses for unavailable status, but appends references only for IDs matching its task-ID pattern. If the non-matching-ID/no-reference suffix is an intended separate contract, retain a named table case for it instead: savings will be smaller. Neither existing test asserts absence of a reference suffix. **Behavior lost:** separate execution of the non-matching-ID fixture, not an existing assertion, under the proposed merge. **Checks:** focused goal tests; mutation that stops pausing or drops either unavailable text or a task ID must still fail. Keep corrupt-restore diagnostics at 61–77 and all ownership checks at 92–100.

### F5 — Share question-runtime fixture lifetime, not question semantics

**Simple test-local refactor; medium-high confidence. Gross 55 / net approximately 46–47 lines.**

All eleven tests in `tests/questions-runtime.test.ts` repeat a harness creation, try, finally, cleanup call and closing finally brace. Exact repeated wrapper lines:

- 68–69/98–100; 104–105/118–120; 124–125/147–149;
- 153–154/160–162; 166–167/184–186; 190–191/205–207;
- 211–212/237–239; 243–244/271–273; 277–278/293–295;
- 299–300/324–326; 330–331/354–356.

Use one ~8–9-line `withHarness(async h => ...)` that creates a harness, awaits the callback inside try, and always invokes existing `h.cleanup()`. Put the invocation on the test declaration's existing line. This removes 11×5 repeated lines while preserving all bodies. Do not add a global/shared fixture or suite hooks that obscure ownership.

**Counterevidence:** some bodies create additional attached runtimes, and several use multiple timer ticks intentionally. Keep every tick, restart, CAS/claim, foreground-blocker and duplicate-delivery assertion. Awaiting the callback adds an asynchronous boundary before final cleanup; verify no pending callbacks rely on immediate cleanup. Do not casually add pause/clear behavior to this reduction. **Behavior lost:** none intended; fixture lifetime must still cover the entire awaited body. **Checks:** run this file repeatedly offline, including a deliberately thrown callback to prove cleanup; preserve failure propagation and distinct per-test temporary directories.

### F6 — Reuse existing job-global restoration, but first correct its scope

**Small duplication plus an observed isolation defect; medium confidence. Duplication alone: gross 4 / net 2 lines. Combined correction net: not established, potentially negative.**

`tests/job-bridge-protocol.test.ts:83–85,101` duplicate `saveJobGlobals` at 105–112. Replace with one restore capture and one call. This saves two physical lines before any restoration correction.

**Important counterevidence:** both versions currently save only six keys (shell, subagent, handoff, history, goal, jobs), whereas `src/typescript/job-bridge.ts:348–395` installs **nine**, also remote (355–363), live (374), questions (375–382). A blind dedup perpetuates stale globals pointing at destroyed sockets. Extend the local restoration to all installed keys; account for original absence if preserving global shape. The correction may consume more than the two saved lines; no combined net reduction is claimed. This is not permission to delete cleanup.

**Behavior lost:** none desired; restoring the three currently leaked globals intentionally changes erroneous cross-test residue. **Checks:** focused protocol suite plus adjacent bridge tests in the same process; verify all installed globals are restored after both success and thrown errors. Keep EPIPE redaction at 94–97, accumulated-frame preallocation guard at 114–148, and cancellation listener/ACK tests at 212–278.

### F7 — Optional coverage cut: retire the three-byte UTF-8 fragment example

**Optional maintained-evidence reduction, not dead production code. Gross/net 16 lines; medium confidence.**

`tests/native-compaction.test.ts:1160–1175` feeds an LF-framed completed opaque item in three-byte chunks. `1194–1217` feeds an opaque Unicode item byte-by-byte, with additional multiline/CRLF framing. Normal LF completed frames remain exercised at 1245–1278 via `completed` (1153–1159). Production has one streaming fatal UTF-8 decoder (`src/agent/native-compaction.ts:275–277,324–338`) rather than a separate three-byte path.

**Counterevidence:** these are not byte-identical inputs; the retained test combines newline and Unicode stress, and arbitrary chunk partitions are not formally proven by a one-byte fixture. **Behavior lost:** the dedicated three-byte + simple-LF partition probe; no product behavior should be removed. **Checks before accepting:** run current and reduced offline transport cases, confirm invalid streaming UTF-8 still fails and normal LF/CRLF/lone-CR framing still works. Preserve immediate body cancellation, late-reset result retention, failed-terminal usage, caller abort and size-limit cleanup (1245–1345). Reject this cut if independent framing/decoder localization is worth sixteen lines.

### F8 — Optional product cut: retire persistent goal mode as a whole

**Human product choice only; NOT safe dead code. Assigned-file gross/net: 590 lines if the feature and its suite are genuinely retired. Whole-feature net: not established.**

`tests/goals.test.ts:1–590` is dedicated goal-store/controller/extension coverage: durable state (17–101), no-progress limits (103–138), continuation and owned-job waiting (184–345), context guidance (346–393), question interlocks (395–438), command/branch/disk behavior (456–549), affected task references (551–566), and queued reminder integrity (568–590). If users no longer want persistent objectives and automatic continuation, this entire assigned suite becomes unnecessary **only after** retiring those entry points coherently.

**Active counterevidence:** registration is live at `src/agent/extension.ts:562–578`; slash command at `src/goals/extension.ts:155–171`; model APIs at `src/typescript/job-bridge.ts:368–373`; preview imports at `src/prompt-preview.ts:20`. Repository search also finds goal types in bridge and controller. Prior report already lists paid goal acceptance removal as tests3-08; that is a different, much smaller evidence cut and is not counted here. This audit did not exhaustively review all production goal modules or ancillary suites, so it does not claim a whole-feature deletion total.

**Behavior lost:** /goal set/status/pause/resume/clear, goal APIs/guidance, persisted objectives and progress tracking, automatic goal reminder turns and waiting-job reactivation. This is real functionality, not mere documentation. **Confidence:** high that the assigned 590 lines belong to the feature; low that whole-feature retirement is presently desirable. **Checks/conditions:** explicit product acceptance; trace/remove all goal RPC, command, preview and prompt surfaces; leave existing session history intact and ensure retired saved goals remain inspectable rather than silently erased. Preserve task ownership/cancellation, question blockers and delivery claims independently. Verify ordinary turns, jobs completion, stop, saved-question resume and session reopen offline. Retain a small retirement/legacy-state check if needed and subtract its cost from the whole-feature net. Do not delete only the tests while keeping goal mode. Not additive with F4.

## Keep decisions and counterevidence from the full read

- **Native compaction (1–1362):** keep request identity/tier, one request/no premature dispatch, accounting consistency and failed-terminal billable usage (45–281); byte-identical opaque replay and provenance (284–369); full fail-closed lifecycle (371–1149); terminal and transport bounds (1151–1362). The throw/catch “expected failure” sentinels at 183 and 1292 are not useless: unexpected success must fail the usage assertions. The parse-level terminal usage test (167–187) and transport-level failure table (1279–1298) cover different layers. Cache preview versus explicit invalidation (551–578) and pre-switch compatibility versus in-flight stale selection (756–791,1041–1093) are not duplicates. F2/F7 are narrow reductions only.
- **Goals (1–590):** retain append-before-memory safety (79–90), ownership rejection, evidence/no-progress bounds, deliberate interruption, protected reminders, branch-scoped JSONL and question interlocks. Controller-level loops do not replace extension-level waiting/completion loops. The explicit false question callback at 432–438 is useful integration counterevidence, not a dead default-value test. F4 is the one small overlap; F8 requires removing the feature, never just its safeguards.
- **Live host (1–500):** retain supplied-port routing, trusted stop confirmation, scope invalidation, replay dedup, stale native refresh handling, full immutable transcript exports, TTL/budget/private permissions, active snapshot I/O branch switch, actual TaskManager + JobService dispatch, and GPT-Live delegation/stop guards. Export/durability tests are not expendable “fixtures”; they protect real user history. `siblingEntries` (31,94,309) is inert in this fixture: `getBranch` at 37–49 never sees it, and no whole-session accessor is offered. Consequently the “sibling-SECRET” assertion at 317 is weaker evidence than its title suggests. Keep the privacy contract; strengthen the fake with a distinguishable whole-session path/forbidden-call assertion rather than claiming three lines of safe security-test deletion. Production explicitly uses branch ancestry at `src/session/host.ts:201–206,346`.
- **Native shake SDK (1–438):** keep real resource loading/session binding and offline stream replacement (78–110,185–250); adversarial synthetic shim provenance (273–296); honest no-op (298–311); all eight refusal modes (313–354); hook exclusions (356–379); archived/current checkpoint distinction (381–422); SDK context edits (424–438). These are not replaced by plain-summary/manual-shake tests. Exact shim, ciphertext, journal-line, JSONL reopen, and serializer assertions address different boundaries; no bulk duplicate/dead-test claim. Only unused appendTrace affordances qualify for F1. The same assistant-envelope pattern as prior tests3-01 is not a new savings total here.
- **Questions runtime (1–357):** keep pending/answered/queued/delivered distinctions, ownership/idle routing, explicit restart resume, navigation and stop pause, unsupported-surface rejection, old-manager fencing, bounded queue, durable dispatch uncertainty, foreground blockers, two-runtime claim exclusion and cancel-not-resolve behavior. “Child-only” goal tests and this suite exercise opposite sides of the callback boundary; they are not duplicates. Only wrappers/setter qualify for F1/F5.
- **Job protocol (1–278):** keep malformed/oversize frame redaction, invalid ACK versus cancellation causes, EPIPE classification, accumulated-vs-multi-frame chunk distinction, swallowed expected Duplex peer-abort events (193–196), and exact listener release/provisional foreground ownership. The 100-cycle listener test (224–232) detects accumulation; do not shorten it merely because one iteration has the same assertion. F6 is local restoration only.

## Coverage ledger

| Path | Assigned/read | Complete | Verdict | Findings |
|---|---:|:---:|---|---|
| tests/native-compaction.test.ts | 1–1362 / 1362 | yes | Keep protections; event-fixture refactor; optional fragment evidence cut | F2, F7 |
| tests/goals.test.ts | 1–590 / 590 | yes | Keep active feature coverage; small restore overlap; optional whole-feature retirement only | F4, F8 |
| tests/live-host-bridge.test.ts | 1–500 / 500 | yes | Keep history/authority/stop guards; unused import and envelope parser refactor | F1, F3 |
| tests/native-shake-sdk.test.ts | 1–438 / 438 | yes | Keep distinct SDK/data-preservation evidence; remove unused fixture affordances | F1 |
| tests/questions-runtime.test.ts | 1–357 / 357 | yes | Keep delivery/ownership guards; unused setter and fixture-lifetime refactor | F1, F5 |
| tests/job-bridge-protocol.test.ts | 1–278 / 278 | yes | Keep protocol/cancellation checks; deduplicate and correct global restoration | F6 |

Numbered read chunks: compaction 1–79,80–173,174–266,267–338,339–424,425–496,497–568,569–640,641–711,712–780,781–859,860–926,927–995,996–1066,1067–1130,1131–1199,1200–1279,1280–1362; goals 1–80,81–152,153–242,243–321,322–394,395–462,463–539,540–590; Live host 1–84,85–170,171–239,240–304,305–372,373–443,444–500; shake SDK 1–100,101–182,183–250,251–322,323–393,394–438; questions 1–95,96–178,179–263,264–352,353–357; job protocol 1–93,94–172,173–257,258–278. No assigned unread lines.

## Checks actually performed / next checks

Performed only static reads, bounded repository searches, current-file line counts and status inspection. No passing-test claim. `package.json:15` wires `test` through a build, so a future implementer should invoke **direct focused `bun test <affected paths>`** with live/LLM flags unset, not `bun run test`. Full build/live/paid tests were not run. Prior existing untracked `wisdom/quality/code-reduction-audit-2026-10-02.md` was left alone. Only this report and the companion coverage JSON are written by this task; wisdom/values remain unchanged because this is a read-only code audit, not a wisdom cleanup.
