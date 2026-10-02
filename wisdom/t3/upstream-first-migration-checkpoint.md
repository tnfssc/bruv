# Upstream-first migration checkpoint

## User decision

After bruv v0.15.24 shipped, user asked about official T3 orchestrator v2 and Pi
support. Stable v0.0.44 and main do not contain v2; PR #2829 remains open. Pi
provider support, including Pi 1.0 PR #14688, is on t3code/codex-turn-mapping.

User then explicitly chose to use that development branch as upstream now,
instead of waiting for stable, and emphasized reducing code we maintain for
upstream dependencies. This supersedes the wait-for-stable preference recorded
in t3-v2-upstream-research.md. Pin an exact commit from the chosen branch.
Adopt upstream code and delete replaced custom code, not just rebase our patch.
Keep essential Bruv behavior and data safety; do not keep legacy behavior merely
because it exists. No new release/push/install was requested for this migration.

## Work at pause

User asked to pause so they can restart the agent. Parent is requesting
current-session work cancellation after saving this note. Check job state and
worktree changes on restart; do not assume cancellation means no partial edits.

Implementation orchestrator: task_dfb16c9d.
Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_dfb16c9d
Branch: bruv/adopt-t3-orchestrator-v2-upstream-and-re-dfb16c9d
Base: 6d9e9817b6c4badd87999c0e8ba64890607efea8.
Last checked target branch head: 66a91077f9abf6e171aad0ceab2519d7272f3ff3.
Current integration pin: b488c57f3f9f1688e31c53daee99e29dd1d0baa2.
Determine ancestry; do not assume our existing pin was from stable.
Read-only Pi support/patch comparison: task_c625b58f, current main workspace.
Check its saved result/session if it finished before cancellation.

## Next steps

Inspect task/worktree status and any descendants, then resume authorized migration
in durable worktrees. Read integrations/t3/README.md and relevant wisdom. Use
regenerate-patch.ts on actual upstream source; never hand-edit patch hashes.
Measure patch/code reductions and explain custom parts still needed. Validate
native tools/tasks/questions/remote, history safety, and packaged browser/CLI.
Parent integrates reviewed commits; do not bypass build/source/release guards.

## Finished before migration

Pi 1.0 dependency update and first-paint fix released as bruv v0.15.24.
All release gates passed; all 12 assets verified. Publication record pushed as
2924618. Current local 6d9e981 adds the T3 official-release research note.
See ../releases/v0.15.24-pi.md and ../dependencies/pi-1.0-upgrade.md.

Wisdom records the new direction and restart point. Values unchanged: existing
values 7 and 9 already favor fewer owned parts and deliberate upstream adoption.
