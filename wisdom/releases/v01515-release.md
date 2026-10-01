# v0.15.15 release

## Published

[v0.15.15](https://github.com/tnfssc/die/releases/tag/v0.15.15) published 2026-10-01T05:46:13Z. Stable, not a draft. Tag resolves to 7fa768783d159a4c6a79d45168fa9010b3f0022f, the exact successful Release source. [Run 36820378274](https://github.com/tnfssc/die/actions/runs/36820378274) passed all gates, including final Linux browser boot/reload, actual Mac binary, native helper and old updater.

Checked release API: all 12 assets uploaded and nonempty. Four binaries (Linux x64/arm64, macOS arm64, Android arm64), their four hashes, LICENSE, SOURCE.txt, THIRD_PARTY_LICENSES.txt and THIRD_PARTY_NOTICES.md. No redundant binary download or paid/device probe. Publication metadata: /home/tnfssc/.die/v01515-publication.json.

This ships normal same-API/provider Codex checkpoint switching plus both Release fixture/receipt fixes. /shake behavior is unchanged. See ../native/codex-compatible-checkpoint-switching.md for model compatibility limits.

Broad review: the model restriction and runner-path failures both needed upstream evidence, not weaker verification. The checkpoint work already updated value 2; no further values change is needed. Keep runner command-file details with the cache feature.

## Request and preparation

The user said "release" after the Codex checkpoint-switch fix passed full CI 36817970940. This authorizes a fresh Release workflow from develop, not a rerun of failed run 36813685812 with its old source.

Version 0.15.15 was prepared but never published. prepare-manual-release.ts keeps a prepared version above the latest stable tag (v0.15.14). Refresh its old generated notes to describe the shipped result, not reverted experiments. The new source includes checkpoint fix d99f8e9 and Release environment fixture fix 82cdcff.

Notes pushed as 979e032. Dispatched [Release 36818925498](https://github.com/tnfssc/die/actions/runs/36818925498) on develop at that SHA. Watch log: /home/tnfssc/.die/v01515-release-watch.log. Await all gates, then check the public release and assets. Do not download binaries just to recheck hashes; see release-verification-preference.md. No device or paid model probe is part of this release request.

Values unchanged for release execution. The checkpoint work already refined value 2: local guard tests do not prove an upstream limit. The release uses existing proof-scope and publication guidance.

## First retry failed before publication

Release 36818925498 passed deterministic tests and standalone smoke, then failed the first release-target compile: verifyPackedWeb reported "build inputs changed". Publication and final browser/Mac binary gates did not run. Log: /home/tnfssc/.die/v01515-release-failure.log. No v0.15.15 release was published by this run.

Task task_3d7ca5d1 owns exact drift diagnosis and a minimal regression fix. Worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3d7ca5d1; branch die/fix-release-packed-web-identity-drift-3d7ca5d1; base 979e032. Preserve identity/digest checks. Parent owns this release note and will integrate and start a fresh workflow after proof. User release authorization remains active.

## Packed receipt fix ready

Worker a418ecd integrated as c8e824d. Runner 2.337.0 rolls GITHUB_PATH, GITHUB_ARTIFACTS and GITHUB_ARTIFACTS_LIST each step. Exclude these exact command-file paths from receipt environment identity; keep all real input/digest checks. See ../ci/release-packed-web-command-files.md for upstream runner evidence and isolated red/green tests. Worker: 52 focused tests, typecheck and focused format/lint passed. Parent reran the same 52 focused tests with the Release source environment: 52 pass, 481 assertions. Log /home/tnfssc/.die/v01515-command-path-regression.log. Ready for a fresh dispatch.

Fresh [Release 36820378274](https://github.com/tnfssc/die/actions/runs/36820378274) dispatched from 7fa7687 after the fix. Watch log /home/tnfssc/.die/v01515-release-retry-watch.log. All final gates and publication passed; see the published proof above.
