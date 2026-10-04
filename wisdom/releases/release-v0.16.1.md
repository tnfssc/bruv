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

PR CI 37188645978 passed Linux x64, macOS Live (no devices/API), docs planning, and CI policy at head 9c7caa7f. Marked ready, confirmed clean/mergeable against unchanged develop, and merged with the usual merge commit: 49f97347723fc63b6210eca0d2111990fea4d0eb on 2026-10-04. Release preparation uses the repository script to select v0.16.1 while preserving handwritten notes. Normal Release workflow and published asset verification are pending. Do not treat dispatch as publication. Preserve the paired Linux/macOS version and updater/native gates and digest/size/exact-set verification for all assets. Do not download binaries merely to repeat CI hashes.

## Values

Read values and release procedures. Values unchanged: whole-path verification, honest limits, safe recovery, and preserving unrelated work already cover this release. No new general lesson.
