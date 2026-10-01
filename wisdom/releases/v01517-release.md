# v0.15.17 release

## Published

[v0.15.17](https://github.com/tnfssc/die/releases/tag/v0.15.17) published 2026-10-01T07:08:49Z. Stable, not a draft. Tag points to 5c1c727d9732cc556e177ec0a508c7d83ce6243f. This is source 349335edcf8b94e4a1c34f09e95298359c2b4b81 plus only the package version bump. Local develop fast-forwarded to match.

[Release 36827559384](https://github.com/tnfssc/die/actions/runs/36827559384) passed every gate: prepare-manual, deterministic tests and packaging, native macOS helper, final Linux browser boot/reload, actual Mac binary and old updater, then publication. No skipped release checks.

Release API confirms 12 uploaded nonempty assets: four binaries (Linux x64/arm64, macOS arm64, Android arm64), four hashes, LICENSE, SOURCE.txt, THIRD_PARTY_LICENSES.txt and THIRD_PARTY_NOTICES.md. Metadata: /home/tnfssc/.die/v01517-publication.json. Final gate status: /home/tnfssc/.die/v01517-run-status.json. Watch log: /home/tnfssc/.die/v01517-release-watch.log. No redundant binary download or paid/device probe.

Ships the resume picker AbortError fix. Invalid-header early returns now close the file stream. Late cancellation no longer has an unowned stream error. Active abort still rejects, real read errors still skip only the unreadable entry, and valid sessions remain intact. See [stream ownership proof](../history/resume-scan-abort.md).

## Request and preparation

User said "make release" after the fix. User authorization covered the fresh full Release workflow and publication after its gates. Source fix, tests and human release notes were pushed as 349335e. prepare-manual-release.ts bumped 0.15.16 to 0.15.17 on the server. Parent workspace: /home/tnfssc/Code/die. There were no independent release edits in a worktree.

Before dispatch, 21 focused tests passed across resume-stream-cancellation, pi-host, prepare-assets and resume-safeguards, including source/compiled host startup checks. Nine focused checks passed across the final stream fixture and persistent-history SDK/projection/storage parity. Typecheck, focused Biome and diff checks passed. An independent read-only readiness review found no release blocker. Full Release CI is the final broad evidence.

Publishing did not install or download the new release locally. The installed ~/.local/bin/die remains the old binary; normal updater/install flow can pick up v0.15.17. Local dist/die was built with the stream fix before the version bump and still reports 0.15.16 until rebuilt.

## Values assessment

No values edit. This broad release check found no new general lesson. Existing values cover clear cancellation ownership, shipped-path proof, user history safety, small guarded seams, and honest proof limits. The exact stream recipe belongs in feature wisdom.
