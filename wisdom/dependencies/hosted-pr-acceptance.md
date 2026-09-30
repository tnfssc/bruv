# What done means for dependency PRs

User correction, 2026-09-30: configuration and a green no-change job are not done. Run it on GitHub. Show a real generated PR, review its changes and description, and verify its CI passes so it can be merged. Give the user links they can watch.

The first Dependabot run proved registry access and no-change handling only. Parent called this done too early. Do not repeat that claim. A controlled fixture can test PR creation when no real update exists, but it is not proof of a merge-ready product update. Never downgrade develop to manufacture a dependency PR.

Follow-up worker task_10879f72: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_10879f72, branch die/prove-hosted-dependency-pr-end-to-end-10879f72. Investigating current updates and a real hosted PR path. Parent owns GitHub writes and final PR review.

## Live fixture state

Created private https://github.com/tnfssc/die-dependency-pr-fixture-20260930 . Persistent local repo: /home/tnfssc/.die/worktrees/die-dependency-pr-fixture-20260930, develop at 1e1a862. Baseline CI 36669260148 passed. Dependabot runs 36669261802 and 36669259875 still queued at 04:58 UTC, over 25 minutes; label dependabot, no runner, no steps, no annotations. No PR yet. Actions enabled/all; GitHub status reports operational. Read-only diagnosis task_fcb6f68b investigating setup versus queue delay. Do not claim completion or create fake production updates.

## Superseding custom workflow decision (2026-09-30)

User now requests our own daily/manual updater; native Dependabot queue is not required. See [current design and exact hosted commands](daily-dependency-prs.md). The implementation validates the exact candidate commit before a separate write-token job opens the PR; GITHUB_TOKEN suppression of ordinary PR CI is explicit in the body. Controlled fixture mode is restricted to manual dispatch in the existing private fixture repo and requires the full implementation snapshot there. Parent owns publication, settings, run dispatch and real PR quality review. Do not mark hosted acceptance complete from local tests.

## Custom workflow real hosted proof (2026-09-30)

User replaced Dependabot with a daily/manual Actions workflow. Simple updates, including Pi; breaking migrations may fail for manual repair. One fixed automation/daily-dependencies branch and one open PR. No guard rewrites or auto merge. Production source dea7727, implementation worker /home/tnfssc/.die/worktrees/die-a86675007a5e-task_e16383d5, branch die/custom-daily-dependency-pr-workflow-e16383d5. Parent added exact-SHA commit status for a watchable PR; GITHUB_TOKEN does not trigger ordinary PR CI. Allow Actions to create PRs setting enabled in product and fixture, default token permissions remain read.

Production run https://github.com/tnfssc/die/actions/runs/36683047778 passed full shared Linux CI and notices and created https://github.com/tnfssc/die/pull/9 . Candidate 826965615503fbc2e8a34d05e8c6becc0e114ff0 changes only bun.lock @types/node 26.6.1 -> 26.6.3 plus integrity; no source/guard/manifest churn. Parent reviewed diff/body and left a GitHub review comment. GitHub CLEAN/MERGEABLE, attached dependency-update/Linux validation success. This is a real product PR, not fixture proof. Body was vague for transitive-only updates; fixed in 5ccc8fa with Bun.JSONC lockfile version summary and focused regression. Second product run 36684110833 is running to prove reuse of PR 9 and improved body. Do not change remote develop until it ends; publication checks base SHA.

Fixture repo now holds full project snapshot at 80ee939, local /home/tnfssc/.die/worktrees/die-custom-dependency-fixture-20260930. Run https://github.com/tnfssc/die-dependency-pr-fixture-20260930/actions/runs/36683088465 passed full shared Linux CI/notices and opened PR 1. Exact head 2d1ac505524c48c796cbc3fff86da5322ce5f801 changes only manifest+lock resolve.exports 2.0.2 -> 2.0.3. Parent reviewed both files and posted review; mergeable with exact-SHA validation status. TEST ONLY title/body and run links verified. Fixture updater disabled after proof to stop daily test churn; retained repo/PR as evidence. Old queued native Dependabot runs were cancelled.

Values strengthened under Finish what user needs: run automation on the real platform and review its output. No-change success is not output-path proof; fixtures must stay labeled.

## Reuse and failure path verified

Run 36684110833 failed typecheck in the new lockfile-summary parser (Bun.JSONC.parse returns unknown). It saved recovery artifacts, skipped publish, and PR 9 stayed at 8269656. Parent fixed parsed object typing in 71dacb6, ran frozen install/typecheck and 11 focused tests, then dispatched again.

https://github.com/tnfssc/die/actions/runs/36684245922 passed full shared Linux validation/notices and updated **the same PR 9** to cc5e36a768e371fb3cbdc4f9a4086fa553b527cb. Listing all PRs for automation/daily-dependencies shows exactly one, still open. Final body lists @types/node before/after and links the exact run/head/base. Diff is still just the one lockfile package/integrity update. Parent reviewed final diff/body/status. Both statuses pass; CodeRabbit success is a bot-review skip, not review evidence. GitHub MERGEABLE, but mergeStateStatus UNSTABLE despite no failed head status/check runs and no develop protection/rules; do not call that CLEAN. No separate Mac candidate check or merge performed.

Custom workflow is live on develop, daily 06:00 UTC and manual dispatch. Pi updates are attempted, source guards remain unchanged; failures stay failures for human migration. Exact candidate Linux status is posted by the isolated write-token publish job after read-only validation. Same bot branch/PR reused; no daily PR pileup.
