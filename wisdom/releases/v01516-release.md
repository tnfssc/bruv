# v0.15.16 release

## Published

[v0.15.16](https://github.com/tnfssc/die/releases/tag/v0.15.16) published 2026-10-01T06:25:12Z. Stable, not a draft. Tag points to prepared source 470e9ef9c2275a464ef45d1a85fd6cd02f942032. That is dispatch source 2b0b5ad plus only the package version bump. Local develop fast-forwarded to match.

[Release 36823609870](https://github.com/tnfssc/die/actions/runs/36823609870) passed every gate: deterministic tests, packaging, final Linux browser boot/reload, native helper, actual Mac binary and old updater. Replacement full CI 36823610514 also passed on 2b0b5ad.

Release API confirms 12 uploaded nonempty assets: four binaries (Linux x64/arm64, macOS arm64, Android arm64), four hashes, LICENSE, SOURCE.txt, THIRD_PARTY_LICENSES.txt and THIRD_PARTY_NOTICES.md. Metadata /home/tnfssc/.die/v01516-publication.json. No redundant binary download or paid/device probe.

Ships native-aware manual /shake. Eligible visible completed trace is pruned; opaque checkpoint bytes, origin, shim and runtime state stay intact. No eligible trace is a no-op. Encrypted checkpoint contents cannot be pruned. Automatic native shake-before-compaction remains deferred.

Broad review found no new value needed. Existing proof-scope, active history ownership and user-state guidance cover this release; implementation details stay with the shake feature.

## Request and preparation

The user said "make release" after the native-aware manual shake fix was pushed. User authorization covers a fresh full Release workflow and publication after its gates.

Source fix f3f0059, integration proof f231387. Parent and worker: 79 focused tests passed (454 assertions); worker typecheck passed. Ordinary CI 36823450753 was canceled by the newer release-notes push through the existing CI concurrency rule, not a test failure. Replacement full CI 36823610514 runs on 2b0b5ad alongside the full Release gates. This release includes only the follow-up since stable v0.15.15, plus proof notes. See ../compaction/shake-native-checkpoint.md for semantics and limits.

prepare-manual-release.ts will bump package 0.15.15 to 0.15.16. Prewrite human release notes; keep full Release checks. No redundant binary download after passing CI: check public release/tag and 12 assets. No paid/device/live-session probes.

Notes pushed as 2b0b5ad. [Release 36823609870](https://github.com/tnfssc/die/actions/runs/36823609870) dispatched on develop. Watch log /home/tnfssc/.die/v01516-release-watch.log. Monitor gates, verify publication and exact tag SHA. Values unchanged: existing proof and safe-history guidance already covers this release.
