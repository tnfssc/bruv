# Pi host preparation must not write through Bun hardlinks

## Task / checkout

- Worktree: `/home/tnfssc/.bruv/worktrees/t3-3152ea81-5442693331ce-task_e32185ee`
- Branch: `fix/pi-host-hardlink-isolation`.
- Base: `origin/develop` at `a5f04949615431cf0976bb3e7900ceb4ed14e88d`, merged setup PR #47. No old parent or setup worktree was edited.
- Tools: existing user-local mise 2026.10.3, Bun 1.4.2; no tool installation, upgrades, or machine changes.

Read alongside [Pi host adaptation/removal](pi-mcp-codemode-removal.md), [Pi 1.0.3 audit](pi-1.0.3-root-host-audit.md), and [values](../values.md).

## Observed failure and ownership

`prepare:assets` rejected `dist/core/session-manager.js` even though Pi remained 1.0.3. The initial installation in this new worktree also inherited the bad cache file: inode 59690081, 48 links, SHA-256 `afa016a7535a8e6f57d516e3449cd1be3b56f08c07b05c32864b432e1c84add4`. Removing only this worktree's installation reduced the shared link count to 47, without changing those bytes.

Supported original: `9d01f720b803bf21d79e2b56de14d35a02316b9e22e8825fb007252a2f45f27a`.
Supported adapted: `344b8310365240a6e7e5573d95c8543f256bf5dadb964e954583efbe5ce75202`.

The global cache was read, never written or repaired. Its session-manager bytes exactly match the independently generated output of `bd756bdad25e77cf6a9886657a818a1610c80ed0:scripts/pi-host-adaptation.ts` on the `fix/task-history-resource-growth` branch. That variant adds `getSessionSettingsBranch`, `getModelContextBranch`, `getContextPreviewBranch`, and `getLatestCustomEntryOnBranch`. The tracked Bun patch is identical between that commit and this base. Host adaptations occur outside Bun's version/patch cache key.

The read-only observation records cache mtime 2026-10-07T19:26:36.619Z, before the user's reported 20:15 reinstall. This identifies matching source content, not the process that last wrote the cache. A newer checkout's separate inode does not establish what inode it had at that time. We did not inspect every cached file or attribute all unexpected bytes to one invocation.

The proven defect is owned by Bruv's `preparePiHost`: its former `writeFile(path, after)` mutates the installed inode, including any Bun cache/worktree hardlinks. An isolated reproduction showed local/cache/sibling all retaining inode 2795019 while all three changed from the supported original hash to the supported adapted hash. This branch's script produces `344b…`, not the observed history variant `afa0…`; the reproduction proves the write-through mechanism, not the identity of the historical last writer.

## Writer trace and fix

`package.json` → `scripts/prepare-assets.ts` → `preparePiHost` is the only dependency mutation path reached by `prepare:assets`. It writes seven host files. All other writes in that entrypoint target this repository's `runtime-assets/`; Photon/Pi asset inputs are only read. `build-claude-compat.ts` imports the same preparation entrypoint. `tasks-ui-proof-build.ts` only calls the pure adapter to require already-prepared dependencies before importing it; it has no separate host writer. Bun's tracked dependency patching is an installation stage, not another preparation writer.

Every changed host file now uses an exclusive adjacent copy, writes only that private copy, then renames it over the local dependency path. Copying retains executable/other modes. The adjacent path keeps replacement on the same filesystem. Temporary files are cleaned up after write/rename failure or success. Unchanged supported adapted files are not copied or rewritten.

Strict version, original/source hash, anchor, and adapted-result hash checks remain. Every file is still validated before the first copy/write. No drift hashes were admitted. This is atomic per-file replacement, not an all-files transaction for I/O failures, and it intentionally does not repair already-contaminated caches.

## Proof

Evidence: [directory](evidence/pi-host-hardlinks/).

- `regression-before-fix.txt`: hardlink regression failed with the old writer; the validate-before-write hardlink failure case already passed.
- `before-fix-write-through.json`: measured isolated inode/hash write-through above.
- `observed-cache-provenance.json`: read-only shared cache sample and independently verified historical output match, with attribution limits.
- `fixed-real-bun-install.json`: fresh cache under this worktree's ignored `dist/pi-host-cache.tEH3NH`, Bun `--backend hardlink`, all seven files initially linked to cache and an isolated sibling. After preparation, local files each have one link and the exact supported adapted hash; cache/sibling remain byte-identical to the original. Two `prepare:assets` runs exit 0 and the second preserves local inode/mtime.
- The first clean installation used fresh `/tmp` cache plus `--backend copy` (219 packages, exit 0), never the global cache. A later `--backend hardlink` probe in `/tmp` did not yield actual hardlinks: `/tmp` device 53 differs from worktree device 55. We verified that mismatch and repeated on the same filesystem rather than claiming copy fallback was hardlink coverage.
- Regression fixtures create three hardlinks per file independently of Bun. They check local adapted hashes, different local inodes, unchanged cache/sibling bytes and mtimes, retained modes (including executable main.js), untouched late-source-drift failure, and idempotent second preparation. Existing version/source validation remains; result-hash rejection now has an explicit assertion too.
- Paired build succeeded. Complete focused host/assets tests: 14 passed, 0 failed, 314 assertions in 8.18 seconds; `bun run check` (including preparation and TypeScript) succeeded. Final build/test/typecheck/Biome/diff checks all exit 0 in `final-checks.txt`. This is not a full CI, macOS, or Windows claim; the real hardlink integration was Linux/Bun 1.4.2.

## Safe recovery for the affected worktree

First integrate the atomic-replacement fix into the affected branch. Do not change that branch's accepted source/result hashes to match cache drift. Run the following **in that affected worktree only**, using Bash (or equivalent shell syntax):

```sh
cache=$(mktemp -d "${TMPDIR:-/tmp}/bruv-bun-recovery.XXXXXX")
# Keep a reversible local backup; rename/unlink does not mutate hardlinked bytes.
mv node_modules "node_modules.before-hardlink-fix.$(date +%s)" &&
mise exec -- bun install --frozen-lockfile --cache-dir "$cache" --backend copy &&
mise exec -- bun run prepare:assets
```

If there is no existing node_modules, skip the mv. Retain the scoped cache path and pass it (or a newly created fresh cache) plus `--backend copy` on later reinstalls in this worktree while the default cache remains contaminated. Do not delete/edit the shared global cache, copy a drifted file into it, or repair other worktrees. Delete the local backup only when satisfied with the clean installation. Nothing in this task performs recovery in the user's affected checkout.

Values unchanged: existing isolated-proof, exact-evidence, and small-focused-check values already cover this lesson; this dependency-specific recovery belongs here.

## PR #49 CI format follow-up

Linux run 37683113121 stopped at format:check, before executing the full Linux tests. fixed-real-bun-install.json used a multiline preparationExitCodes array; Biome wants [0, 0]. The prior focused Biome check covered the two TypeScript files but missed committed evidence JSON. The policy failure followed Linux's failure; macOS Live passed.

Follow-up worktree: /home/tnfssc/.bruv/worktrees/bruv-pr49-ci-format. Branch: fix/pi-host-hardlink-ci-format. Formatted only that evidence file. The repository-wide Biome format check now passes all 848 files; git diff --check passes. No production code or test behavior changed. Check the whole committed evidence set, not only code files. Values stay unchanged; the existing exact-proof rule applies.
