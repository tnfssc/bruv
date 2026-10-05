# CI failure patterns: implementation follow-up

## User choice and result

Implement audit items 2 and 3: share ordinary Linux validation between CI and Release, then audit the named repeat-offender fixtures. Propose item 4 (cheap checks and workflow-aware validation) but do not implement it. Missing ffmpeg is item 1 and remains outside this work. No push, PR or release was requested or done.

Parent branch: t3code/analyze-ci-release-failures. Code started at 9906f92e; integrated code/test tree is a15352ad. The [original failure audit](../quality/ci-release-failure-audit-2026-10-05.md) describes the pre-fix snapshot, not today's runner.

## Item 2: one ordinary Linux gate

Worker 03c16896 integrated as 3f32d2ff. CI and Release now both call bun run ci. Release sets CI_LOG_DIR=artifacts/release/ci, under its existing failure-artifact upload. Both get the same locked install, format/lint/typecheck, paired build, offline transport, three-worker root suite with paid tests disabled, owned fresh TMPDIR and paired smoke. No duplicate ordinary suite and no separate Release command list.

Tag/version checks, cross-target final builds, helper licensing, final external official-T3 acceptance, actual Mac updater execution and publication safety remain separate and required. Contract tests cover identical command/env, exact failure exit, stopping later gates, owned-temp cleanup and preserved final-artifact gates. One stale smoke contract was updated to follow the shared runner, not removed.

Worker proof: 51 focused tests pass. Its first full gate was not green (1,951 pass / 30 skip / 11 fail): the stale smoke contract plus ten runtime failures with local fish/mise output. That run is not reused as acceptance. Final joined gate below passed with a clean child shell.

Details: [shared runner](shared-local-ci-runner.md).

## Item 3: bounded fixture audit

### TUI and SDK: no remaining defect shown

Worker 3bcd84b6 integrated as 67fb0efa. Maintained tests and product code stayed unchanged. Baseline/restored checks: 9 pass / 155 assertions. A disposable controlled early-completion fixture reproduced five model calls against maximum four; today's event-gated fixture stayed green. Native-before-connector wrapper ordering check: 18 pass. Different historical /ps failures are not one surviving generic flake.

Details and kept evidence: [TUI/SDK audit](../tasks-ui/repeat-offender-audit-2026-10-05.md).

### Async fixtures: two observed cleanup flaws fixed

Worker 67a1236c integrated as a15352ad. In production-bridge tests, keep the fetch hook installed until client close and initialize settlement finish, including failed-assertion paths. In remote-capability-runtime's read-only Git revocation test, release/drain the owned serve before restoring PATH and removing state. Attach rejection handling immediately, but still await the original work and retain its assertions.

No product sources, security checks, deadlines or blanket retry policy changed. Saved-startup files remain unchanged: their existing grammar-loader completion signal already handles the import boundary.

Worker proof: 155 pass / 665 assertions across five focused repetitions. Controlled durable-publication, client-reader-drain, delayed Git spawn/PATH, missing-drain mutation and real grammar-completion checks are recorded. The mutation still catches DELETE-before-drain; fault probes do not masquerade as green acceptance.

Details: [async audit](../t3/bounded-item3-fixture-audit.md). Probe source/logs remain in that worker's artifacts/item3-audit, with the durable path below.

## Joined proof

Parent ran the final integrated code/tests with:

    env SHELL=/bin/bash CI_LOG_DIR=artifacts/release/ci bun run ci

Exit 0. Frozen install, format, lint (existing warnings), typecheck, paired build, offline default transport, complete root suite and reuse-build standalone paired smoke passed.

**1,962 pass; 30 opt-in skips; zero fail; 35,598 assertions across 272 files.** Root suite took 74.00s. Driver log: artifacts/ci-followup/full-linux.log. Per-stage logs: artifacts/release/ci/*.log. Short durable proof: [gate summary](evidence/ci-followup-2026-10-05.txt).

This is local Linux acceptance, not hosted CI, actual Mac execution, final external-T3 native acceptance, cross-target release or device/provider acceptance. Those extra gates were preserved but not dispatched. The shell override avoids local fish/mise diagnostics contaminating command output; no trust setting was changed.

## Item 4: text only

[Cheap-checks proposal](cheap-checks-proposal-2026-10-05.md): an explicit small local check command and pinned actionlint, after approval. No tool installed, hook added, core.hooksPath changed, new package command added, workflow-validation step added or mandatory gate introduced.

## Durable worker pickup

All code work used independent worktrees based on 9906f92e, now complete:

- task_9c5f55ba: /home/tnfssc/.bruv/worktrees/t3code-2c8ee52c-5442693331ce-task_9c5f55ba; branch bruv/align-ci-and-release-linux-validation-9c5f55ba; worker 03c16896.
- task_d5a11f5b: /home/tnfssc/.bruv/worktrees/t3code-2c8ee52c-5442693331ce-task_d5a11f5b; branch bruv/audit-tui-and-sdk-repeat-offenders-d5a11f5b; worker 3bcd84b6.
- task_3e453111: /home/tnfssc/.bruv/worktrees/t3code-2c8ee52c-5442693331ce-task_3e453111; branch bruv/audit-async-startup-and-capability-fixtu-3e453111; worker 67a1236c.

Nothing still running. Next product action needs user direction: review/push/PR, or approve/change item 4's proposal. Do not dispatch a release to prove this work.

Wisdom now keeps the code changes, controlled proof, gate result and limits together. Values unchanged during implementation: value 2's fixture-owner/completion lesson was already added during the audit and covers these repairs. Existing shipped-path and honest-scope values cover the remaining platform limits.

## PR delivery requested

User then asked to make a PR and merge it. Refreshed develop at b5b15811 and merged it as 01294380; this brings in PR #35's ffmpeg prerequisite and Live probe tests. The added prerequisite test still looked for the removed inline Deterministic tests step: controlled focused check failed with step index -1. Changed that assertion to require ffmpeg before the actual bun run ci gate, preserving ordering and explicit installation checks. Refreshed runner/release/manual/smoke contracts: 37 pass / 520 assertions. The earlier full Linux count remains proof of the pre-refresh joined tree; actual PR hosted CI must validate the refreshed candidate.

Item 4 stays proposal-only. PR delivery is authorized now; no release dispatch was requested.
