# Upstream-first migration (in progress)

## Ownership and pins

User explicitly authorized the official development branch, not stable. Parent implementation worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_4eb8a4a8, branch bruv/resume-t3-upstream-adoption-and-patch-re-4eb8a4a8.

Official fetch on 2026-10-02 resolved t3code/codex-turn-mapping to 66a91077f9abf6e171aad0ceab2519d7272f3ff3 (Stop always ends the background work a thread shows, #14636). Its parent is de95adc336e68d8ce645fc09bf0f8eeb39444338 (Pi 1.0, #14688). Pi introduction is f2919fd8b (#7211).

Old pin b488c57f3f9f1688e31c53daee99e29dd1d0baa2 is a v2 commit, “fix(v2): remove obsolete composer breakpoint animation”, not a stable-release assumption. The existing source clone is shallow at the old pin, so local merge-base failure alone is not ancestry evidence. Official GitHub compare API returned HTTP 200, status diverged, 1110 commits ahead / 606 behind, merge base 5781b5240bd5d2e21c651f6b228975ac40cbd67b. This is a divergent branch migration, not a linear fast-forward.

## Workspaces

- T3 migration worker task_dd734f12: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_4eb8a4a8-5442693331ce-task_dd734f12; branch bruv/adopt-official-t3-pi-and-orchestration-s-dd734f12. Exclusive upstream source: /home/tnfssc/.bruv/worktrees/t3-upstream-first-4eb8a4a8.
- Root Pi seam worker task_1819db87: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_4eb8a4a8-5442693331ce-task_1819db87; branch bruv/reduce-root-pi-host-seams-using-official-1819db87.

## Baseline

Canonical patch: 1,948,956 bytes; 302 changed files; 15,595 added / 19,582 removed lines (git apply --stat). No migration adoption or passing validation is claimed yet.

## Required evidence

Canonical regenerate-patch.ts export from actual new-pin source; source verification; patch reduction with retained custom-piece rationale; build actual shipped integration and CLI; real packaged browser startup; provider/native contract and lifecycle flows; history migration safety. No push, release, install, or version bump.

## Root Pi audit

Integrated worker commit 9d68d7cfad8ee7be08200b7d39a47476a3d06dbc as d667a65. No concrete equivalent root upstream replacement found: zero root code reduction, with precise API evidence and 89 focused passing tests in ../dependencies/pi-1.0-root-host-upstream-audit.md. Reused compiled evidence is explicitly not a fresh shipped-build proof.

## Migration gate worker

Task task_7725ecce owns history migration gate/templates only, preparing actual shipped b488c57 baseline to new dynamic pin rather than retaining historical a9b49a7 baseline. Worktree /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_4eb8a4a8-5442693331ce-task_7725ecce; branch bruv/update-history-migration-acceptance-for--7725ecce. Does not edit the source migration checkout.

## Parent validation (ongoing)

Root `bun run check` passed on 2026-10-02 in the implementation worktree (asset preparation plus TypeScript). Root test dependencies installed from frozen bun.lock, using installed Bun 1.4.2 by absolute path. The configured mise pnpm installer failed to locate the renamed 11.27.1 archive asset; no product or gate change was made to bypass it. This root-only check does not prove the pending new T3 build.

Root safety regressions passed: 55 tests, 0 failures, 240 assertions across native-routing, production-bridge, web-task-events, questions, remote-capabilities and history-storage. Log: `.cache/upstream-first-proof/root-safety.log`. These are source-level ownership/contract tests, not real new-pin provider or packaged-startup evidence.

Migration gate worker commit 99d8253d integrated as 8b708bd. Actual production fixture passed at migration 54 with 13 events in the worker-owned prepared checkout; parent reran 2 source/patch preflight guard tests (10 assertions), both passed. Final target upgrade/restart awaits canonical source readiness. The preview fixture still imports the custom NativeUsageAccounting helper; if the source migration removes that display helper, update the fixture to assert official persisted normalized usage and restart semantics, not re-add a duplicate helper just for a legacy assertion.
