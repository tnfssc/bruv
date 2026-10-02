# Further upstream reduction and Bruv-in-T3 proof

User asked whether Bruv really works inside adopted T3 and whether the patch can
be smaller. Prior migration is integrated locally through d195d78; no push/release.
Read upstream-first-migration.md for existing code decisions and proof.

## Ownership

Implementation: task_09a4f35b (orchestrator).
Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_09a4f35b
Branch: bruv/shrink-remaining-t3-patch-without-losing-09a4f35b
Base: d195d78b8d708dc6ff53e11b009895c3ca289ebf.
Read-only validation audit: task_3b380627, main workspace.
Parent integrates and checks combined result; no publish/install requested.

Keep old source checkout t3-upstream-first-4eb8a4a8 untouched as prior proof.
New code work needs a separate durable source checkout. Reduce actual ownership,
not just bytes by moving code elsewhere or deleting useful tests. Keep essential
authority, native tools/tasks/questions/remote, delivery and history safety.

## Baseline and gaps

Pin 66a91077f9abf6e171aad0ceab2519d7272f3ff3. Patch 365318 bytes, 74 files,
6096 added lines (5981 excluding lockfile). Prior compiled native acceptance
used real Bruv/Pi processes with deterministic loopback model; browser proof
covered cold boot/reload without provider credentials. That is not proof of
a complete browser prompt -> response/tool/task path. Audit should identify
and run the smallest decisive missing check, not another broad test matrix.
Live paid providers, real SSH owners and non-Linux execution remain untested.

Values unchanged: existing real-path proof and fewer-owned-parts guidance covers
this follow-up. Do not claim everything works from narrower evidence.
