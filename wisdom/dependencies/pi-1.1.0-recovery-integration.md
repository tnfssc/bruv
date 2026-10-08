# Pi 1.1.0 recovery integration

Worktree: /home/tnfssc/.bruv/worktrees/t3-98a10da6-5442693331ce-task_0cdc00f7
Branch: bruv/integrate-pi-recovery-with-1.1-upgrade-0cdc00f7
Base: 409086c9 (reviewed Pi 1.1.0 / Haiku 5.5 upgrade).

## Scope and reasons

Read [values](../values.md), [upgrade review](pi-1.1.0-haiku-5.5.md), [drift recovery](pi-host-drift-recovery.md), and [recurring drift proof](pi-host-recurring-drift.md). Cherry-picked sibling c3ffd4f7 then 101ce082 in that order. They applied without textual conflicts as 11dbd7a3 and 4073eed1. The strict version stays 1.1.0; all nine original/result hash pairs, four dependency pins, lockfile, and both regenerated patches are unchanged from 409086c9. No historical or contaminated cache hash is accepted.

Recovery remains one fresh frozen isolated installation with a private cache, ignored package scripts, and copy backend. It validates staged source before per-file atomic replacement of checkout-local host files. Normal prepared runs remain offline. Unsupported versions, I/O, metadata, anchors, and result errors still fail closed. The realpath ownership guard runs before either writer or acquisition. Tests now also exercise borrowed nested dist/core directories, not just a borrowed package root, with both original and stale bytes; no acquisition or borrowed-file writes occur.

## Fixture generation

Replaced tests/fixtures/pi-host/1.0.3-originals.json.gz with 1.1.0-originals.json.gz. Downloaded the published npm tarball, verified its registry SHA-512 integrity, extracted in an owned OS temporary directory, and applied the tracked 1.1.0 coding-agent Bun patch using git apply. Collected only the nine guarded files before host adaptations. Every file matched the upgrade's existing originalSha256, and every generated adaptation matched its adaptedSha256. The actual recovery install independently produced those same accepted result hashes. No node_modules or global-cache bytes supplied the fixture.

The resulting fixture is 84,246 bytes compressed. [Source evidence](evidence/pi-host-1.1-recovery/fixture-source.json) records the tarball URL/integrity and fixture/source/result digests. [Fixture README](../../tests/fixtures/pi-host/README.md) gives reproduction steps and license provenance. The test's synthetic stale 1.1.0 variant omits the final compaction getModelContextBranch adaptation and hashes to fc59d68420c94f67f3ed818766eee20ec2ad95126db9038b95b18f2fb4589d6b. This is not the historically observed 1.0.3 ef78… cache hash. Updated the test title and fixture metadata accurately, not just its filename.

## Real command proof

[real-command.json](evidence/pi-host-1.1-recovery/real-command.json): introduced the synthetic stale agent-session.js into this isolated checkout by adjacent copy/write/rename, never by writing its inherited shared inode. Direct strict preparePiHost rejected it and left all target files unchanged. The original entrypoint command, bun ./scripts/prepare-assets.ts, then exited 0 with the recovery notice, using the production fresh frozen isolated-install path. All nine files ended with current accepted result hashes. A second identical invocation exited 0 without a recovery notice; host and runtime-asset bytes, inodes, modes, and mtimes stayed stable.

Read-only before/after snapshots of all regular files in 28 relevant global cache roots (17666 files) were identical for bytes, inodes, modes, and mtimes. These cover all available cached 1.0.3 direct Pi-family roots, plus 1.1.0 coding-agent roots. This task made no global cache or parent-checkout edits. Hardlink peer link counts are not treated as stable state: legitimate local detachments and other checkouts can change them. Hermetic tests separately retain unchanged peer bytes/inodes/mtimes and modes.

## Checks and gaps

- Recovery alone: 18 pass, zero failures, 1,104 assertions (including nested borrowed-directory coverage).
- bun run check: pass (real asset entrypoint and full TypeScript check).
- Full requested five-file focused invocation: 34 pass, 2 failures, 1,477 assertions. Both failures are the compiled CLI host tests with ENOENT for this worktree's absent dist/bruv, not failed host semantics. Source host, recovery, assets, Haiku 5.5 and Sol catalog checks pass.
- Parent owns combined build/full gate; no local build was run and no test code was skipped or weakened. A source-only filtered invocation excludes exactly those two compiled CLI cases to make that local gate explicit; 34 pass, 2 filtered out, zero failures, 1,477 assertions; result recorded in [checks.txt](evidence/pi-host-1.1-recovery/checks.txt).
- Focused formatting and git diff --check: pass; final recorded outputs accompany this note.

Parent must build and rerun the unfiltered host tests/full combined gate after integrating these commits and the separate tests/update.test.ts timeout worker. This worktree did not edit that file. No full CI, provider request, interactive terminal acceptance, push, PR, or release. The real 1.1.0 recovery proof uses labeled synthetic drift, not a claim that its inherited installed cache was already polluted.

Values: retained the sibling's “stopping new damage is not full recovery” addition unchanged. No further values edit: existing exact-proof, ownership, user's-work safety, and wisdom-before-handoff values cover this integration.
