# Pi MCP and codemode audit

Checked 2026-09-30. Pi 0.99.0 added MCP and codemode; die already pinned 0.99.1. The user asked for an audit, approved removal, then requested a new release.

Pi CLI main prepends built-in extensions. Plain SDK sessions do not. Die uses main, so its execute-only active tool selection did not stop MCP connections or later tool activation. Project MCP config needs project trust. The right seam is inherited factory registration and command handling, not tool hiding or user settings changes.

Implementation and proof live in [Pi MCP/codemode removal](pi-mcp-codemode-removal.md). Worker commit 781c36f was integrated as 4234527. Independent read-only review task_d1193912 found no correctness blocker; it did not run tests. Parent check and compiled build (--reuse-web) passed. First full deterministic run (task_68a8ba86) had 1376 pass / 20 skip / 1 failure: standalone web extraction failed ENOSPC on /tmp (16 GiB tmpfs, 99% used). No source/test change was made for this. Full rerun task_15e243c2 passed: 1377 pass, 20 skip, 0 fail (1397 tests / 197 files / 30929 assertions). It used TMPDIR=/home/tnfssc/.die/tmp-pi-removal on the home filesystem (132 GiB free). Logs: /home/tnfssc/.die/tmp-pi-removal-tests.log and /home/tnfssc/.die/tmp-pi-removal-tests-home.log.

Release next: v0.15.14 notes are prepared. Validation passed. Next commit notes/wisdom, push develop, and dispatch release.yml on develop. The manual workflow prepares the version and publishes only after all gates. Confirm successful workflow and published assets. Do not download binaries just to repeat CI hashes; see [release verification preference](../releases/release-verification-preference.md). No release has been dispatched yet.

Values unchanged. Existing dependency behavior review, delivered-path proof, and durable handoff cover this work.
