# v0.16.1 — long-thread partial improvement

## Ownership and authorization

User explicitly requested “merge and release” after learning the first held-input sample still took 482 ms. This authorizes shipping the partial improvement, not calling the unchanged 100 ms gate green. No latency rewrite, threshold change, or local binary installation is in scope.

Release worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_a442bad2
Branch: bruv/merge-pr-26-and-release-the-latency-impr-a442bad2
Integration source: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_43fd9f57, fix/long-thread-full-frame-latency.

## Preparation

Fetched upstream: develop 8b947729; latest published version v0.16.0 at 3eec281b. PR #26 head 4f22d488 was mergeable, but Linux CI 37186756720 failed formatting of the two evidence JSON files. Worker commit 90ed80d8 was integrated as c2be90ef; parsed JSON is identical before/after for both files, format check and diff whitespace check pass. Worker worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_a442bad2-5442693331ce-task_bca08695; branch bruv/fix-pr-26-evidence-formatting-bca08695.

The next CI run 37188229505 reached deterministic tests and failed five startup fixtures: the mock named old ensure-tool.js instead of Pi 1.0.0's tools-manager.js, so clean CI performed real managed-tool discovery/downloads before rebind. Worker 55925c7e integrated as 9c7caa7f corrects only that seam and adds assertions that both fd/rg used it. All five scenarios pass with CI=true, TERM=dumb, empty HOME and no credentials; parent repeated 5/5. Worker: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_a442bad2-5442693331ce-task_299bbe2f, branch bruv/fix-sdk-startup-fixture-ci-blocker-299bbe2f. No production sources or latency measurements changed in these release-blocker fixes.

Locked Bun 1.4.2 installation applied the tracked Pi 1.0.0 grammar patch. Official builds produce both bruv and bruv-claude-compat. Handwritten support/release-v0.16.1.md states improved typing/loading animation and the remaining submission-time pause. Full benchmark evidence and compiled-profile limitations remain in [the original handoff](../tasks-ui/full-frame-latency-followup.md); its draft recommendation is superseded by the explicit user shipping decision, not by a passing latency measurement.

## Publication status

PR CI 37188645978 passed Linux x64, macOS Live (no devices/API), docs planning, and CI policy at head 9c7caa7f. Marked ready, confirmed clean/mergeable against unchanged develop, and merged with the usual merge commit: 49f97347723fc63b6210eca0d2111990fea4d0eb on 2026-10-04. Release preparation uses the repository script to select v0.16.1 while preserving handwritten notes. Prepared release commit: 8e687ef00bda8e58cb60f7b6ddd100698ce7f185. Release workflow: https://github.com/tnfssc/bruv/actions/runs/37188844249 (manual dispatch at that SHA). This first release run failed deterministic tests with manager.getSessionId missing: the cached SDK estimator was called through a previously installed shake wrapper with a projection-only manager. PR CI passed but the release suite exposed an installation-order interaction. Downstream pair/native/updater/publication jobs were skipped; GitHub release v0.16.1 was not found. Serial release order (unlike partitioned CI) inherited process-global SDK wrappers from native shake tests. Worker 6ce258f7 integrated as b39d0f4e isolates the five disk-owning connector suites in fresh child processes. Original test bodies transpile identically (independently verified by parent); no production code or assertions changed. Exact before/after reproduction went from two matching failures to zero. Frozen install, official paired build, format/lint/typecheck, offline transport, smoke and full serial suite passed: 1,944 outer tests, 28 opt-in skips, zero failures across 274 files, plus preserved child assertions. Worker worktree /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_a442bad2-5442693331ce-task_7dec828d, branch bruv/fix-release-suite-adapter-order-blocker-7dec828d. No v0.16.1 tag exists; a fresh normal dispatch on the corrected SHA is appropriate (not rerunning old gated artifacts). Do not treat dispatch as publication. Preserve the paired Linux/macOS version and updater/native gates and digest/size/exact-set verification for all assets. Do not download binaries merely to repeat CI hashes.

## Published and verified

v0.16.1 published at 2026-10-04T09:00:12Z: https://github.com/tnfssc/bruv/releases/tag/v0.16.1. Final release/tag commit cb32e158227dad6272af9ccf6fad2731f46ec62d; successful workflow https://github.com/tnfssc/bruv/actions/runs/37190223990. All six jobs passed, including the full Linux suite/build/smoke, native macOS helper, final Linux pair against unchanged official T3 nightly 2644, actual Mac paired-version/updater/helper gates, and publication. The Linux and Mac gates execute both matching 0.16.1 versions; Linux arm64/Android are cross-built, not claimed native execution.

Published release is neither draft nor prerelease. Tag and SOURCE.txt match the gated commit. Exact set of 20 nonempty assets: eight binaries, eight checksum files, source and three licensing files. Publication verifies every asset size/digest/exact set; additionally all eight small published checksum manifests match GitHub binary asset digests. [Metadata](v0.16.1-publication.json). No binaries downloaded for redundant hashing and no local install.

Nothing remains unfinished for merge/publication. The accepted latency limit remains: first held input 482 ms against unchanged 100 ms, request setup about 2.5 s. No claim of new timing acceptance, physical audio, paid-provider acceptance, or all-platform native execution.

## Values

Read values and release procedures. Values unchanged: whole-path verification, honest limits, safe recovery, and preserving unrelated work already cover this release. No new general lesson.
