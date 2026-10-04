# v0.15.29 fast-mode release

Published https://github.com/tnfssc/bruv/releases/tag/v0.15.29 at 2026-10-03T18:42:13Z. Stable, not a draft. Tag points to 0249ae6c1a5314011fc489476a3197f5bea9fb31.

Release run https://github.com/tnfssc/bruv/actions/runs/37144547603 completed successfully. Preparation, native macOS helper, deterministic tests and packaging, final Linux browser boot/reload, actual Mac binary/updater, and publication all passed. GitHub release metadata confirms 12 nonempty assets: four platform binaries, four hashes, LICENSE, SOURCE.txt, THIRD_PARTY_LICENSES.txt, and THIRD_PARTY_NOTICES.md. No redundant binary download or local installation.

Ships CLI/SSH child fast inheritance, request-bound provider-tier status, SDK-priced dollar estimates, and preserved system prompts/tools in guarded Codex requests. T3-native backend inheritance remains unsupported. See [feature design and tests](../native/native-fast-mode.md).

## Source and recovery

User asked to push to default and release. Busy local develop contained unrelated native-connector/task-UI work. None was pushed. Release worktree: `/home/tnfssc/.bruv/worktrees/bruv-release-fast-v01529`; branch `bruv/release-fast-v01529`, based on origin/develop eb07b0d7. Cherry-picked only ba52c365 as 40778e73. Two environment conflicts kept the released branch's existing behavior and added only the fast-mode bit. Human notes: support/release-v0.15.29.md. Typecheck, whole-repo format check, and 128 focused tests passed on this base.

The first release run, 37143993104, failed deterministic tests before publication: nine placement tests hit an eager model endpoint check while fast mode was off. Reproduced locally, fixed in 0249ae6c by returning before routing/auth checks without enabled consent, and added a throwing-getter regression. Placement/fast/job-service checks: 50 pass, 0 fail; typecheck passed. The corrected source went through a fresh full Release workflow. No gate bypass or failed-SHA rerun.

Watch logs are /home/tnfssc/.bruv/release-v0.15.29-watch.log and /home/tnfssc/.bruv/release-v0.15.29-retry-watch.log. The original fix worktree remains at /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_c9443bef; use the release branch for the integrated fix and CI correction. Parent local working changes were left untouched.

Values unchanged. Existing guidance covers untouched paths, real-path tests, scoped integration, honest estimates, and release proof. The regression and its short-circuit belong with the feature, not a new general value.
