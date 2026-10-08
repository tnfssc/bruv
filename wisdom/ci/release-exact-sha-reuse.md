# Release verification reuse

## Scope and ownership

Optimization only; v0.9.0 has already been published at develop 5f83446 (task_d44fa40b). No action, dependency, or tool version updates: dependency task4ea502d3 owned those; PR #4 merged during continuation. Its workflow pins and tool versions were retained while resolving the overlapping merge.

Original integration worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_603c4a8f

Continuation worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_775d42b1

Original branch: die/optimize-ci-and-release-duration-in-sepa-603c4a8f

Continuation branch: die/finish-saved-ci-optimization-pr-775d42b1

Implementation worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_603c4a8f-a86675007a5e-task_7b9c128c

Implementation branch: die/implement-release-reuse-optimization-7b9c128c

## Decision

Measure the critical path, not just test count. Moving tests out of release does not by itself eliminate work or reduce the wait. CI and Release currently select different upstream tests; treating an ordinary CI success as equivalent release proof would drop coverage. Prefer reuse of fully verified release assets over a new test orchestrator or cache of “success”. Exact commit identity also binds source, lockfiles, workflow, pinned tools, and patches; no partial-key build cache is needed.

## Values review

Read values and CI/release wisdom before implementation. Keep actual built-artifact proof, say what measurements do and do not show, retain one clear source of verification, protect unrelated release/dependency work, and choose the smallest useful change. Existing values cover this lesson; no values edits needed.

## Baseline evidence (2026-09-24)

Fetched successful runs with `gh run list --workflow release.yml --status success` and `gh run view RUN_ID --json jobs`

Step durations are completedAt minus startedAt; wall durations include scheduling. These are old-workflow observations, not measurements of this change.

| Run | Wall | Relevant steps |
| --- | --- | --- |
| [CI develop c5b6101](https://github.com/tnfssc/die/actions/runs/35910725281) | 8m27s | build 205s, backend tests 43s, deterministic tests 91s, smoke 135s |
| [CI develop 39ebe0f](https://github.com/tnfssc/die/actions/runs/35909683066) | 8m52s | build 205s, smoke 136s |
| [Release v0.8.2](https://github.com/tnfssc/die/actions/runs/35956568739) | 12m25s | Linux job 626s: build 204s, tests 93s, smoke 134s, cross-builds 73s, backend validation 45s, asset upload 23s; actual Mac gate 36s; publish 29s |
| [Release v0.8.1](https://github.com/tnfssc/die/actions/runs/35914454067) | 12m57s | Linux job 629s: build 203s, smoke 130s; actual Mac gate 71s |
| [Release v0.8.0](https://github.com/tnfssc/die/actions/runs/35911787187) | 11m39s | Linux job 557s: build 189s, smoke 109s; actual Mac gate 55s |

The clearest local waste is smoke.sh rebuilding dist/die after the same job already built it. Reusing that binary retains the smoke assertions and exact job/checkout provenance. The observed smoke step is 109–136 seconds, an upper bound on savings; expect most of that to disappear because the build dominated, but the remaining smoke checks still take time. Measure actual savings on hosted runs. No cross-run cache is needed for this saving. Reuse of successful develop release assets additionally removes the repeated full tag build/test job; download/staging and retained native smoke still cost time. Do not sum runner time and wall latency, or claim new timings before hosted runs.

Smoke worker worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_603c4a8f-a86675007a5e-task_7ed7fcf0; branch: die/remove-same-job-smoke-rebuild-7ed7fcf0.

## Integration and tradeoff

Recovered three commits and the original uncommitted push/develop provenance corrections without changing the original worktree. `CI-REVIEW-DIRECTION.md` in the implementation worker worktree requested reasoning rather than moving tests; it is coordination only, not committed. The release workflow is push-triggered on develop and tags; no invented manual dispatch. Successful develop release runs stage assets with the prospective version tag in SOURCE.txt. Tag runs reuse only a same-repository, successful develop push release run at the identical 40-character commit SHA, with one nonempty unexpired asset artifact; downloaded binaries must pass recorded SHA-256 checks and source/tag metadata checks. API failure, expired/missing artifact or wrong provenance falls back to the full release gates. The tag still exercises the actual packaged Mac updater/helper and waits for it before publication.

Tradeoff: same-job smoke reuse is a small, local change; cross-run reuse adds a lookup, extra artifact transfer and job-condition complexity. It is worthwhile when a tag points to an already fully validated develop SHA, but gives no saving if the artifact expired or the release SHA differs. Expected tag latency improvement is avoiding most of the historical 9–10 minute Linux release job, **not** a measured new wall time; transfer/staging and Mac smoke remain. No hosted run of this branch yet. PR #4 supplied action/tool upgrades; this PR carries them only via the develop merge and uses the same immutable pins for new jobs. Local full build succeeded; local full suite before resolving the develop merge reported 875 pass, 15 skip and 11 fail (10 unrelated job-bridge assertions polluted by mise untrusted-worktree startup diagnostics, 1 workflow pin assertion caused by PR #4 merging mid-run). After reconciliation, focused release/smoke/workflow tests pass 19/19. Smoke reuse invocation passed on built binary. Hosted CI must still validate the entire merged state.

## 2026-09-30 follow-up

See [current speedups and measured baseline](speedups-2026-09-30.md). Download stores now have tool/OS/arch-scoped restore prefixes (never compiled or patched state); exact-SHA reuse also supports manual releases at the **prepared** commit, not dispatch head. Final Linux browser boot/reload remains mandatory with a cached pinned headless-only harness and missing-library dependency fallback. Gains remain conditional; no new hosted timing has been claimed.

## 2026-10-08: ordinary gate reuse, not release asset reuse

The current workflow no longer has the historical cross-run release-asset
reuse implementation above. The surviving CI lookup, find-ci-baseline.ts,
finds an ancestor for docs classification; it is not release admission proof.
Do not use an ancestor or a docs-only successful CI policy to skip Release tests.

Release now uses scripts/find-release-ci.ts against the prepared RELEASE_SHA
from release-source (never the manual dispatch head). The checked-out HEAD must
match. Read-only Actions API evidence must identify the repository's ci.yml,
a completed successful develop push for that exact SHA, and one complete
job listing for the pinned run attempt. Planning, ordinary Linux, native Linux,
macOS Live and CI policy must each succeed exactly once; the ordinary shared
gate and policy enforcement steps must also have executed successfully.
Docs-only, skipped/cancelled/failed, wrong SHA/repository/workflow/attempt,
incomplete pagination and API uncertainty all fall back. Lookup has a 15-second
overall budget, one page of 20 candidate runs and at most three job listings.
The workflow adds only actions: read beside contents: read in the build job.

Reuse skips only bun run ci. A frozen dependency install still runs before
packaging. Otherwise the identical shared gate runs with its existing release
log destination and a mandatory six-minute step deadline. Its failure/timeout
prevents packaging and publication; existing failure-log upload remains.
Version validation, sanitized capture-origin checks, real Mac helper, all
four final target builds, checksums/source/notices/launcher verification,
actual Linux browser/external T3 acceptance and both-platform updater checks
are unchanged. Only publish retains contents: write, and it still needs every
final artifact job to succeed. No scripts/ci.sh or test-runner edits belong here.

Read-only hosted observation: Release run 37831183075/job 113497119876 was
still in progress at SHA 7ad5d03536c5ed83e3874712e6b163c7fb99ea35. CI push run
37831109349 attempt 1 at that same SHA had all five required jobs and the
ordinary/policy steps successful. Its real API fields match the lookup's
contracts. This establishes available evidence, not a hosted run of this change
or a measured wall-time saving. Manual preparation of a new version commit
without successful full CI naturally takes the bounded fallback.

Focused fixtures cover exact SHA, full versus docs, provenance, pinned attempts,
missing/duplicate/incomplete/failing lanes and steps, API failures, checkout
mismatch, absent credentials and prepared-SHA CLI fallback. Workflow contracts
cover permissions, dependency install, complementary reuse/fallback conditions,
mandatory six-minute deadline and preserved final gates. No full local gate,
actual release build/native acceptance, publish, push or PR was performed.
Values unchanged: valid reuse, one owner, preserving shipped-path proof and
honest measurement already cover this change.

Local focused result: 90 passed, 0 failed, 714 assertions across
find-release-ci, release-workflows, ci-runner, smoke-script and publish-release
contracts. Isolated TypeScript checks for the new script/test, changed-code
formatting, new-script/test lint and git diff --check passed. These are fixture
and orchestration checks; hosted reuse and timeout/log delivery remain unproved.
