# CI and release failure audit — 2026-10-05

Follow-up: [items 2 and 3 are now implemented and locally verified](../ci/ci-failure-pattern-followup-2026-10-05.md). Item 4 remains [proposal-only](../ci/cheap-checks-proposal-2026-10-05.md). The analysis below describes the pre-fix 9906f92e snapshot.

## What we checked

Read-only investigation of tnfssc/bruv. No tests weakened, product code changed, release started, rerun requested, or workflow setting changed. Current checkout is 9906f92e (v0.16.8 preparation).

Captured all 587 retained Actions runs returned by the repository API, created from 2026-09-05 23:12 UTC through 2026-10-05 18:13 UTC. Repository was created September 5. This covers the available run history, not deleted runs. Collection began October 5 around 18:19 UTC; results are a snapshot, not a live monitor. Checked failed-job logs, current workflow/test owners, prior repair notes, and relevant git changes.

Evidence: [summary](evidence/ci-history-2026-10-05/summary.json), [test signatures](evidence/ci-history-2026-10-05/test-signatures.json). Raw API metadata and compressed logs remain in the same local evidence folder. Collection scripts allow a fresh read-only capture.

## Counts

Counts use each run ID once and its latest conclusion. Failure rate below excludes cancellation, skip, and approval waits.

| Workflow | Success | Failure | Other | Failure rate |
| --- | ---: | ---: | ---: | ---: |
| CI | 254 | 81 | 29 cancelled; 1 action_required | 24.2% |
| Release | 148 | 42 | 4 cancelled; 1 skipped | 22.1% |
| Daily dependency PR | 4 | 4 | 0 | 50.0% (only 8 runs) |
| Native Live Lab (old workflow) | 5 | 4 | 0 | 44.4% (only 9 runs) |
| Native Live (current workflow) | 6 | 0 | 0 | 0% (only 6 runs) |
| Workflow-file failures (no jobs) | 0 | 2 | 0 | One ci.yml and one release.yml |
| Dependabot dynamic updates | 2 | 0 | 0 | 0% |
| **All** | **419** | **133** | **33 cancelled; 1 skipped; 1 action_required** | **24.1%** |

Of the 254 green CI runs, 249 have a successful full Linux lane; five historical docs/selected-feedback runs do not. These rates describe workflow outcomes, not per-test flake probability.

This is 133 failed runs, not 133 bugs. They span 104 distinct head SHAs. Twenty SHAs failed in more than one workflow. Repeated tags, pushes, manual dispatches, and both CI/release checking the same mistake inflate run totals.

Four runs passed on attempt 2 with unchanged SHA: CI 36309940829 and 36684947568; Release 35007325992 and 37219760308. Their earlier failures do not appear in the 133 latest-conclusion failures. This is direct evidence of run-dependent behavior in those four cases, not proof that every timeout is flaky.

CI policy failed 42 times as a downstream guard. Do not count it as 42 extra root causes. Its job is to block publication/merge after another check fails.

### Release is not the same as public publication

The Release workflow has historically also run develop dry runs:

| Trigger group | Success | Failure | Other |
| --- | ---: | ---: | ---: |
| Manual dispatch | 35 | 17 | 0 |
| Tag push | 49 | 8 | 2 cancelled; 1 skipped |
| Develop/other push dry run | 64 | 17 | 2 cancelled |

So **42 failed Release runs does not mean 42 broken public releases**. Even a failed tag/manual run may have safely blocked publication. A green historical dry run is not publication proof either. Separately, release notes record bugs in shipped startup paths despite green ordinary CI.

### Trend

CI failure share among success/failure runs: Sep 5–11: 17.6%; Sep 12–18: 10.9%; Sep 19–25: 23.0%; Sep 26–Oct 2: 28.9%; Oct 3–5: 28.8%. Recent failures are not merely an old bootstrap phase. But coverage, triggers, platform gates, and architecture changed within this month, so this is not a controlled code-quality trend.

## What the failed logs say

The non-Release study inspected 93 failed-job logs, including earlier attempts of recovered runs. Its primary groups sum to 93; they are job counts, not the 133 latest failed-run count:

| Primary log group | Jobs |
| --- | ---: |
| Format/JSON parsing | 16 |
| Type/Swift compilation | 6 |
| Dependency compatibility/notices | 5 |
| Build directory-as-file | 1 |
| Environment, fixture prerequisites, process setup | 16 |
| Assertion, UI, protocol, ordering, memory bounds | 32 |
| Timing-sensitive/intermittent (some unconfirmed) | 11 |
| Unresolved timeout/command/transport | 5 |
| Mixed independent signatures | 1 |

Only a subset of the 11 timing-sensitive jobs has equivalent same-SHA success evidence. Assertion failures can be real product bugs or wrong fixtures. This does **not** support “most CI is flaky; add retries.”

## What keeps recurring

### 1. Fixtures borrow machine state instead of owning it

This is the clearest cross-feature pattern. It is not one GitHub outage.

- **Eight failed runs** (four CI, four Release; four distinct SHAs) on September 26 hit the same annotated-tag fixture: **Committer identity unknown**. Developer global Git config hid the missing fixture identity. The repair configures the fixture itself and tests without system/global Git config.
- **Four macOS CI failures** tried to execute missing dist/die. A source-only lane was asked to test a compiled execute path. Later macOS had a separate missing tmux failure. The current lane and tooling setup have changed; these are historical setup failures, not four app crashes.
- **Four native release attempts** around v0.16.0 exposed an absolute /usr/bin/node assumption twice, a stale assertion after its first repair, and a developer-home SDK cache dependency. Current setup uses configured Node and downloads a pinned test-only SDK explicitly.
- **Two Mac updater gates** at v0.16.4 failed because the fixture compared /var/... with the updater's canonical /private/var/... path. Fault injection never fired. Production rollback was not broken. The fixture now canonicalizes the install path and requires proof the fault was injected.
- The **newest captured failure**, [37354320182](https://github.com/tnfssc/bruv/actions/runs/37354320182), is on t3code/buffer-live-recording, not develop. Linux and macOS both fail the same PCM conversion test because **ffmpeg is absent**. This is one run/two jobs, not two unrelated platform bugs. This branch added a real tool prerequisite without supplying it in CI.

**Lesson:** local setup is not an implicit test dependency. Provide the needed tool/input inside the fixture or workflow. Verify fault injection actually happened. Do not fix these by rerunning or lowering assertions.

### 2. Elapsed time and scheduler turns stand in for completion

Several unrelated suites repeat the same assumption:

- v0.2.7 goal test used sleep 0.1; a real job could finish before the expected waiting handoff. A controlled file gate fixed it without changing product behavior.
- v0.11.2 ledger test did 261 durable writes under Bun's default 5-second budget. It timed out and left work active for the next test. The repair seeds setup state while retaining real eviction/reopen/replay operations.
- **Four CI runs** hit startup grammar readiness after only 100 setImmediate turns; another startup-rebind failure shares that polling boundary but has a different symptom. Same-SHA pass/fail exists for a grammar case. Current c9da61d5 waits for actual loader completion. [37334395604](https://github.com/tnfssc/bruv/actions/runs/37334395604), merged develop CI [37334768191](https://github.com/tnfssc/bruv/actions/runs/37334768191), and Release [37334789088](https://github.com/tnfssc/bruv/actions/runs/37334789088) subsequently passed.
- v0.15.26 capability tests assumed 100ms was enough for durable publication, then removed their directory. A pending test also resumed after another test changed PATH to fake Git. Repairs join/drain owned work before restoring globals or deleting directories.
- **Five CI runs** failed the HTTP close test's settled/delete ordering. The fixture observed server cancellation, which is not the client's cleanup owner. The narrow repair observes client-reader cancellation and adds a controlled drain gate. A mutation removing the client's wait still fails the corrected test.

**Lesson:** wait for the event/state being tested, and finish child work before cleanup. Keep a bounded diagnostic deadline, but do not use a larger sleep as the proof.

### 3. The same test name can hide different problems

Across all captured failing logs, after removing duplicate failure-summary lines and counting each run once:

| Test/signature | Runs | What this does and does not show |
| --- | ---: | --- |
| real TUI /ps selects live jobs and only stops the confirmed target | 11 (9 SHAs) | September 14 through October 4. Includes startup/tool readiness, a test deadline, task-row/surface assertions. Not evidence of one eleven-time flake. |
| Manual release Git fixture | 8 (4 SHAs) | One deterministic missing-identity mistake propagated through pushes, CI and manual Release. |
| SDK bounded completion cycles | 6 (6 SHAs) | Some runs expect at most four calls and see five; later serial SDK-wrapper contamination is a different failure under the same name. |
| HTTP close settlement ordering | 5 (5 SHAs) | Repeated invalid observation boundary; owned-client fixture repair preserves real ordering checks. |
| Partial subagent spawn cleanup | 4 (2 SHAs) | Model fixture failed before reaching the intended second-spawn failure. Not a provider outage. |
| Narrow TUI collapsed rows/details | 4 (3 SHAs) | Actual captured-frame expectations fail. Do not call a UI assertion flaky just because it runs in a terminal. |

Two CI failures also used whole-process heap growth over 20 MiB as a scheduler retention assertion. GC and unrelated temporary allocations made that the wrong owner-level measurement. The repair checks bounded retained states, one timer, exact deadline batches and disposal instead of raising the heap limit. See [resource-test diagnosis](../resources/job-attention-heap-assertion.md).

These rows overlap other findings and must not be added into a total. The [signature inventory](evidence/ci-history-2026-10-05/test-signatures.json) includes exact run IDs. Some rows include an earlier failed attempt of a now-green run.

### 4. Cheap static failures keep reaching hosted gates

**23 failed run IDs across 16 SHAs** contain format/JSON-parse failures: 16 inspected CI jobs plus seven Release runs. Some are newly added research/proof files, not product code. A large Biome diagnostic count is still one failed job.

There are also real type/lint failures: two repeated dependency-updater unknown-type failures, a model-union mismatch, early PTY/Effect type errors, and v0.10.0 switch-case lint errors. These are not flaky tests.

Both workflow files were rejected before jobs at 4eab3c5e (36309583195/36309583805): runner.temp was used where the job-level env context did not allow it. YAML/text assertions did not check GitHub context legality. Repair moved path setup into a step. Current gate does not invoke actionlint.

**Lesson:** run cheap checks on the exact final changed tree. For workflow changes, use a GitHub-aware workflow checker, not only YAML parsing or substring tests. Do not bypass the required gate to save this time.

### 5. Dependency and workflow changes leave assumptions behind

Observed signatures include unsupported Pi host versions, adapter hashes, startup/license pins, old keyboard behavior, and tests expecting obsolete inline workflow commands. The Daily dependency PR has four failures out of only eight runs; two failed before tests on Pi compatibility checks for candidates 1.0.2/1.0.3.

These guards often did the right thing. A fail-closed SDK adapter stops an unreviewed upgrade. The mistake is treating version/lockfile edits as the whole upgrade. Current Pi 1.0.3 repairs review host files/patches, attribution, startup checks, and transcript scrolling keys together. Do not simply delete pins or accept every upstream hash.

Literal workflow tests also failed after legitimate Linux-only → multi-platform and source-only → compiled-lane changes. Move these checks toward the actual semantic contract (tools, inputs, permissions, ordering), not old command spelling. Keep exact values where identity/security really needs them.

### 6. CI and Release still exercise different test environments

Current shared Linux CI runs bun test --parallel=3 with an owned fresh TMPDIR. Release's deterministic test step runs bun test ./tests serially. Both differences can expose global state or fixture lifetime bugs.

v0.16.1 is a concrete example: partitioned CI passed, then serial Release inherited SDK wrappers from earlier suites. A projection-only SessionManager did not have getSessionId. Five disk-owning suites moved into fresh children; production runtime did not need a new fallback.

Historical differences also included shallow CI versus full-history Release and source-only macOS versus compiled Live execution. The old bundled-T3 migration owners are now deleted; do not restore their full-history prerequisite to cure a retired test.

**Lesson:** share the ordinary Linux test/environment contract. Keep Release's extra final-binary, external-T3, Mac updater and publication checks distinct. A green ordinary suite is not proof of those paths.

### 7. Some reds were valuable, and some important bugs were green

Real defects caught before publication include the disabled fast-mode path eagerly reading routing/model state (v0.15.29), early shipped-layer PTY type errors, and three September 30 browser gates hitting Tiptap view.dom before editor initialization. Fixing the product was right; retrying, ignoring console errors, or weakening guards was not.

Two particularly important **green-but-broken shipped experiences** are absent from the failure count:

- **v0.12.0 web Live:** ordinary CI and publication green, but the user found voice unusable and without needed model choice. Exact device/transport root cause was not established. The feature was removed in v0.12.1.
- **v0.15.12 browser startup:** publication green; the official binary served HTML but browser startup failed. Artificial vendor chunk groups broke cyclic module initialization. Browser boot/reload acceptance was added and then caught the separate Tiptap lifetime defect.

Bundled web/packed-web owners are now retired. Their cache/path/chunk fixes are history, not a request to rebuild that machinery. The principle still applies to today's paired binaries and external-T3 integration: test the shipped entry point. Device-free Live tests still cannot prove physical microphone, acoustic quality, permissions, or provider acceptance.

## Where Release failed

Latest-failed Release job steps, counted once per run, cover all 42 failures:

| Blocking step | Runs |
| --- | ---: |
| Deterministic tests | 16 |
| Format | 7 |
| External native acceptance | 3 |
| Final Linux browser boot/reload | 3 |
| Packed release-binary build | 2 |
| Mac updater probe | 2 |
| Publish | 2 |
| Native test dependency download/setup | 1 |
| Typecheck; lint; helper architecture text check; tag/version check; web backend validation; web sidecar build | 1 each (6) |

Only **two** failures reached the Publish step: a safe refusal when develop advanced, and a by-tag draft lookup returning 404 after creation. The latter was a publication-state bug, not a compile failure; later releases succeeding does not prove that exact old draft was recovered. Most Release reds were upstream gates doing their job.

## Recommended next work

This is an ordered shortlist, not permission to launch all fixes or a new test matrix.

1. **Fix the newest missing-ffmpeg prerequisite on its branch.** Decide whether that audio fixture should use a checked-in/generated PCM input or deliberately install/pin ffmpeg. Keep duration/silence assertions. Verify both existing lanes; do not mark the test skipped merely to make CI green.
2. **Stop sending cheap deterministic failures to GitHub.** Run format/lint/typecheck against the final changed files/tree before pushing. Add actionlint to workflow-change validation. Verify integration contains the actual repair commit, not just a neighboring worktree tip; the v0.15.3 repair initially missed its intended fix.
3. **Make CI and Release share the ordinary Linux test setup/command.** Own TMPDIR, tools and environment in one place. Preserve final-artifact gates and paid/device opt-ins. Prove this with the known serial-wrapper and delayed-cleanup fixtures, not a broad new scheduling matrix.
4. **Use the repeat offenders as a bounded fixture audit.** Check /ps/TUI startup, SDK completion, HTTP close, saved startup and capability cleanup at their real owner. Several already have narrow repairs; confirm current owners first. Keep product/UI assertion failures separate from timing/setup errors. Do not blanket-increase deadlines or add automatic retries.
5. **Keep dependency updates atomic at compatibility seams.** Review SDK adapters/patches, exact host checks, notices and changed fixture behavior in the same candidate. Preserve useful fail-closed guards. Linux candidate validation is not Mac or real-device acceptance.
6. **Keep targeted shipped-path acceptance and useful failure diagnostics.** Current final external-T3/paired updater checks are valuable. For new audio behavior, do the relevant real-device/provider acceptance separately. Preserve subprocess stderr, signal/status and test-owned logs; macOS CI currently lacks the Linux-style failure-artifact upload.

## Limits and pickup

No product tests were run for this analysis. Evidence comes from actual historical logs, captured API metadata, code inspection and recorded red/green repairs. The CI log study inspected 93 failed-job logs across 90 run IDs (CI, Daily dependency PR and Native Live Lab), including earlier failed attempts; counts/categories there are not the latest-conclusion run total. Release logs were inspected separately. Some timeout, transport and UI assertion causes remain unresolved; the evidence does not justify calling all of them flakes. CI 37119521778 has no jobs to diagnose. The two September 27 workflow-file failures also have no job logs; their cause is recorded in the cache repair note.

Three narrow research reports carry full source links and per-incident detail:

- [CI log classification](ci-history-log-research-2026-10-05.md)
- [Current workflow owners and retired gaps](ci-history-workflow-research-2026-10-05.md)
- [Release history and shipped regressions](ci-history-release-research-2026-10-05.md)

Evidence folder: wisdom/quality/evidence/ci-history-2026-10-05. Local raw metadata/logs are ignored; compact inventories, classifications and scripts are kept. See its README for recapture. Research used this shared workspace, not implementation worktrees. At audit completion, no implementation was underway. The later [implementation follow-up](../ci/ci-failure-pattern-followup-2026-10-05.md) records the shared runner, narrow fixture repairs and passing joined gate.

Values: strengthened value 2 with the repeated fixture-owner/completion lesson and linked this audit. Existing shipped-path and dependency-change values still apply; no new value was added.
