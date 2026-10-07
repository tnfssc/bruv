# PR #48 hosted Bun cache recovery

Run 37685931065 failed in Linux prepare:assets/typecheck with Unsupported Pi host file dist/core/session-manager.js. The failing job restored bun-1.4.2-Linux-X64-f7d5c51aa9dde1b3f84bff2a143ab3b4ad4800c17bb2039b71c167a576767809 through restore prefix bun-1.4.2-Linux-X64-.

The Pi-host atomic copy/rename writer from mainline prevents future writes from mutating hardlinked cache files. It cannot repair content already stored in the shared hosted cache. A fresh private Bun cache with the copy backend passed the merged build, typecheck, and 14 Pi-host tests. This isolates the observed failure to stale contaminated cache content; no source/result hash drift was needed.

CI and release now use the bun-download-v2-1.4.2- family for both exact keys and restore prefixes. This is a one-time cache namespace rotation. Bun version, runner OS/architecture, lockfile/package identity, and cached download path remain unchanged. The new restore prefixes cannot match the old family. No cache contents are deleted or silently repaired.

Focused workflow regression assertions cover CI and release cache keys, restore prefixes, path, and Bun version. No new value is needed; existing cache-isolation guidance covers this recovery.

Parent integration: /home/tnfssc/.bruv/worktrees/bruv-task-history-cache-recovery, branch fix/pr48-ci-cache-recovery. Worker task_81a9f7fa committed 942597d7 in /home/tnfssc/.bruv/worktrees/t3-230f6fdf-5442693331ce-task_81a9f7fa. Parent kept the prior CI check that every CI cache stores only Bun downloads; release still has its separate browser cache. Hosted validation will rerun after the parent pushes this to PR #48. No hashes or resource budgets were weakened.

Parent workflow checks passed: 8 tests, zero failures, plus diff checks. This small workflow recovery does not claim a repeated full product gate; the hosted run is the required confirmation.

Hosted retry 2 of run 37687812428 reached the full suite: asset preparation, typecheck, ci/stress resource profiles and paired build passed. One release-workflows.test.ts assertion still named the old cache family. Parent missed it in the first focused pass. It now requires the exact new key and restore prefix; path, pinned inputs and other cache protections remain. Linux stress write passed at 131.0 MiB RSS / 10.20 MiB disk; resume at 106.4 MiB / 10.31 MiB. The earlier HTTP 418 audio download failure passed on the single retry. No product guard or budget changed.

Both complete cache-contract test files now pass: 29 tests, 442 expectations. Tests that read vendor licenses required a fresh locked dependency install in this checkout. Repository scan found no legacy family in workflows; remaining old-family test strings only assert its rejection. Biome and diff checks pass. Values unchanged; this updates the missed contract, not the cache-isolation rule.
