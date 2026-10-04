# v0.16.4: compact connector and CLI activity groups

User authorized release after final integrated checks. Last published release is v0.16.3. Local develop has21 unreleased commits and was0 behind origin/develop after fetch. No user settings or installed binaries were changed.

## Candidate proof

Full combined CI:2013 passed,23 skipped,0 failed; standalone smoke passed. Final compiled CLI terminal scenarios rows/lifecycle/question/long_thread passed; parent reviewed actual frames, not only hashes. See ../tasks-ui/rolling-activity-next-pass.md and its parent-reviewed-report.json. Compact connector SDK, no-overrides T3 chat and six native suites passed before the last display-only integration. Release workflow must rerun native gates on its exact candidate assets.

Normal executable is92354016 bytes locally, shell launcher1831 bytes. Two version identities: --version declares2.1.280 protocol compatibility, --bruv-version supplies actual Bruv product version. Home and paired runtime overrides are optional; isolated SDK history home and full provider/model IDs still matter. See ../claude-compat/single-binary-checkpoint.md and thin-launcher.md. Old updater staging bridge is tested and documented; no checksum bypass.

## Release ownership and next step

Parent owns push, manual Release workflow dispatch on develop and metadata verification. Workflow prepares next stable version, runs CI/build/Linux native and Mac updater gates, then creates tag and publishes. Do not make an early tag or bypass failed gates. Notes owner task_f5731691 uses an isolated worktree; integrate its notes commit before push. Next: push integrated candidate, dispatch release.yml --ref develop, retain run ID, await run with gh run watch --exit-status. Verify published tag/source and20 named assets from metadata; do not download large binaries merely to rehash after successful CI.

No new release claimed yet. Upstream T3 history PR15598 is separate; do not imply official UI-only history support or full parity. Values unchanged: shipped-path proof, honest limits and one clear release owner cover this work. Finish with run/source/metadata record.

## Dispatched

Pushed develop8c7cc0f4 after integrating notes f7fe790b as c5a1b500. Notes worktree task_f5731691 can remain for provenance. Manual Release run37204735419 dispatched: https://github.com/tnfssc/bruv/actions/runs/37204735419 . Parent watch log artifacts/v0164-release-watch.log. Workflow will bump to0.16.4 and publish only after its gates. Do not dispatch a duplicate while this run is active.

## First run held

Run37204735419 failed only the actual Mac updater job111444307901. Build/CI/Linux updater and all final Linux2644 native gates passed; publisher correctly skipped. Version preparation committed20528c86 (package0.16.4), now fast-forwarded locally. Error: scripts/verify-update.ts:90 rollback probe did not meet nonzero exit + Previous installation restored stderr assertion; logged stderr was empty. Log artifacts/v0164-mac-failed.log. Signal/status/error were not printed, so do not infer the process cause yet.

Fix owner task_3d873323, branch bruv/fix-observed-mac-updater-rollback-gate-f-3d873323, durable worktree /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_3d873323. It owns narrow updater/probe diagnosis, preserves checksum/rollback assertions and returns a commit; parent owns integration and fresh hosted Mac proof. No blind retry or gate bypass. A new manual run will reuse prepared0.16.4 while latest tag remains0.16.3.
