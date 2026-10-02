# tests2 follow-up 1 — read-only code reduction audit

## Completion and limits

**Complete for this manifest: 8/8 files, 3,841/3,841 assigned lines examined.** All inclusive ranges in tests2-followup1-ranges.json were reread from line 1, including previously viewed prefixes. Source was displayed with numbered, bounded chunks (52 deterministic chunks, each at most 3,500 source characters, plus prefix rereads). No assigned source relied on a clipped preview or grep-only coverage. The ledger is an array, one entry per assigned range.

Read wisdom/values.md first. The original tests2-report.md explicitly marked these eight files unread; this continuation closes only these eight gaps, not its other gaps or the repository audit. Its existing savings are not added here. Wisdom and other prose are not deletion targets or counted savings.

Only this report and its coverage JSON were written. No production/test/config/wisdom edits, commits, builds, provider calls, paid/live/device tests, or test execution. Validation below is proposed, not completed. Research consisted of source reads, reference searches and inventory checks.

## Consumer trace (why absence of imports is not dead code)

- package.json:15 runs build then Bun discovery of ./tests. scripts/ci.sh:57 discovers the complete root suite with BRUV_RUN_LLM_TESTS=0; :33 also discovers live-*.test.ts on macOS. .github/workflows/release.yml:166–167 disables paid tests and invokes ./tests. These eight files are Bun test entrypoints, not orphan modules.
- bunfig.toml:1–2 preloads tests/setup.ts; that preload only clears inherited Herdr identity (:1–4), not these suites. tsconfig.json:11 includes tests/**/*.ts. scripts/build.ts:45–49 compiles src/cli.ts, not the test tree. Test-source removal therefore offers maintenance savings, not demonstrated binary-size savings.
- Runtime consumer counterevidence: src/cli.ts:214, :275–279 loads/registers the remote extension; src/agent/extension.ts:60, :585 registers the task monitor. Live-owner tests import the real main-owner module (:19), and the SDK tests load the real task extension through DefaultResourceLoader (:45–67, :222–243). Dynamic import coverage is explicit in typescript-images.test.ts:52–59; :15, :30–32, :244–256 invoke the compiled runner, whose standalone flag is defined at src/typescript/runner.ts:10.
- background-ux.test.ts:8–11 is intentionally opt-in, not unreachable. package.json:16 selects only llm.test.ts for test:llm, so this UX case needs explicit selection with BRUV_RUN_LLM_TESTS=1. It is still discovered by ./tests (normally skipped). No named standalone-script caller of these eight test files was found in scripts/.github/src; discovery is the positive consumer. No whole-file unused claim is made.

## Findings (disjoint assigned-code estimates)

### tests2-followup1-01 — One local owner for command-only remote test stubs

**Refactor; confidence high on duplication, medium on formatted savings. Gross 100 lines; net estimated 50–65 lines.**

Evidence: tests/remote-extension.test.ts repeats on/registerCommand/sendMessage object literals at **151–159, 218–224, 269–275, 334–342, 503–511, 957–965, 986–992, 1043–1051, 1080–1088, 1160–1166, 1251–1259, 1332–1340**. These 12 disjoint slices total 100 examined code lines. Each captures the registered command, optionally records messages, and ignores event hooks. Keep a small file-local factory returning a Pi stub, captured command accessor and messages; tests keep their own clients, task state and UI actions. Replace only these stubs. No shared mock framework, lifecycle runner or permission-policy abstraction.

Counterevidence: :13–22 observes active tools and registration; :445–452 and :610–619 register and invoke session hooks; :829–845 owns persistent entries and reload instances. Do **not** force those into the command-only helper. The cases at :303–361 and :1014–1071 deliberately mutate owner/offline state during confirmation; :1216–1361 exercises real local grants and narrow revocation. Similar fixture shapes do not make their assertions duplicates.

Behavior lost: none intended. Keep actual extension registration, every client callback, rejection assertion, picker sequence, explicit Escape/denial, and task-bound capability checks. Deductions include roughly 35–50 new helper/call-site lines; removed outer declarations are not additionally credited. No production savings.

Checks needed: run the remote-extension suite offline against the current build; preserve named cases/assertions and command capture timing. Verify no lifecycle tests lost session_shutdown, no stale-owner action dispatches, no broad grant/transfer approval, and no second routine inbox for owned jobs. Check formatting before treating the net estimate as measured.

### tests2-followup1-02 — Reuse the compaction test's offline execute installation, not its installation timing

**Small local refactor; confidence high on identity, medium on net value. Gross 17 lines; net estimated 3–7 lines.**

Evidence: tests/instruction-continuity-sdk.test.ts:261–269 and :331–339 find the currently registered execute tool, preserve its fields and replace its implementation with exactly the same result-for-ID function. Count only :262–269 (8 lines) and :331–339 (9 lines); keep :261's binding for the first installation. A small local installer can accept the currently registered tool and install the same offline result function; pass the existing :261 binding first and look up the rebuilt tool again for the second call.

Counterevidence: :328–330 expressly documents and reinstalls the offline transport after compaction; :331 reads the **rebuilt** tool. Removing the second installation or retaining the pre-compaction tool object is wrong. :120–129 has a different result payload and is not a duplicate scenario. The initial report's tests2-02 addresses other SDK files; this estimate includes neither those files nor a speculative shared session bootstrap.

Behavior lost: none intended; installation still occurs twice against current runtime state. Deduct 10–14 replacement helper/call lines. This is low priority; skip if formatting or types erase the small gain.

Checks needed: run this SDK suite offline, retaining all custom/default/empty-frame cases and the fresh-compaction case. Preserve hook counts (:304–306, :354), secret suppression (:309–310), both returned tool IDs (:349–353), five request-frame continuity assertions (:140–145), and cleanup. Never replace the real SDK loop with a fake continuation test.

### tests2-followup1-03 — Delete the unused outer handlers Map

**Dead local binding; confidence high. Gross/net 1 line.**

Evidence: tests/remote-extension.test.ts:601 allocates handlers in the reload test (:598–636), but the test never reads or writes it. Each make() call creates and returns a different map named h at :609–619; first/second use those at :622–635. Delete :601 and terminate the messages declaration at :600. This binding is lexically local, not exported, passed to a client, dynamically loaded or a test/build entrypoint.

Counterevidence: all other lifecycle handler maps remain necessary. In particular the h map at :609 must stay, as must both shutdown calls.

Behavior lost: only an unobservable empty Map allocation. Check: rerun the reload case and lint the file. No other lines credited.

**Combined opportunity: gross 118 examined code lines; net estimated 54–73 lines.** Estimates include replacement code even if eventually moved outside the assigned files. Findings do not overlap. They are not measured patches. No feature cut or whole-suite deletion is recommended.

## Full-file verdicts and retained boundaries

| Assigned file (all lines reviewed) | Evidence and counterevidence against cutting coverage |
| --- | --- |
| tests/remote-extension.test.ts:1–1373 | Keep parsing/bridge bounds (:44–126), terminal/bidi escaping (:128–136), fresh question identity and Escape (:138–301), confirmation revalidation (:303–361), compact/reload-aware attention (:363–665), session-scoped jobs/history (:667–943), untracked transfer consent/inventory bounds (:974–1012, :1147–1214), task-bound grants and offline/changed-owner revocation (:1014–1071, :1114–1145, :1216–1361), and one normal jobs/questions workflow (:1363–1373). Poll tests overlap superficially, but reconnect generations, volatile diagnostics, persistent keys, unresolved status and startup baselining differ. Only findings 01/03 reduce scaffolding. |
| tests/live-main-owner.test.ts:1–595 | Keep actual SDK/registered execute/rendered UI and text fallback (:123–269). The local fixture (:31–120) is actively consumed throughout, not dead scaffolding. Synthetic tests isolate hook denial/event fidelity (:270–434), close/result ordering (:435–458), provisional versus canonical history (:459–481), admission reservation/cancel race (:484–505), final-transcript gating (:506–525), disabled tools/prompt restoration (:527–550), delegation retry identity and voice/work cancellation separation (:552–595). Real-SDK and fake-fixture cases prove different boundaries. |
| tests/subagent-placement.test.ts:1–458 | Keep reusable real RemoteClient/JobService fixture (:20–129), destination profile/no laptop model (:131–169), role-depth and human-pinned authority (:171–214), unknown launch retry/session isolation (:216–251), local alias/native confinement/local launch (:253–343), allowlisted inputs and retained preparation identity (:345–395), explicit overrides (:397–423), cached target discovery and titles (:425–458). Fake transport/isolated snapshot is declared at :71, not proof of real SSH/snapshot transfer. That limitation does not justify deleting placement-policy tests. |
| tests/instruction-continuity-sdk.test.ts:1–359 | Keep real SDK framing across continuation/custom/default/empty prompts (:26–171) and fresh compaction/redacted multi-tool state (:173–359). Three input variants are not interchangeable. Only identical offline execute installation plumbing is reducible (02). |
| tests/questions.test.ts:1–341 | Keep shared branch fixture (:7–47), persistence/reply idempotency (:48–96), lock-time navigation (:97–121), ledger bounds/race (:122–146), ancestor/deeper fork restrictions (:148–172), off-branch versus inline/chained/anchored diagnostics (:174–324), and ask-time lock revalidation (:326–341). Similar branch assertions cover different ancestry and authority; do not collapse them into one generic branch case or remove lock waits. |
| tests/typescript-images.test.ts:1–286 | Keep real runner input/ordered concurrency/dynamic import (:38–119), resize/original safety (:121–158), input and transport budgets/recovery (:160–215), failure/timeout/flood discard (:217–242), private-channel-only authority (:244–257), and hostile metadata/header checks (:259–285). Header-only fixtures and large padding are intentional transport isolation (:193–194), not dead fake-image code. Existing execute/record/makePng helpers already centralize useful repetition. |
| tests/task-monitor.test.ts:1–257 | Keep shared spawn helper (:8–18), real-process stop/dispose/no late renders (:20–58), empty versus completed states (:60–78), tiny-frame identity and zero-row no-action rules (:80–131), non-TUI command refusal (:133–152), inspect navigation (:154–182), frozen confirmation/selection amid completion (:184–212), sanitization and bounded viewport (:214–240), event and no-argument subscription behavior (:242–257). Constructor repetition is small; a configurable fixture here adds little beyond the existing launch helper. |
| tests/background-ux.test.ts:1–172 | Keep explicitly paid opt-in real nested orchestrator/two-worker workflow (:8–51), streamed and persisted evidence (:52–123), early return/yield, exact completion counts and anti-polling assertions (:124–156), final PASS and owned cleanup (:157–172). It proves natural provider workflow, unlike deterministic TaskManager tests; the TUI companion has a separate rendered-human purpose. Removing this test would lose that acceptance evidence. Existing yieldedEntries is genuinely shared (tests/turn-boundaries.ts:2; background-ux-tui.test.ts:189; turn-boundaries.test.ts:23–28). No deletion savings credited. |

## Validation / handoff

Inventory verified all manifest endpoints exist and total 3,841. Every assigned code line was reviewed, not merely loaded/count-checked. No tests were run: proposed offline checks need prepared assets/current dist where required; do not invoke package test/check/build as part of this read-only audit. Paid nested UX validation would require separate explicit authorization and remains unrun. No new wisdom/value edit: this is evidence collection, and the user permits only these two artifacts.
