# v0.16.0 external connector release

Status: first release attempt failed before publication; corrected retry pending.
Run: https://github.com/tnfssc/bruv/actions/runs/37182001166
Submitted source: 0deee63feeac337f2aa7e37c45777530473d52e2.
Do not push develop while the gated workflow is running.
Watch job: task_6087e914; log artifacts/v0160-release-watch.log.

## What is ready

- Current develop through v0.15.30 is preserved.
- Bruv and bruv-claude-compat ship as a verified pair, no bundled T3.
- External official T3 2644 passes all six native gates on candidate pair.
- Full hosted Linux/macOS CI passed on preceding candidate35a7aa17; later changes were proof/harness corrections. Release must run its final-asset checks.
- Reviewed migration and known gaps are in support/release-v0.16.0.md.
- Proposal23 remains open and only its tool-history slice is included.

## Verify next

Require successful release workflow, published stable v0.16.0, and20 assets: four normal binaries, four connector binaries, eight checksums, LICENSE, SOURCE.txt, THIRD_PARTY_LICENSES.txt, THIRD_PARTY_NOTICES.md. Use hosted digest/source verification; do not download release binaries merely to rehash. Fetch prepared release commit after workflow finishes without overwriting local work.

Wisdom holds real gates, the upstream queue diagnosis and official2644 counterexample. Values unchanged: existing real-path proof and ownership rules cover the lessons.

## First attempt and correction

Run37182001166 stopped in native setup: hosted actions/setup-node has no /usr/bin/node. Validation/build gates were not bypassed. Maintained fixture launchers now use process.execPath, preserve only that executable directory plus system bins in their clean PATH, and the transparent tap uses env node. Shell fixture commands quote the actual executable. Setup uses configured node. Regression copies real Node outside /usr/bin and checks the tap and model shell command;27 focused tests pass. Typecheck/model tests pass, and unchanged2644 real command/idle replay with relocated Node passes (.cache/v0160-relocated-node-command). No production connector/T3 behavior changed.

Retry running: https://github.com/tnfssc/bruv/actions/runs/37182435634 at80a0ab895ae5d1e67889c3c1ea5cbe9d32831460. Watch task_be476721; log artifacts/v0160-release-retry-watch.log. Do not push develop until it finishes.

Retry37182435634 failed before native suites: workflow entrypoint still hard-coded /usr/bin/node. Build/deterministic tests/cross-builds/checksums/Linux updater and actual Mac updater/helper passed; publication skipped. Parent missed the YAML callsite in first portability fix. Native job now explicitly uses pinned actions/setup-node24.21.0 and invokes node from PATH. Added regression for job prerequisite ordering and no hard-coded system Node. No gate weakened.
