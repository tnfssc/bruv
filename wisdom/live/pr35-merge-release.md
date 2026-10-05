# PR 35: CI, review, merge, release

User asked to fix CI, wait for CodeRabbit, address comments, merge, then release.
PR: https://github.com/tnfssc/bruv/pull/35
Head: t3code/buffer-live-recording at 156877a1. Base: develop.
T3 PR watching is on. Do not merge from a wake alone; check current SHA/checks/review.

CI run 37354320182 failed on Linux and macOS because a new offline fixture test
spawns ffmpeg, absent on both runners. Parent delegated the repair, not paid tests.
Job: task_c96a95bc
Worktree: /home/tnfssc/.bruv/worktrees/t3code-bc92964a-5442693331ce-task_c96a95bc
Branch: bruv/fix-pr-35-ci-failures-c96a95bc
Worker must return a small fix and validation; parent checks and integrates it.

CodeRabbit is processing the original head. No inline comments yet at first check.
Wait for it, then fix valid findings and reply with proof. No production Live
buffering is shipped by this test-only PR; keep release wording honest.

Latest published release at first check: v0.16.8, 2026-10-05T15:50:58Z.
Release recipe: wisdom/releases/manual-release-dispatch.md. After merge, use
Release workflow_dispatch on develop. Do not invent a manual tag/version path.
The same run prepares version, runs all gates, checks exact SHA and publishes.
Watch through Publish; prepared commit is not a release. Check release and assets.
Do not download binaries just to recheck hashes: release-verification-preference.md.
Do not launch a duplicate dispatch after an uncertain result; inspect runs first.

Remaining: integrate CI fix, handle CodeRabbit, push and wait for fresh CI/review,
merge exact passing head, dispatch release, confirm published assets.
Values unchanged so far: existing exact-proof, honest-status and lifecycle rules apply.

## CI repair checked

Worker commit 386ad7f0 brought back as 477d87ef. Both CI lanes install ffmpeg
before the offline PCM test. Parent focused rerun: 12 passed. Worker macOS lane
command on Linux: 305 passed, 3 skipped (not native macOS proof). Full Linux
tests had an unrelated connector shutdown failure; hosted gate must decide.

Parent found release workflow also runs the full tests but lacks ffmpeg.
Follow-up job task_4aa11d7e adds it to existing apt prerequisite step and tests order.
Worktree: /home/tnfssc/.bruv/worktrees/t3code-bc92964a-5442693331ce-task_4aa11d7e
Branch: bruv/cover-release-ffmpeg-prerequisite-4aa11d7e
CI repair not pushed yet; batch with release prerequisite fix.
CodeRabbit had no inline comments or completed review at last read. PR watch stays on.

## Ready for fresh hosted checks

Release fix 39c2f24a brought back as 6e53bcd2. It adds ffmpeg to existing apt
install before the full release tests. Focused release tests: 20 passed.
User also asked to update PR metadata. Title and body now describe real speech
proof, CI/release prerequisites and test-only scope; no shipped buffering claim.
Remaining: push these fixes, wait for CodeRabbit/latest CI, handle findings, merge
the exact passing head and dispatch the existing release workflow on develop.

## Passing checks are not latest review proof

All five GitHub checks passed on 8ca9efa3. Parent confirmed same SHA and mergeable.
No inline review comments or submitted reviews exist. CodeRabbit summary reviewed
156877a1 with no blocking issue, but later automatic review was skipped because
the repo has fewer than ten stars. Success is not review of the current changes.
Manual full review requested: issuecomment-6000688805. PR watch remains on.
Original review docstring warning (41.18%, target80%) is being addressed with
useful short docs on named helpers only. Job: task_a089d9b1.
Worktree: /home/tnfssc/.bruv/worktrees/t3code-bc92964a-5442693331ce-task_a089d9b1
Branch: bruv/address-coderabbit-probe-docstrings-a089d9b1
No merge/release yet. Check latest CodeRabbit findings, integrate docs, push,
wait for exact latest SHA CI/review, then merge and release as authorized.

## CodeRabbit quota

Manual review request was rate limited: issuecomment-6000690591. Included
review available in40 minutes. Do not enable usage-based billing.
One-shot retry is scheduled for 2026-10-05T19:15:32.594Z (40-minute interval
with self-delete on first run). Title: PR35 CodeRabbit quota retry — one shot.
ID: scheduled-task:command:mcp:4da20770-16d9-4d9d-b424-6179b5a19939:schedule-task:pr35-coderabbit-quota-retry-20261005-1835
Delete that schedule at first execution, or if review becomes available sooner.
Post one manual full review if still needed, then wait on PR watcher.
No merge/release yet. Docstring worker task_a089d9b1 still running.

## Docstring warning addressed

Doc worker commit3ceea323 brought back as81209b1a. Short docs now explain named
probe, fixture and queue helper bounds/readiness. Parent joined duplicate comments
and kept this local lesson here instead of adding a one-off rule to values.md.
Values unchanged: existing readable-handoff guidance covers it. Worker13 tests
passed; parent will rerun the focused suite before pushing. Retry schedule remains
2026-10-05T19:15:32.594Z. Merge/release still waits for actual CodeRabbit review.
