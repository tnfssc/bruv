# Update download feedback

User hit a timeout updating 0.16.20 to 0.16.21. They also asked for download progress.

Parent integration: /home/tnfssc/.bruv/worktrees/bruv-update-download-feedback
Branch: fix/update-download-feedback. Base: 0610c218.
Timeout worker: task_005977ae, /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_005977ae.
Progress worker: task_2f20e906, /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_2f20e906.
Both workers must commit locally. Parent must review and combine them here, test the real output, then check files and commits. No push, release or installed replacement was requested.

## Network evidence

GitHub API reports bruv-linux-x64 for v0.16.21 is 92,476,896 bytes.
A HEAD request followed the release redirect and returned HTTP 200 in 13.73 seconds.
A curl download probe in temporary storage returned HTTP 200 but timed out at 120.014 seconds. It received 7,376,878 bytes at 61,466 bytes/second. A full transfer at that rate takes about 25 minutes. This is observed slow network here, not proof of the exact user's network path or a broken release.
The installed version is still 0.16.20. No installed files were changed.
The current updater has a five-minute absolute request timeout. It gives installation-directory permission advice even for a network timeout. Fix both the time budget and the false hint. Add bytes, percent when total known, speed and ETA when useful. One live line for terminals; occasional plain lines for pipes.
Keep checksum, version checks, and paired rollback. No retries or install redesign are needed for this report.

## Still running

Both workers are running. Tests and terminal acceptance remain. Source is not shipped.
Values stay unchanged: existing honest-proof and real-visible-flow values cover this task. Keep local timeout/UI details here.

## Timeout integration

Worker afbd0668 is integrated as a28492e8. Its 15-minute choice used asset size and a hypothetical 1 Mbps link. Parent measured about 61 KB/s, so 15 minutes still would not fit the observed transfer. Integration changes binaries to 30 minutes. Metadata and checksums stay at five minutes. Final combined proof belongs here; worker proof in its own note applies to its original patch.
