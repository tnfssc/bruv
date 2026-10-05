# CI log root-cause research — 2026-10-05

Research only. Read [values](../values.md); no production code or test changes. Scope: **CI, Daily dependency PR, Native Live Lab**. Release workflow failures are the parent's separate assignment; CI tests *about* Release configuration remain in this report.

## Evidence and count boundary

- Source: [compact run inventory](evidence/ci-history-2026-10-05/run-inventory.json) (full raw runs.json remains locally), failed-job metadata in that directory's jobs/, and gzip plaintext logs/<jobid>.log.gz. Snapshot analysis completed October 5, 2026, ~18:35 UTC.
- **93 unique failed-job gzip logs actually inspected, from 90 runs:** CI **85**, Daily dependency PR **4**, Native Live Lab **4**. These are not counts of all repository runs, passing tests, all historical failed attempts, or independent product defects.
- CI policy jobs are downstream outcome aggregation, **excluded from root-cause counts**. Repeated Bun suite-summary failure lines are deduplicated. Linux/macOS failures may be one prerequisite cause even though two job logs were inspected.
- Initial collector errors were “the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway.” I downloaded the assigned failure logs using that flag. The parent removed stale .error.txt files after successful downloads; the collector now clears them on success. A download error is not a CI failure.
- Python extracted bounded assertion/error contexts rather than dumping logs. [Extractor](evidence/ci-history-2026-10-05/extract-owned-failure-contexts.py) can reproduce available-log extraction; redirect its JSON stdout to a scratch file. [Classification JSON](evidence/ci-history-2026-10-05/owned-log-classification.json) records each inspected job, full SHA, attempt, exact failed test names, category, and short numbered evidence snippets.
- Successful same-SHA **job metadata** was additionally read under same-sha-jobs/; these are **not additional inspected log counts**. A head SHA match is not automatically identical PR merge checkout, event, optional steps, or provisioning.

## What the logs support

The central correction is **not “CI failures are mostly timeouts, so rerun or relax timers.”** Several recurring failures are concrete prerequisite, compatibility, type, formatting, and assertion failures.

| Primary grouping of inspected job logs | Jobs |
| --- | ---: |
| Format/JSON parsing | 16 |
| Type/Swift compilation | 6 |
| Dependency compatibility/notice generation | 5 |
| Build directory-as-file failure | 1 |
| Environment/build/fixture prerequisites or process failure | 16 |
| Assertion, UI, protocol, ordering, or memory bounds | 32 |
| Timing-sensitive/intermittent assertions (including one unconfirmed family) | 11 |
| Unresolved timeout/command/transport | 5 |
| Mixed independent signatures in one job | 1 |
| **Total inspected failed-job logs** | **93** |

“Timing-sensitive/intermittent” is **not a count of 11 proved harmless flakes**. Only some have equivalent same-SHA success evidence; actual missing-state/assertion regressions can be scheduling-dependent too. Memory bounds and HTTP close-order assertions are deliberately not reclassified as generic timing flakes.

### Highest-signal concrete findings

1. **Current October 5 paired-lane failure is missing ffmpeg.** Run **37354320182**, Linux job **111912851945**, macOS job **111912852160**: “PCM24 to PCM16 conversion preserves duration and adds an exact silence tail in memory” fails in fixtureCommand → naturalFixturePcm with “Executable not found in $PATH: ffmpeg”. No timeout, conversion assertion, Live device, or API failure occurred.
2. **Daily dependency candidates hit real compatibility/type gates.** September 30 run **36684110833** / job **109785906333**: update-dependencies.ts:80/81 TS2571 also occurs in CI run **36684110489** / job **109785894380**. October 4 **37200481788 / 111430970692** rejects Pi **1.0.2**; October 5 **37321109544 / 111800116876** rejects Pi **1.0.3** against adapter requirement **1.0.0**. Tests did not run past preparation.
3. **Native Live Lab failures were compile/packaging, not audio timing.** Three jobs have Swift type errors; opt-in candidate job **107326078271** fails notice generation for @esbuild/darwin-arm64@0.28.2. Its same-SHA passing push skipped candidate build, so it is not a flaky build rerun.
4. **macOS source-only Live lane repeatedly lacked the actual execute binary.** Jobs **107661852791**, **107690513979**, **107952969451**, **108160768696** fail spawning dist/die. Numerous Live ownership/cancel assertions are downstream of this one prerequisite. Later job **108383093462** instead lacks tmux; distinguish the causes.
5. **An exact SDK assertion is genuinely intermittent.** “real SDK print completion cycles pause within bounded agent runs”: expected calls ≤4, got 5. On SHA **9b7fd68aa7**, job **104024073899** explicitly logs that test **passing**, while job **104024080797** logs it **failing**. It recurs October 1 (**110369386497**) and October 4 (**111402568119**). This is nondeterministic continuation/accounting behavior, not a timeout to hide by raising a deadline.
6. **Startup grammar fixtures have a concrete readiness-budget weakness.** Their until() asserts after only **100 setImmediate turns**, not after awaited readiness or an elapsed-time contract (verified in the failing SHA c2be90ef fixture and current source). Jobs **111404311330**, **111410618172**, **111495938169**, **111842631686** miss grammars:ready after grammars:start; the first five-variant failure (**111394741289**) instead misses rebind:start. Same SHA **0345b41570** full Linux push succeeds before scheduled grammar failure, strengthening timing sensitivity for that case, not proving every variant harmless.
7. **Repeated failures with real assertions remain real assertions.** HTTP close test five times misses DELETE or orders it before settlement; memory checks exceed 20 MiB twice; 17 SDK tests in **110389979820** reject stale extension contexts; repeated migration tests refer to a path that Git explicitly says does **not exist in the historical commit**. These are not justified “flake” labels.

## Repeated names and same-SHA comparisons

The JSON gives every exact per-job name; the catalog below gives the union per signature. Important repeated-name splits:

- “real TUI /ps selects live jobs and only stops the confirmed target” is **not one root cause**: September 14 missing FIXTURE_READY amid tool download; September 21 a 20s deadline; October 1 missing failed-task terminal row; October 2 missing cancelled-task row; October 3/4 missing Inspect task_, ALPHA-live. Repeated name alone cannot establish repeated defect or flake.
- “close aborts initialize, waits for settlement, then deletes an acquired session” fails October 1/2 in **110228351010**, **110260473338**, **110402136874**, **110511978820**, **110598775365**. Early observations have delete=-1; later observations have delete=1, settled=2. This is lifecycle ordering/assertion evidence, not a 5s timeout.
- “manual release preparation > prepares version and notes in an isolated local git fixture without publishing” fails four times September 26 with **Committer identity unknown**, not four independent Release outages.
- “patched SDK startup: empty-stopped” fails October 4/5 with missing grammar readiness (**111495938169**, **111842631686**), while the five-variant startup run has a different earlier boundary.

### Same head SHA outcomes

These are separate run executions unless noted; metadata for successful equivalents is saved in same-sha-jobs/.

| SHA prefix / workflow | Compared runs | What comparison establishes |
| --- | --- | --- |
| bacac34b2e / CI | success **34019032179**, failure **34019032172 / 101448072475** | Same Linux lane; 200ms execute launch expires before task exists. Supported timing-sensitive launch fixture. |
| 11d77d4bfe / CI | success **34821145635**, failure **34821145938 / 103902773389** | Same Linux lane; startup/download readiness mismatch, not merely a timeout label. |
| 9b7fd68aa7 / CI | failures **34858460981 / 104024073899**, **34858462658 / 104024080797** | Different failing tests; first log explicitly passes exact SDK count test that second fails. Both runs fail overall, yet test-level nondeterminism is proved. |
| a93f175f98 / CI | **34070587557 / 101587069000**, **34070587967 / 101587070213** | Both fail same missing-model/expected-spawn-error fixture assertion; no passing equivalent. |
| 2a4c70b631 / CI | **35006659223 / 104508002950**, **35006663124 / 104508012521** | Both fail same literal Release-workflow test assertion. |
| 9abdc41015 / CI | push **35613927360 / 106379696616**, PR **35614002299 / 106379948074** | Both projection timeout; no passing equivalent and PR merge/event caveat. |
| d5ddd78f57 / CI | successful push **35616674459**, failed PR **35616678896 / 106389037925** | 20s /ps timeout is intermittent at head-SHA level; different PR merge checkout can matter. Root remains unresolved. |
| dae69061ae / Native Live Lab | push **35903523994 / 107325339909**, dispatch **35903548678 / 107325431385** | Both same Swift compilation error; not flake evidence. |
| 9e84c9ecaf / Native Live Lab | successful push **35903715022**, dispatch failure **35903739250 / 107326078271** | Push skips candidate-build step; dispatch executes it and fails license notice. Different coverage, not flakiness. |
| a349a8ad4f / CI | push **36840532890 / 110298418473**, schedule **36847796148 / 110322070188** | Both fail same task-row/UI surface checks. No passing equivalent. |
| 0345b41570 / CI | successful full Linux push **37192354896**, schedule failure **37193550461 / 111410618172** | Same full lane; grammar-readiness fixture intermittency supported. |
| df6471ccce / CI | successful full Linux push **37228407861**, schedule failure **37297354419 / 111721689684** | Failure is tmux new-session returning 1 after kill/reload. Does not prove an application questions assertion or its race cause. |

### Formal run-attempt reruns

Only two assigned-workflow run entries have run_attempt > 1: **36309940829** and **36684947568**, latest conclusion success, attempt 2. Direct attempt-1 endpoint for **36309940829** returns **two successful jobs** (**108593843016**, **108593843072**), not failed-first/passed-rerun evidence. Attempt-1 endpoint for **36684947568** returns **no jobs**; its earlier cause is unknown. The cached overall job listing only contained attempt-2 jobs for that run. **Do not claim either “rerun fixed a flake.”**

## Signature catalog

Each entry lists observed classification, exact signature, inspected run/job IDs and dates, and exact failed test names. A name list is the union for that signature's jobs; use JSON for precise per-job association. Empty test lists mean compilation/preparation/gate failure before a named test. Mixed-job entries deliberately retain multiple signatures.

### execute-launch-budget — timing-sensitive

**Observed:** 200ms outer execute expires before a job exists; TypeError reading task.status.

**Inspected:** **34019032172 / 101448072475** (2026-09-06).

Same SHA bacac34b has successful Linux run 34019032179. Missing task at a hard 200ms launch boundary supports a timing-sensitive fixture; not a shell-job cancellation regression proved by this log.

Exact tests:
- `canceling execute transfers notification ownership without killing its job`

### handoff-cleanup-message — assertion

**Observed:** Expected cleanup failed; received Error stack without message.

**Inspected:** **34061397044 / 101562451562** (2026-09-06).

Error evidence/assertion mismatch, not a timeout.

Exact tests:
- `handoff unwinds cleanup but does not swallow cleanup errors`

### subagent-model-fixture — assertion

**Observed:** Expected second spawn failed; received No model is available for the sub-agent.

**Inspected:** **34070587557 / 101587069000** (2026-09-07); **34070587967 / 101587070213** (2026-09-07); **34070608639 / 101587127164** (2026-09-07).

Repeated fixture/model-selection failure on September 7, including identical-SHA duplicate runs. No provider outage is established.

Exact tests:
- `partial subagent spawn failure stops and notifies already-launched workers`

### format-and-json-parse — format

**Observed:** Biome formatter diffs / JSON parse errors; format:check exits 1.

**Inspected:** **34119189282 / 101733021188** (2026-09-07); **35701200827 / 106659699257** (2026-09-22); **35902056499 / 107320448033** (2026-09-23); **35905027869 / 107330445083** (2026-09-23); **35988433617 / 107596494317** (2026-09-24); **36246843468 / 108417501380** (2026-09-26); **36299415065 / 108564171346** (2026-09-27); **36299914699 / 108565541093** (2026-09-27); **36300634714 / 108567498640** (2026-09-27); **36301504562 / 108569868230** (2026-09-27); **36702382092 / 109844592627** (2026-09-30); **36702551277 / 109845129624** (2026-09-30); **36867656383 / 110387198138** (2026-10-01); **37186688466 / 111390017769** (2026-10-04); **37186756720 / 111390227928** (2026-10-04); **37210353063 / 111460138621** (2026-10-04).

Deterministic style/syntax gate failures, including research artifacts. The October 4 vesper-theme.json run reports 301 diagnostics; this is one failed job, not 301 causes.

Named failing test: **none** (failed preparation/compile/check step).

Examples: prompts/provider fixture formatting; unformatted experiments/t3-v2 files (21 reported diagnostics); questions source and TUI fixtures; remote source/fixtures; wisdom/tasks-ui latency JSON; wisdom/landing-page/writing-sources/vesper-theme.json parse errors. Diagnostic paths per job are in JSON.

### tui-startup-readiness — timing-sensitive

**Observed:** FIXTURE_READY absent; actual terminal is downloading fd/ripgrep and says Startup is still in progress.

**Inspected:** **34821145938 / 103902773389** (2026-09-14); **34858460981 / 104024073899** (2026-09-14).

September 14 same SHA 11d77d4b has a successful Linux execution 34821145635. Real startup dependency/readiness timing is observed, not an arbitrary generic timeout.

Exact tests:
- `real TUI /ps selects live jobs and only stops the confirmed target`

### sdk-extra-continuation — intermittent-assertion

**Observed:** Expected at most 4 model calls; received 5.

**Inspected:** **34858462658 / 104024080797** (2026-09-14); **36862326414 / 110369386497** (2026-10-01); **37190862525 / 111402568119** (2026-10-04).

Exact same test passes in job 104024073899 and fails in job 104024080797, both SHA 9b7fd68aa7. Intermittent assertion, with recurrence September 14, October 1 and October 4; not simply a test timeout. Continuation accounting/order needs investigation.

Exact tests:
- `real SDK print completion cycles pause within bounded agent runs`

### release-workflow-fixture — assertion

**Observed:** Expected literal Linux baseline build command; workflow now Linux and macOS release.

**Inspected:** **35006659223 / 104508002950** (2026-09-15); **35006663124 / 104508012521** (2026-09-15).

CI test of Release configuration, not a failing Release workflow; same-SHA duplicate failures.

Exact tests:
- `release automation > tag release is version-gated and limited to Linux x64`

### web-projection-timeout — timeout-unresolved

**Observed:** projection timeout: thread:integrated-real-parent.

**Inspected:** **35613927360 / 106379696616** (2026-09-21); **35614002299 / 106379948074** (2026-09-21).

Same SHA 9abdc41015 fails both push and PR. Do not classify a repeated missing projection as a timing flake without a demonstrated successful equivalent execution.

Exact tests:
- ` src/orchestration-v2/NativeDieIntegration.production.test.ts > integrated real upstream orchestration > uses scoped HTTP MCP through PiAdapterV2 and actual Die with idempotent child spawn and cancel`

### task-monitor-20s-timeout — timeout-unresolved

**Observed:** real TUI /ps test reaches its 20000ms test deadline.

**Inspected:** **35616678896 / 106389037925** (2026-09-21).

Same head SHA d5ddd78f57 push succeeds while PR fails; event/merge checkout differences prevent this alone proving a flake. Log does not establish the stalled operation.

Exact tests:
- `real TUI /ps selects live jobs and only stops the confirmed target`

### web-child-credential — assertion

**Observed:** Expected Boolean(childCredential) true; received false.

**Inspected:** **35688934797 / 106621603556** (2026-09-22).

Production integration assertion at NativeDieIntegration.production.test.ts:602, not a timing classification.

Exact tests:
- ` src/orchestration-v2/NativeDieIntegration.production.test.ts > integrated real upstream orchestration > uses scoped HTTP MCP through PiAdapterV2 and actual Die with idempotent child spawn and cancel`

### scheduler-heap-threshold — performance-assertion

**Observed:** Heap growth exceeds 20971520 bytes: 28992151 and 34446931.

**Inspected:** **35834340691 / 107094157783** (2026-09-23); **36106720762 / 107980811601** (2026-09-25).

Repeated September 23/25 exact memory bound failure. Runtime/GC variation is possible, but neither a leak nor a harmless flake is proven.

Exact tests:
- `noisy activity is O(events), not O(jobs times events), in scheduler CPU and memory state`

### swift-int32 — compile-type

**Observed:** main.swift:143 cannot convert Int to expected Int32.

**Inspected:** **35902056407 / 107320447934** (2026-09-23).

Compilation fails before helper self-test; no test failure name exists.

Named failing test: **none** (failed preparation/compile/check step).

### swift-dispatchtime — compile-type

**Observed:** main.swift:200 DispatchTime inference / uptimeNanoseconds UInt64 mismatch.

**Inspected:** **35903523994 / 107325339909** (2026-09-23); **35903548678 / 107325431385** (2026-09-23).

Same SHA dae69061ae push and dispatch both fail compilation. Deterministic Swift typing failure, not audio hardware or scheduling.

Named failing test: **none** (failed preparation/compile/check step).

### native-license-notice — build-dependency

**Observed:** @esbuild/darwin-arm64@0.28.2 has no packaged or curated LICENSE, COPYING, or NOTICE file.

**Inspected:** **35903739250 / 107326078271** (2026-09-23).

Opt-in build candidate fails generateThirdPartyNotices. Same-SHA push succeeds because candidate-build step was skipped: not a flake.

Named failing test: **none** (failed preparation/compile/check step).

### macos-missing-execute-binary — environment-build

**Observed:** ENOENT posix_spawn dist/die in actual execute runner.

**Inspected:** **36008226396 / 107661852791** (2026-09-24); **36016568821 / 107690513979** (2026-09-24); **36097573940 / 107952969451** (2026-09-25); **36162060645 / 108160768696** (2026-09-25).

September 24/25 macOS source-only lane lacks compiled execute child. Many downstream Live assertions share this prerequisite cause.

Exact tests:
- `execute live.stop uses the actual scoped host route, and does not route to jobs`
- `stopWork helper response is acknowledged before scoped foreground cancellation`
- `main Live owns first-turn instructions, actual execute and background completion without spawning text model`
- `Live first turn applies production context and before/after tool hooks; typed route cannot steal owner`
- `Live close releases exclusive owner; interruption does not cancel an asynchronous job`
- `explicit jobs.stopWork cancels only isolated fixture work and does not run the text model`
- `real live.stop helper returns after teardown without self-cancelling execute or background jobs`
- `unfinished ASR is revoked at turn boundary, interruption and close; a new final utterance admits tools`
- `ordinary branch appends keep Live authority, duplicate tool calls do not replay side effects`
- `Gemini adapter direct function call executes real shell and receives async completion on its voice wire`
- `stop voice then stop work in one real execute still cancels the draining voice foreground after its report`

### macos-lane-config-tests — assertion

**Observed:** Tests expect prepare:assets/source-only lane; gate now builds compiled Live binary.

**Inspected:** **36162937859 / 108163679806** (2026-09-25).

Three CI/config fixture assertions disagree with a changed runner; not three runtime Live failures.

Exact tests:
- `macOS Live CI prepares source CLI assets without building the web runtime`
- `macOS lane runs only its device-free source and Live checks`
- `release automation > macOS Live CI checks native runtime without opening devices or using credentials`

### live-trust-prompt-fixture — assertion-unresolved

**Observed:** Missing/No Trust project folder?; fixture loaded but expected trust prompt absent.

**Inspected:** **36234271598 / 108383093339** (2026-09-26).

Three Linux terminal checks fail on expected surface after bounded polling; do not infer a timing flake from elapsed ~8.4s.

Exact tests:
- `Live picker real terminal 80 columns`
- `Live picker real terminal 120 columns`
- `GPT streaming keeps passive JSON in history but renders only the bounded Live transcript widget`

### macos-missing-tmux — environment

**Observed:** Executable not found in PATH: tmux.

**Inspected:** **36234271598 / 108383093462** (2026-09-26).

Three tests share missing terminal harness dependency; no model API or Live provider failure.

Exact tests:
- `GPT streaming keeps passive JSON in history but renders only the bounded Live transcript widget`
- `Live picker real terminal 80 columns`
- `Live picker real terminal 120 columns`

### picker-width-clipping — assertion-ui

**Observed:** Expected gpt-live-1 · OpenAI · key configured; captured row ends at key.

**Inspected:** **36238139467 / 108393585984** (2026-09-26).

80-column clipped label observed; 120-column sibling passes. Rendering/fixture width mismatch, not key configuration outage.

Exact tests:
- `Live picker real terminal 80 columns`

### git-fixture-identity — environment-fixture

**Observed:** Committer identity unknown; git exits 128 instead of 0.

**Inspected:** **36248821923 / 108423114588** (2026-09-26); **36248996775 / 108423379855** (2026-09-26); **36249807680 / 108425596703** (2026-09-26); **36249818642 / 108425627410** (2026-09-26).

Four CI fixture failures on September 26. Not actual publication or remote Release failures.

Exact tests:
- `manual release preparation > prepares version and notes in an isolated local git fixture without publishing`

### dependency-script-unknown-type — type

**Observed:** update-dependencies.ts:80/81 TS2571 Object is of type unknown.

**Inspected:** **36684110489 / 109785894380** (2026-09-30); **36684110833 / 109785906333** (2026-09-30).

CI and Daily dependency PR hit identical source type errors on the same SHA. Not dependency network availability.

Named failing test: **none** (failed preparation/compile/check step).

### ci-runner-fixture-127 — command-unresolved

**Observed:** Linux runner fixture returns 127 instead of 0.

**Inspected:** **36774743001 / 110089820239** (2026-09-30).

Command/prerequisite failure signature; the suppressed child output does not identify which command. No timing evidence.

Exact tests:
- `Linux runs all ordered gates in the pinned web checkout with deterministic tests`

### web-tree-directory-read — build

**Observed:** Directories cannot be read like files: .cache/.../.claude/skills.

**Inspected:** **36775922476 / 110093752046** (2026-09-30).

Web source/archive hashing reads a directory as a file; not test timing.

Named failing test: **none** (failed preparation/compile/check step).

### parallel-gate-mixed — mixed

**Observed:** Bun 5s deadlines; pnpm --version reuse error; attention/completion dedup assertions; web duplicate child assertion.

**Inspected:** **36780027410 / 110107723258** (2026-09-30).

Separate observed failures in one job: four 5000ms tests, two wakeup assertions, and Vitest child-count assertion. Do not reduce the whole job to a flake or pnpm cause.

Exact tests:
- `native pagination preserves every phase with empty native and SSH sources`
- `one verified packing supports four compile targets without touching archive or mutable dist`
- `attention and a racing completion produce one deduplicated parent wakeup`
- `mixed completion and attention reserve bounded evidence for both`
- `shell defaults to a three-second foreground budget; zero wait and timeout stay independent`
- `CLI-only edits do not change web content key or invalidate reuse`
- ` src/orchestration-v2/NativeDieIntegration.production.test.ts > integrated real upstream orchestration > uses scoped HTTP MCP through PiAdapterV2 and actual Die with idempotent child spawn and cancel`

### http-close-order — assertion-order

**Observed:** delete absent (-1), or delete before settled (1 versus 2).

**Inspected:** **36818360286 / 110228351010** (2026-10-01); **36828791812 / 110260473338** (2026-10-01); **36872054281 / 110402136874** (2026-10-01); **36904440793 / 110511978820** (2026-10-01); **36930539074 / 110598775365** (2026-10-01).

Exact close/initialize test recurs October 1/2 across five jobs. Lifecycle/order assertion regression/race is observed; not a timeout and no equivalent passing rerun demonstrated.

Exact tests:
- `close aborts initialize, waits for settlement, then deletes an acquired session`

### task-row-ui-mismatch — assertion-ui

**Observed:** Expected failed/cancelled task row missing from captured terminal.

**Inspected:** **36840532890 / 110298418473** (2026-10-01); **36840408373 / 110298480692** (2026-10-01); **36847796148 / 110322070188** (2026-10-01); **36859208698 / 110359593555** (2026-10-01).

October 1 repeats collapsed/detail and /ps surface assertions across four jobs; same SHA a349a8ad4f fails push and schedule. Do not count the repeated suite summary twice.

Exact tests:
- `real TUI shows one-line collapsed execute/task rows and expandable details at small width and on failure`
- `real TUI /ps selects live jobs and only stops the confirmed target`

### pi-sessionmanager-guard — dependency-compatibility

**Observed:** Unsupported Pi SessionManager: review disk-backed history adapter before updating Pi.

**Inspected:** **36863592468 / 110373513410** (2026-10-01).

Compatibility guard rejects actual package layout; not a flaky SDK test.

Named failing test: **none** (failed preparation/compile/check step).

### pi-stale-context — dependency-assertion

**Observed:** This extension ctx is stale after session replacement or reload.

**Inspected:** **36868326217 / 110389979820** (2026-10-01).

17 Bun tests fail against pinned SDK context lifetime rules. One compatibility/fixture signature across many test names, not 17 unrelated timing flakes.

Exact tests:
- `SDK provider pipeline records only the calling agent and survives disk resume`
- `payload rejection before fetch does not reset the estimate`
- `successful terminal observation covers transports without an HTTP hook`
- `actual SDK HTTP hook does not record rejected responses`
- `fresh compacts current transformed conversation without a warm capture`
- `uncaptured-tool-results compacts current transformed conversation without a warm capture`
- `changed-prefix compacts current transformed conversation without a warm capture`
- `automatic compacts current transformed conversation without a warm capture`
- `empty-context compacts current transformed conversation without a warm capture`
- `real offline assembly changes only messages across goal set, update, and clear`
- `real SDK reconciles helper waiting through task-complete and completes`
- `real SDK print completion cycles pause within bounded agent runs`
- `real SDK print completion cycles accept distinct explicit milestones`
- `fresh compaction prepares the frame and redacted context for a later custom multi-tool turn`
- `real SDK /shake preserves native checkpoint exactly once, kept tail, post-checkpoint prose and disk reopen`
- `SDK active-boundary semantics omit older retained checkpoints without losing their journal bytes`
- `native Codex real SDK: auth, Astra checkpoint to Sol, repeat, disk resume, and provider guard`

### scoped-completion-update — assertion-order

**Observed:** Expected completed task update; received [].

**Inspected:** **36874686991 / 110411039650** (2026-10-01).

Owner dispatch completion-notification assertion; race is possible, not established harmless flakiness.

Exact tests:
- `actual TaskManager + JobService dispatch stays within owner`

### herdr-epipe — transport-unresolved

**Observed:** write EPIPE in stalled socket/final working-state test.

**Inspected:** **36889019440 / 110459719040** (2026-10-01).

Broken-pipe transport failure; source-level cause not established by log.

Exact tests:
- `built-in Herdr agent state > stalled sends preserve wire sequence order and the final working state`

### model-literal-type — type

**Observed:** native-fast-mode.test.ts:147 TS2345 gpt-5.3-codex absent from accepted model union.

**Inspected:** **36899822725 / 110496023137** (2026-10-01).

Compile-time model catalog/fixture mismatch.

Named failing test: **none** (failed preparation/compile/check step).

### live-rendering-and-cancel — assertion

**Observed:** stopWork promise resolves instead of rejecting; ToolExecutionComponent renders spinner instead of tool content.

**Inspected:** **36913111305 / 110540505892** (2026-10-01); **36913111305 / 110540505933** (2026-10-01).

Identical three Live assertions on Linux and macOS same SHA; Linux also has ctx.sessionManager.getBranch missing, EPIPE, and task-row mismatch. Not platform-only timing.

Exact tests:
- `stopWork helper response is acknowledged before scoped foreground cancellation`
- `direct Live main owner > owns actual Pi registered execute and final root/project/hook instructions without streaming text`
- `direct Live main owner > production Live events render through pinned ToolExecutionComponent and execute renderers`
- `execute handoff notice: error`
- `built-in Herdr agent state > real background jobs keep Herdr working across foreground and staggered completion`
- `built-in Herdr agent state > replacement owns reporting and stale runtime quit cannot release it`
- `built-in Herdr agent state > quit drops queued working before release when a socket is stalled`
- `real TUI /ps selects live jobs and only stops the confirmed target`

### typed-error-evidence — assertion

**Observed:** Typed background launch throws Execution failed; exitCode details expected 7 but undefined.

**Inspected:** **36915876034 / 110549689518** (2026-10-01).

Typed execute result/error evidence regression signature, not a timeout.

Exact tests:
- `typed background launches survive outer execute error with durable call ownership and real terminal updates`
- `real SDK tool execution preserves structured failure evidence instead of dropping details in a throw`

### historical-git-fixture — environment-fixture

**Observed:** git show 92f1f2bc543ef148a5d254c20c95e6ba8b9aa4be:integrations/t3/upstream/bruv.patch fails.

**Inspected:** **37010450058 / 110848723178** (2026-10-02); **37014485451 / 110861979912** (2026-10-02); **37016177565 / 110867588620** (2026-10-02).

Git stderr explicitly says the path exists on disk but not in the historical commit. This is an obsolete historical path assumption, not evidence of a shallow-checkout missing object.

Exact tests:
- `migration gate rejects an override differing from the shipped patch before copying fixtures`
- `migration gate accepts the historical patch checksum but rejects an unrelated production HEAD before copying fixtures`

### tmux-restart — environment-process-unresolved

**Observed:** tmux new-session immediately after kill-session exits 1.

**Inspected:** **37066171522 / 111034835697** (2026-10-02); **37297354419 / 111721689684** (2026-10-05).

Different cost-footer/question TUI tests hit the same restart operation. Teardown/start race is plausible but tmux stderr is not recorded here; do not claim confirmed timing flake.

Exact tests:
- `real footer includes nested costs, updates while idle, and restores on resume`
- `real TUI keeps questions near composer after progress, cancellation and reload`

### ssh-fixture-and-footer — assertion-fixture

**Observed:** TypeError evaluating value.replace (undefined) in SSH fixture; terminal footer row distance 1 instead of 2.

**Inspected:** **37143983695 / 111264087870** (2026-10-03).

Nine SSH placement tests share one missing fixture value; one independent footer geometry assertion. No SSH destination/provider outage is established.

Exact tests:
- `SSH uses normal async launch with destination profile and honest snapshot workspace, no laptop model`
- `role/depth is validated before placement and SSH never permits child orchestrator escalation`
- `unknown launches retain a durable task ID; retries and batches never duplicate; other sessions cannot steal`
- `changed retry intent is rejected even while the earlier outcome is unknown`
- `reserved SSH host local has one authorized alias; literal local never selects SSH`
- `omitted and explicit local target preserve local launch/wait/model, even with a pinned SSH host`
- `unconfirmed repository preparation exposes the same reserved identity on retry`
- `explicit destination model/thinking overrides reach named placement and never silently affect local launches`
- `normal task titles survive placement in cached progress`
- `real terminal prompt/footer adjacency: regular`

### task-inspect-surface — assertion-ui

**Observed:** Missing Inspect task_, ALPHA-live in frame.

**Inspected:** **37144539047 / 111265693594** (2026-10-03); **37184257701 / 111382856441** (2026-10-04).

Repeated /ps actual surface failure October 3/4, distinct from initial startup readiness and failed-row signatures.

Exact tests:
- `real TUI /ps selects live jobs and only stops the confirmed target`

### native-gate-step-position — assertion

**Observed:** Expected next workflow step run-native-release-gate.mjs; received binary smoke commands.

**Inspected:** **37182775319 / 111378542156** (2026-10-04).

Brittle ordered workflow assertion in CI, not failed native Release gate execution.

Exact tests:
- `external native release gate setup keeps verified upstream layout and env handoff`

### startup-rebind-budget — timing-sensitive-unconfirmed

**Observed:** All five patched SDK startup variants miss rebind:start.

**Inspected:** **37188229505 / 111394741289** (2026-10-04).

Fixture until() polls only 100 setImmediate turns. Logs stop after colors:wait/render:request, with no managed-tool events. Scheduling/tool readiness is the boundary; no successful same-SHA run captured for this instance.

Exact tests:
- `patched SDK startup: saved`
- `patched SDK startup: saved-ready`
- `patched SDK startup: empty`
- `patched SDK startup: empty-stopped`
- `patched SDK startup: rebind-error`

### openai-execute-json — assertion-protocol

**Observed:** JSON Parse error: Unexpected identifier undefined.

**Inspected:** **37189627215 / 111398951448** (2026-10-04).

Offline main execute test parses undefined after waiting for a result. No live provider/API call; underlying missing-result cause remains unresolved.

Exact tests:
- `OpenAI GA offline protocol > direct main execute receives external root prompt and bounded result`

### footer-append-invalidation — assertion

**Observed:** append invalidates: 0 !== 1.

**Inspected:** **37189939505 / 111400056774** (2026-10-04).

Request projection cache invalidation assertion, not timeout.

Exact tests:
- `request projection seeds numeric usage for the whole footer independent of routed limits`

### startup-grammar-budget — timing-sensitive

**Observed:** Patched SDK startup missing grammars:ready after grammars:start; child exits 1.

**Inspected:** **37191433942 / 111404311330** (2026-10-04); **37193550461 / 111410618172** (2026-10-04); **37222631866 / 111495938169** (2026-10-04); **37333558132 / 111842631686** (2026-10-05).

100 setImmediate poll bound can finish before grammar async readiness. SHA 0345b41570 has successful full Linux run 37192354896 and failing schedule 37193550461. Other variants recur October 4/5; no same-SHA pass captured for every occurrence.

Exact tests:
- `patched SDK startup: empty`
- `patched SDK startup: saved-ready`
- `patched SDK startup: empty-stopped`

### daily-pi-host-version — dependency-compatibility

**Observed:** Unsupported Pi host version 1.0.2 / 1.0.3; adapter requires 1.0.0.

**Inspected:** **37200481788 / 111430970692** (2026-10-04); **37321109544 / 111800116876** (2026-10-05).

Daily candidate package compatibility failure during prepare:assets, before tests.

Named failing test: **none** (failed preparation/compile/check step).

### ffmpeg-fixture-prerequisite — environment

**Observed:** Executable not found in PATH: ffmpeg in fixtureCommand -> naturalFixturePcm.

**Inspected:** **37354320182 / 111912851945** (2026-10-05); **37354320182 / 111912852160** (2026-10-05).

Same natural-audio test fails Linux and macOS at the first subprocess launch. Reinstalling test timers or rerunning does not supply ffmpeg.

Exact tests:
- `PCM24 to PCM16 conversion preserves duration and adds an exact silence tail in memory`

### web-guidance-copy — assertion

**Observed:** Expected external, unmodified T3; received Bruv + T3 Code setup guide with different wording.

**Inspected:** **37219289504 / 111486188196** (2026-10-04).

Two standalone help/guidance assertions fail on exact text; both executables return successfully. Not external T3 environment failure.

Exact tests:
- `compiled web guidance does not launch overrides or modify existing CLI/Claude/T3 state`
- `standalone executable gives external setup without Node, Bun, T3 or sidecar on PATH`

## Lessons and limits

- Provision actual offline-fixture prerequisites (compiled execute child, tmux, ffmpeg, Git identity), rather than skipping assertions or substituting unrelated fixtures.
- Await observable readiness for async startup. A fixed count of event-loop turns is not a duration or completion guarantee. Preserve ordering/assertion checks; changing a wait is not proof a missing state is correct.
- Treat dependency upgrades as compatibility work: Pi host/version/session/context guards and model-catalog types provide concrete upgrade blockers; license notices are a build acceptance requirement.
- UI/terminal failures need their actual frame and operation: initial readiness, clipped labels, task-row render contract, and tmux restart are distinct even under the same test name.
- Keep policy fan-out, paired-lane prerequisite failures, duplicate suite summaries, and repeated runs out of independent-cause counts. This report does not establish resolution commits, whole-history flake rates, or root mechanisms for unresolved projection/timeouts/EPIPE.

**Wisdom changed:** this research note, reproducible extractor, and evidence classification were added. **Values unchanged:** the findings reinforce existing honest evidence, real-path tests, compatibility awareness, and simple observed-problem fixes; they do not warrant another general value. No production/test edits or speculative fixes were made.
