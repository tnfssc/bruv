# What done means for dependency PRs

User correction, 2026-09-30: configuration and a green no-change job are not done. Run it on GitHub. Show a real generated PR, review its changes and description, and verify its CI passes so it can be merged. Give the user links they can watch.

The first Dependabot run proved registry access and no-change handling only. Parent called this done too early. Do not repeat that claim. A controlled fixture can test PR creation when no real update exists, but it is not proof of a merge-ready product update. Never downgrade develop to manufacture a dependency PR.

Follow-up worker task_10879f72: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_10879f72, branch die/prove-hosted-dependency-pr-end-to-end-10879f72. Investigating current updates and a real hosted PR path. Parent owns GitHub writes and final PR review.

## Live fixture state

Created private https://github.com/tnfssc/die-dependency-pr-fixture-20260930 . Persistent local repo: /home/tnfssc/.die/worktrees/die-dependency-pr-fixture-20260930, develop at 1e1a862. Baseline CI 36669260148 passed. Dependabot runs 36669261802 and 36669259875 still queued at 04:58 UTC, over 25 minutes; label dependabot, no runner, no steps, no annotations. No PR yet. Actions enabled/all; GitHub status reports operational. Read-only diagnosis task_fcb6f68b investigating setup versus queue delay. Do not claim completion or create fake production updates.

## Superseding custom workflow decision (2026-09-30)

User now requests our own daily/manual updater; native Dependabot queue is not required. See [current design and exact hosted commands](daily-dependency-prs.md). The implementation validates the exact candidate commit before a separate write-token job opens the PR; GITHUB_TOKEN suppression of ordinary PR CI is explicit in the body. Controlled fixture mode is restricted to manual dispatch in the existing private fixture repo and requires the full implementation snapshot there. Parent owns publication, settings, run dispatch and real PR quality review. Do not mark hosted acceptance complete from local tests.
