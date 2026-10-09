# Update download feedback

User hit a timeout updating 0.16.20 to 0.16.21. They also asked for download progress.

Parent integration: /home/tnfssc/.bruv/worktrees/bruv-update-download-feedback
Branch: fix/update-download-feedback. Base: 0610c218.
Timeout worker: task_005977ae, /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_005977ae.
Progress worker: task_2f20e906, /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_2f20e906.
Both workers must commit locally. Parent must review and combine them here, test the real output, then check files and commits. User later asked to open a PR; push and PR creation are now requested. No release or installed replacement was requested.

## Network evidence

GitHub API reports bruv-linux-x64 for v0.16.21 is 92,476,896 bytes.
A HEAD request followed the release redirect and returned HTTP 200 in 13.73 seconds.
A curl download probe in temporary storage returned HTTP 200 but timed out at 120.014 seconds. It received 7,376,878 bytes at 61,466 bytes/second. A full transfer at that rate takes about 25 minutes. This is observed slow network here, not proof of the exact user's network path or a broken release.
The installed version is still 0.16.20. No installed files were changed.
The current updater has a five-minute absolute request timeout. It gives installation-directory permission advice even for a network timeout. Fix both the time budget and the false hint. Add bytes, percent when total known, speed and ETA when useful. One live line for terminals; occasional plain lines for pipes.
Keep checksum, version checks, and paired rollback. No retries or install redesign are needed for this report.

## Still running

Both workers finished. Combined proof is below. Source is not shipped.
Values stay unchanged: existing honest-proof and real-visible-flow values cover this task. Keep local timeout/UI details here.

## Timeout integration

Worker afbd0668 is integrated as a28492e8. Its 15-minute choice used asset size and a hypothetical 1 Mbps link. Parent measured about 61 KB/s, so 15 minutes still would not fit the observed transfer. Integration changes binaries to 30 minutes. Metadata and checksums stay at five minutes. Final combined proof belongs here; worker proof in its own note applies to its original patch.

## Combined result

Timeout patch is a28492e8, measured budget change e5bd1a2a, and progress patch 534058eb. Resolve both updater pieces together: the streamed fetch uses the 30-minute binary budget and both stage calls keep their phase labels. Both callback and integrity/recovery paths remain intact.

Combined focused gate passes: 120 tests, 795 assertions across update, release shape, streamed progress, and compiled connector update. No test skips were added. Initial worker test failures and their fixes are in the worker notes. Timeout-only integration also passed 88 tests / 480 assertions.

The actual 80-column pseudo-terminal probe uses the real display with measured byte/rate samples. It rewrites one physical line, then ends it before the failure text. The plain probe shows the same metrics with no rewrite escapes. This checks terminal formatting, not a full live network update. Streamed response and compiled CLI tests cover the callback wiring using synthetic bodies and temporary pairs. No actual installed files were replaced.

Example final progress line:

    Downloading bruv-linux-x64 7.0 MiB / 88.2 MiB (7%) · 60.0 KiB/s · ETA 23m 5s

Both workers finished and their changes are combined. Final standalone typecheck, focused formatting (six files), and git diff --check pass. User asked to make a PR after the local checks passed. Push this branch and open against develop. No release or local installation was requested. The installed updater will not gain this behavior merely because source is fixed. Stop/restart guidance for real pair replacement stays unchanged.

Wisdom adds the task evidence and both worker notes; paired-update links the follow-ups. Values stay unchanged: this is one feature's time budget and display behavior, already covered by honest proof and visible real work.

## PR handoff

User asked to make a PR on 2026-10-09. Keep the tested code and wisdom together. Open fix/update-download-feedback against develop. No merge, release or installed update is part of this request. Values stay unchanged; this is delivery of the same checked feature.
