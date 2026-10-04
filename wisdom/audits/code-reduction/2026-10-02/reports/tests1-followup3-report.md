# tests1 follow-up 3: read-only code-reduction audit

## Coverage and limits

**FULL assigned coverage: 7/7 files, 3,418/3,418 lines.** Every line of every range in tests1-followup3-ranges.json was read in numbered, bounded chunks. Actual file lengths match the manifest. Coverage JSON records each complete range; there are no unread assigned lines.

Read wisdom/values.md in full and relevant tests1-report.md sections (1–94, 112–129, 165–193). The original report explicitly left all seven files unread (:174–191); its findings did not establish a verdict for these files. This report closes only this follow-up's ranges, not all gaps in the original audit. Initial oversized guidance reads were reread in smaller chunks; truncated auxiliary source excerpts were also revisited. All assigned source reads were bounded below 4KB.

No source edits, builds, tests, provider requests, audio/Live operations, or commits. Only this report and its coverage JSON were written. Evidence is static source/reference inspection, not a passing implementation. Wisdom and prose deletion contribute zero savings; values are unchanged because this is an audit, not a new lesson.

**No assigned file is proven wholly dead.** Five small, behavior-preserving opportunities below estimate **gross 103 / net 46–60 physical lines**. Gross means existing candidate regions replaced/deleted, not a claim that every line in a refactor disappears; net subtracts replacement/helper code. These are unimplemented estimates. No adjacent production savings are counted, and these regions do not overlap tests1-01–09's counted regions.

## Discovery, CLI/build and dynamic-fixture evidence

- All seven files import bun:test and register tests at top level. package.json:13–15 builds the CLI and runs bun test ./tests. scripts/ci.sh:44–57 builds before the complete root inventory; :33 additionally runs the live-*.test.ts inventory on macOS. .github/workflows/release.yml:167 also invokes bun test ./tests. None of these seven needs a production import to be discovered. GPT playback is in the root inventory even though its filename does not match the separate macOS live-* glob.
- tests/typescript-runner.test.ts:7,18–33 launches **dist/bruv**, not the source runner. scripts/build.ts:44–49 compiles src/cli.ts into the configured executable (default dist/bruv at :11). src/cli.ts:74–82 dispatches the internal runner flag, calls runTypeScriptFromStdin, sanitizes diagnostics, and exits. Replacing compiled-runner tests with source-only tests would change proof.
- Runner fixture packages are written at runtime, not static imported files: tests/typescript-runner.test.ts:101–127,163–194,199–245,285–308,314–332,356–374,380–434 exercise actual package resolution. src/typescript/runner.ts:21–51 reads manifests/export maps and canonicalizes paths; :91–115 rewrites imports; :124–176 provides anchored native require; :186–209 intercepts native CommonJS resolution; :219–234 extends graphs for computed imports; :250–299 registers statically reachable and dynamically extended ESM graphs. Deliberately missing/type-only/private/wrong-entry fixtures and the untaken import at tests/typescript-runner.test.ts:157 are negative lazy-loading evidence, not dead setup.
- Remote presentation is shipped: src/remote/root-cli.ts:3,55 imports and calls the presenter; src/remote/root-presenter.ts:500,571 creates RootTranscript and RootControls. The controls constructor (:86–90) only stores references. This last fact supports the unused **test-local construction** finding below, not deletion of the controls feature.
- Both playback layers are active: src/live/extension.ts:172 creates PlaybackScheduler and :472 creates GptLivePlaybackRecovery; src/live/gpt-live-playback.ts:66–70 deliberately supplies a smaller pending budget. The tests run these classes offline; their similarity is not proof one layer's tests substitute for the other.
- Herdr is dynamically loaded/registered by src/cli.ts:217,277. The test-local socket fixtures are invoked directly throughout tests/herdr-agent-state.test.ts and expose real newline-framed local socket behavior. Job attention is instantiated by src/agent/extension.ts:544; snooze/watch remain exposed by src/typescript/job-bridge.ts:390–391 and handled by src/tasks/job-service.ts:1110–1129. Absence of external test-fixture imports does not make these APIs unused.
- tests/helpers.ts:1–27 supplies offline environment/subprocess mechanics, not a socket recorder or UI component fixture. The proposals below should stay file-local; no generic multi-subsystem test framework is justified.

## Findings

### tests1-f3-01 — Remove the runner's exact duplicate exception test

**Duplicate assertions/test invocation; high confidence. Gross/net 7 lines.**

Evidence: tests/typescript-runner.test.ts:471–476 runs throw new Error('runner-failed') and checks exit code 1 plus the error text. The preceding test (:462–469) runs the identical source via the identical runTypeScript helper, checks both of those expectations (:465–466), and additionally checks the module caption and absence of data-URL diagnostics (:467–468). Delete :470–476, retaining :462–469.

Counterevidence: :457–459 is **not** duplicate: it tests malformed syntax and process.exit(7). The removed test's title says “transpilation or execution,” but its body only tests the same execution throw. Keep syntax/early-exit coverage and all remaining sanitized failure assertions.

Behavior lost: one identical child execution and a second test name/failure location; no distinct input or assertion contract. Checks after a future authorized patch: the compiled typescript-runner suite, especially syntax failure, exit 7 and sanitized runtime errors. Do not execute the package test script without separately authorizing its build.

### tests1-f3-02 — Reuse the Herdr socket recorder's framing and lifecycle

**Duplicate setup/teardown refactor; high confidence in duplication, medium in net estimate. Gross 58 / net 20–32 lines.**

Evidence: the canonical test-local socketRecorder at tests/herdr-agent-state.test.ts:107–133 creates a temporary socket, accumulates input until newline, parses/stores WireRequest, acknowledges, and closes/removes its own directory. Three tests copy those mechanics at :331–345,451–472,499–513, plus teardown at :358–359,493–494,536–537. These regions total 58 physical lines. Retain the existing recorder and allow a small, explicit request/reply callback plus, if necessary, a per-socket setup callback. Callers retain request arrays/path access and their local stall state; use recorder.close() in the three finally blocks.

Counterevidence/requirements:

- :342 replies **only** to pane.release_agent, testing quit dropping queued work.
- :454,468–469 withholds the first acknowledgment and replies afterward, testing ordering and final state.
- :460–462 intentionally suppresses EPIPE only in that ordering fixture. Preserve that exact error treatment; do not turn all socket errors into ignored errors.
- :510 deliberately withholds release replies, proving an awaited quit and a replacement cancelling release retries.
- Preserve requests being recorded before the reply decision, newline buffering, socket path uniqueness, actual socket I/O, callback-local state, and scoped server/directory cleanup. Do not replace these with mocked request counts or automatically acknowledge the withheld cases.

Behavior lost: none intended; only repeated transport mechanics. Checks after implementation: all Herdr tests together, the stalled quit/order/concurrent-replacement cases individually, monotonic sequence, final working state, no stale release after replacement, awaited quit, diagnostics, listener detach/restart and removal of only the fixture directory. Actual upstream Herdr/provider systems are not needed for these checks. If a callback abstraction costs more than the estimate, retain the specialized fixture rather than grow a framework.

### tests1-f3-03 — Share two tiny conversation fixture mechanics, not rendering scenarios

**Duplicate setup refactor; high confidence in duplication, medium-high in net estimate. Gross 33 / net 14–16 lines.**

Two non-overlapping regions in tests/conversation-density.test.ts:

1. :88–103 defines status and custom with identical CustomMessageComponent construction; only customType differs. Replace the two eight-line builders with one file-local builder receiving the explicit union of notice/task-complete/task-attention and the existing label/outputPad. Update ordinary notice calls (:173–174) to pass notice, and keep task types explicit at status call sites. Gross 16 / net approximately 7–8.
2. :675–679,682–685,688–691,694–697 repeats the same mouse observer: push y/height into the appropriate array and return handled:true. A tiny file-local attach-observer helper can replace these 17 lines with four explicit attachment calls and about five/six helper lines. Retain each component, each distinct array, and every :725–732 assertion. Gross 17 / net approximately 7–8.

Counterevidence: status-vs-notice **is** behaviorally meaningful. The ordinary custom pairs at :168–186 and task status sequences at :474–544 must still use their original types. Tool/user/assistant hit areas differ, and :726,728,730,732 intentionally expect different coordinates/heights. Do not replace them with one representative component. Do not move density installation to an unconditional beforeEach: :568–668,734–750 test disposal/reinstallation/foreign wrapper ownership explicitly.

Behavior lost: none intended; redundant fixture definitions/handler spelling only. Checks after implementation: entire conversation-density suite with actual Pi components, exact blank rows, output padding, thinking hide/show and resize, expanded tool gaps, streaming/history rebuild, foreign wrapper preservation, and all four mouse-coordinate expectations. Keep the source-shape rejection at :123–131. No production density or mouse behavior is proposed for removal.

### tests1-f3-04 — Drop an unexercised playback-harness knob and an implied loose bound

**Dead test-local option plus duplicate assertion; high confidence. Gross/net 3 lines.**

Evidence: tests/live-playback.test.ts:43 declares maxPendingBytes on the private harness override object and :52 forwards it. Every harness call in the completely read file uses either no options or send/flush overrides; none supplies this field. Remove those two lines. src/live/playback.ts:45 uses options.maxPendingBytes ?? MAX_PENDING_BYTES, so omitted and the current undefined are equivalent. Also remove tests/live-playback.test.ts:245: peak<1000 follows from :244's peak<=80+blockMs because the complete blockMs domain at :206 is [1,10,32], giving a maximum bound of 112.

Counterevidence: **do not remove the production budget option**. src/live/gpt-live-playback.ts:69 sets it to 9,600; tests/gpt-live-playback.test.ts:83–92 proves that budget fails closed. Keep tests/live-playback.test.ts:304–312's default overflow/error/reset assertions. Keep the tighter peak bound, zero-underflow, consumed-sample count and pending/error expectations (:239–247). The timer/feedback matrix is not label-only repetition: :227–237 changes native block consumption and report timing.

Behavior lost: unused private fixture customization and one weaker duplicate failure location; no exercised budget/queue/loss protection. Checks after implementation: offline live-playback and gpt-live-playback suites, especially matrix reserve bounds and both overflow paths. If future tests need a custom budget, add that setup when actually used rather than retain unused plumbing now.

### tests1-f3-05 — Remove one unused controls fixture construction and one implied error assertion

**Dead test-local setup plus duplicate assertion; high confidence. Gross/net 2 lines.**

Evidence: tests/remote-root-presenter.test.ts:84 creates f = fixture(), then never reads f; :85–94 uses a different RootControls instance. fixture (:7–51) only creates local arrays/objects/closures and its RootControls; the production constructor at src/remote/root-presenter.ts:86–90 has an empty body beyond parameter properties. Remove :84 only. Separately :197's rendered text contains permission denied is implied by :196's rendered text contains the complete ✗ execute — permission denied string with no intervening mutation. Remove :197, keeping :196.

Counterevidence: :83–95 must retain the unresolved-prompt/no-duplicate rejection, and :192–196 must retain error rendering. Other fixture invocations send real test commands into recorded arrays and are used. Do not delete the fixture itself or remove privacy/details/saved-answer/replay coverage on grounds of repeated strings.

Behavior lost: an unused allocation and a second assertion location, not either tested failure contract. Checks after implementation: remote-root-presenter suite, especially unresolved prompt rejection and error visibility with compact details toggled back off.

## Keep decisions and rejected reductions

| Assigned file | Verdict |
|---|---|
| tests/conversation-density.test.ts | Keep real Pi rendering/streaming/resize/mouse and wrapper lifecycle coverage; only share the tiny fixture mechanics in f3-03. |
| tests/remote-root-presenter.test.ts | Keep human control authority, private/default-vs-expanded output, typed task identity, unknown/adverse outcomes, saved history and aggregate evidence; remove only f3-05's two lines. |
| tests/herdr-agent-state.test.ts | Keep actual local socket integration, root/child authority, reload/quit ownership, ordered retries, prompt failures and bounded metadata; deduplicate mechanics via f3-02. |
| tests/typescript-runner.test.ts | Keep compiled execution and runtime-created package graphs; remove only f3-01's exact duplicate throw test. |
| tests/live-playback.test.ts | Keep frame preservation, timing/reserve feedback, stale-generation cancellation, flush failures, stop and visible overflow; f3-04 removes no strict protection. |
| tests/job-attention.test.ts | Keep; no sufficiently valuable removal established. Scheduler timing/state, service validation, raw reasoning exclusion and transient inspection recovery are distinct contracts. |
| tests/gpt-live-playback.test.ts | Keep; no safe distinct coverage deletion established. Speech/settling heuristics, bounded queue and hard-error behavior differ from generic scheduler tests. |

- Do not combine FakeClock in tests/job-attention.test.ts:13–35 with Clock in tests/live-playback.test.ts:4–35. The former jumps to final time before firing overdue callbacks; the latter moves through timer deadlines and supports timer lateness/stall. GPT pacing's manual clock at tests/gpt-live-playback.test.ts:104–145 deliberately fires an overdue batch at now=500. A shared clock that silently chooses one model changes timing proof.
- Job-attention's :48–78 and :198–225 look similar but are not assertion duplicates: the first checks quiet AND review batching, timer callback/scheduling counts, and no timer storm; the latter checks 5,000 writes and unchanged stateVisits plus exact retained timer size. Manager constructor/push pairs are also repetitive, but a helper would save only a handful of lines; no quantified extra saving is recommended. Keep shutdown ownership at :36–39.
- Do not erase deliberately adverse/private fixtures: remote-root-presenter.test.ts:200–218,324–364,482–548,550–594,649–665 exercise display:false, cancellation uncertainty, replay, omitted adverse outcomes and output-save warnings. Recovery and data-loss coverage is excluded from cuts, including repeated assertions at different event/snapshot/expanded paths.
- Generic playback and GPT wrapper interruption tests are not substitutes: live-playback.test.ts:274–303 tests flush gating/stale rejection, while gpt-live-playback.test.ts:148–175 adds the capture-triggered wrapper path. Hard-error tests at GPT :94–100 and :201–214 differ in quiet-capture duration and permanent non-recovery/error reporting.
- Runner manifest writes are repetitive, but manifest contents/export order, module format, directory layout, symlink canonicalization and dynamic roots are intentional inputs. A broad package fixture factory risks hiding those facts. No runtime fixture file is labeled unused, and no broad generated-file deletion is proposed.

## Optional small-feature cuts

**None recommended in these ranges under the stated constraints.** Optional candidates were considered, not assumed unused: native thinking/density rendering, expanded remote transcript details, Herdr reporting, attention snooze/watch, and GPT speech-settling playback. Each is actively wired above; the latter four also intersect human control, diagnostics, recovery or truthful adverse-state visibility. Deleting their tests alone would not cut a product feature and would erase required coverage. A product decision to retire one would need a separate production/caller audit and an explicit statement of lost behavior; zero optional-feature savings are included here. This does not overturn the original report's separate human-choice cuts in other files.

## Validation handoff

All checks listed per finding are **future checks, not performed checks**. First implement the smallest isolated test-only changes, preserve all cited counterevidence, inspect the actual diff/net line count, and run the seven focused offline files against an appropriately built binary when builds/tests are separately authorized. Shared socket refactoring deserves the most care; the exact runner duplicate and private unused option are the strongest low-risk cuts. No live/provider/remote-device acceptance is claimed or required by this source audit.
