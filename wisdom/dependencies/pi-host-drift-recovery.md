# Local Pi host drift recovery

Worktree: /home/tnfssc/.bruv/worktrees/t3-43386b05-5442693331ce-task_75cb7cfa
Branch: fix/pi-host-clean-source-recovery

## Why

[Atomic host writes](pi-host-hardlink-isolation.md) prevent new cache pollution but do not repair existing cached or private stale branch adaptations. The user and parent observed shared Bun-cache files with nlink 544. This worktree read-only inspection measured nlink 548 (more inherited links than the earlier nlink 544 report), and agent-session.js has unsupported SHA-256 ef78c937779832d87a5a28bbd339e4c73e210d0b5da7ff570723f1d4313be876. Reading its bytes and reversing the existing adaptations reconstructs the exact pinned original hash; that is fixture provenance, not a new accepted production hash.

## Plan and ownership

Keep preparePiHost strict and its pinned hashes unchanged. Only its typed unsupported-file error, after version and all source reads succeed, permits entrypoint recovery. Use one owned temporary directory containing root package.json, bun.lock, patches, a private Bun cache and a clean install via the running Bun executable with frozen lockfile, ignore scripts and backend copy. Validate/adapt staged Pi first. Read and validate all replacement bytes before any target writes, then adjacent-copy/rename only local host patch files, retaining target modes. Leave all other node_modules files, global cache, and sibling worktrees alone. Delete the stage on success or failure; no persistent cache or recovery marker. Prepared runs remain offline and preserve inode/mtime. Run bun run prepare:assets to use this repair; it supersedes the earlier manual all-node_modules recovery for pinned-version host-file drift only. The polluted shared cache is deliberately not repaired: another contaminated reinstall can trigger a new one-stage recovery. Unsupported upgrades still require adaptation review.

Tests will inject acquisition, exercise the exact observed stale adaptation and contaminated hardlinks, and prove failure leaves target bytes/inodes/mtimes unchanged. Real isolated installation and final entrypoint verification belong to the parent, not this task. No global-cache install or mutation is authorized here.

## Proof

- Implemented scripts/pi-host-recovery.ts and routed scripts/prepare-assets.ts through it. The strict preparer now classifies unsupported source drift with a dedicated error, and finishes all reads before adaptation so an I/O failure is not masked by drift. Existing original/adapted hashes are unchanged.
- One owned OS temporary stage, private cache, copied package.json/bun.lock/patches, current process.execPath (Bun), frozen lockfile, ignore scripts, backend copy. Acquisition has a 120-second deadline and 1 MiB output cap. No persistent recovery state. The stage is removed in finally, including partial acquisition and validation failures.
- Production writes remain per-file atomic, not a cross-file transaction. All replacement content is validated before target writes. A later rename/I/O error still fails; already completed per-file replacements may remain. Acquisition/network failure and staged-validation failure do not write any target files.
- The 82,027-byte compressed fixture holds only the nine pinned original host patch files. Test setup verifies all original hashes and generates the exact observed stale agent-session.js hash by omitting its final host marker. It does not read installed Pi, access network, or use any Bun cache. This makes the regression independent of whatever cache the test runner inherits.
- `bun test tests/pi-host-recovery.test.ts`: **14 passed, 0 failed, 878 assertions**, Bun 1.4.2 on Linux. Coverage: stale private adaptation; polluted cache/local/sibling hardlinks; all adapted hashes, retained modes, unchanged peer bytes/inode/mtime; untouched unrelated files; no second acquisition or notice; stable second-run inode/mtime; normal pristine offline preparation; unsupported version, malformed metadata, source I/O, anchor/result failure; failed staged version/source/metadata/I/O validation; actionable failed acquisition and stage cleanup.
- Focused TypeScript passed: `./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck --types bun --target ES2022 --module Preserve --moduleResolution Bundler scripts/pi-host-adaptation.ts scripts/pi-host-recovery.ts scripts/prepare-assets.ts tests/pi-host-recovery.test.ts`.
- Focused Biome formatting and git diff --check passed. Focused Biome lint exits 0 with the pre-existing noTemplateCurlyInString warning for the literal upstream APP_NAME anchor in pi-host-adaptation.ts.
- Repository-wide `tsc --noEmit` could not pass in this fresh worktree: eight missing runtime-assets JSON imports in src/cli.ts and src/claude-compat/cli.ts. No implementation type errors were reported. We did not generate assets by invoking the real recovery path or run an install; the parent owns real isolated-install verification and full checks.
- Read-only final inspection confirms this worktree's inherited agent-session.js still has the unsupported ef78… hash. Tests repaired owned temporary fixtures only; neither global cache nor this worktree's inherited dependency files nor other worktrees were changed.

Values unchanged: existing isolated ownership, exact evidence and simplest-working-solution values apply. This is a dependency-specific repair, not a new general rule.

Parent integration: [recurring drift proof](pi-host-recurring-drift.md). The parent also added an ownership check before normal preparation and recovery. Borrowed dependency directories outside the checkout fail without writes or clean-source acquisition.
