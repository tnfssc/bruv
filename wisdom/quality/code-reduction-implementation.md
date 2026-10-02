# Feature-preserving code reduction

## User decision

After the full audit, user approved implementing the full feature-preserving cleanup rather than another small plan. Keep all current product features and developer workflows. No archive, diagnostic, provider, UI feature, goal, Herdr, image resize or acceptance cuts. Dead implementation and simpler shared mechanics are in scope. Do not reduce meaningful assertions just to lower the count.

Base: d80d7058a2f5481f067586fd7042fe2746cff4ae. Parent had only audit documents and the value-7 lesson uncommitted; source/tests/config were unchanged. Audit: audits/code-reduction/2026-10-02/.

## Workers and ownership

- **core** — task_dc1457d6. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_dc1457d6. Branch: bruv/cleanup-core-dead-paths-and-duplicate-st-dc1457d6.
- **execution** — task_51494356. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_51494356. Branch: bruv/cleanup-task-execution-and-ui-duplicatio-51494356.
- **remote** — task_d625f667. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_d625f667. Branch: bruv/cleanup-remote-dead-implementation-and-s-d625f667.
- **live** — task_a3641c68. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_a3641c68. Branch: bruv/cleanup-obsolete-live-internals-without--a3641c68.
- **tooling** — task_89acff4c. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_89acff4c. Branch: bruv/reduce-tooling-harness-and-gate-duplicat-89acff4c.
- **web** — task_349462fa. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_349462fa. Branch: bruv/cleanup-maintained-web-patch-and-launch--349462fa.
- **test-infra** — task_2be69da7. Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_2be69da7. Branch: bruv/deduplicate-test-plumbing-without-droppi-2be69da7.

Core owns src/agent (including shared extension.ts), session/history/questions/wisdom source. Execution owns tasks/typescript/ui. Remote owns src/remote. Live owns src/live/native plus its setup probe. Tooling owns scripts/.github/root config, excluding Live's setup probe. Web owns src/t3/integrations plus tests/t3; script gate edits must go through parent/tooling. Test infrastructure owns *-tui.test.ts, history subprocess tests and minimal shared test mechanics. Other domain tests stay with their source owner.

Each worker commits code/tests and a uniquely named implementation note in its own worktree. Parent inspects diffs, integrates commits, resolves boundary changes and runs the combined gate. Actual returned prepared worktree paths above supersede the launch-time placeholder path. Exact launch records are in artifacts/code-reduction-implementation/.

## Checks and care

Use focused tests in each worktree. Keep dependencies and upstream source owned by that worktree; no mutating shared node_modules/cache through symlinks. No paid/provider/device or release mutations. Web must use the actual pinned current source and regenerate the canonical patch; old cache revisions are not proof.

After integration: formatting, lint, typecheck, current compiled CLI, complete root tests and maintained-web gates through scripts/ci.sh linux where environment permits. Report actual failures/skips. Preserve real TUI/compiled acceptance and old pending launch identities. Do not blindly remove the unused FFI lifetime root or web cancellation semaphore. Fix the known Live assertion target typo without deleting its privacy/teardown checks.

Values already cover this work. Existing value 7 was clarified during the audit about obsolete implementations kept alive by their own tests. No new value change at launch.

Status: seven worktrees are implementing. No implementation integrated yet.
