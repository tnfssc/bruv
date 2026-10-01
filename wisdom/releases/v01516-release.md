# v0.15.16 release

The user said "make release" after the native-aware manual shake fix was pushed. User authorization covers a fresh full Release workflow and publication after its gates.

Source fix f3f0059, integration proof f231387. Parent and worker: 79 focused tests passed (454 assertions); worker typecheck passed. Full ordinary CI36823450753 is running. This release includes only the follow-up since stable v0.15.15, plus proof notes. See ../compaction/shake-native-checkpoint.md for semantics and limits.

prepare-manual-release.ts will bump package0.15.15 to0.15.16. Prewrite human release notes; keep full Release checks. No redundant binary download after passing CI: check public release/tag and 12 assets. No paid/device/live-session probes.

Next: push notes, dispatch release.yml on develop, save run ID, monitor gates, verify publication and exact tag SHA. Values unchanged: existing proof and safe-history guidance already covers this release.
