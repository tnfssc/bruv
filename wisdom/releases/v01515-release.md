# v0.15.15 release

The user said "release" after the Codex checkpoint-switch fix passed full CI 36817970940. This authorizes a fresh Release workflow from develop, not a rerun of failed run 36813685812 with its old source.

Version 0.15.15 was prepared but never published. prepare-manual-release.ts keeps a prepared version above the latest stable tag (v0.15.14). Refresh its old generated notes to describe the shipped result, not reverted experiments. The new source includes checkpoint fix d99f8e9 and Release environment fixture fix 82cdcff.

Notes pushed as 979e032. Dispatched [Release 36818925498](https://github.com/tnfssc/die/actions/runs/36818925498) on develop at that SHA. Watch log: /home/tnfssc/.die/v01515-release-watch.log. Await all gates, then check the public release and assets. Do not download binaries just to recheck hashes; see release-verification-preference.md. No device or paid model probe is part of this release request.

Values unchanged for release execution. The checkpoint work already refined value 2: local guard tests do not prove an upstream limit. The release uses existing proof-scope and publication guidance.

## First retry failed before publication

Release 36818925498 passed deterministic tests and standalone smoke, then failed the first release-target compile: verifyPackedWeb reported "build inputs changed". Publication and final browser/Mac binary gates did not run. Log: /home/tnfssc/.die/v01515-release-failure.log. No v0.15.15 release was published by this run.

Task task_3d7ca5d1 owns exact drift diagnosis and a minimal regression fix. Worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3d7ca5d1; branch die/fix-release-packed-web-identity-drift-3d7ca5d1; base 979e032. Preserve identity/digest checks. Parent owns this release note and will integrate and start a fresh workflow after proof. User release authorization remains active.

## Packed receipt fix ready

Worker a418ecd integrated as c8e824d. Runner 2.337.0 rolls GITHUB_PATH, GITHUB_ARTIFACTS and GITHUB_ARTIFACTS_LIST each step. Exclude these exact command-file paths from receipt environment identity; keep all real input/digest checks. See ../ci/release-packed-web-command-files.md for upstream runner evidence and isolated red/green tests. Worker: 52 focused tests, typecheck and focused format/lint passed. Parent reran the same 52 focused tests with the Release source environment: 52 pass, 481 assertions. Log /home/tnfssc/.die/v01515-command-path-regression.log. Ready for a fresh dispatch.
