# Combined human remote UI + shared jobs integration

Completed-run captures/logs mentioned below are now historical Git evidence;
[recovery and retained inputs](../quality/completed-run-retirement.md). Conclusions remain here.

Integration worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_207191c2
Branch: die/combine-human-remote-ui-with-shared-jobs-207191c2

Merged the entire SSH jobs branch tip 6f9b05e into UI tip 2890f57 (which includes 9daf8a2) as merge commit 04e6b45. Both tips are ancestors; standalone wake helper 33f4fe5 is not. No parent checkout mutation, install, push, release or production SSH access.

## Seams

- Explicit human output still uses renderHuman and final assistant text extraction, not machine JSON. Footer uses the complete cached state, including session-owned tasks with unresolved attention.
- Cache observations project into the current session's shared jobs source. Autonomous die-remote task notices exclude all session-owned tasks: shared jobs own completion/action delivery. Other sessions cannot become this parent's jobs.
- Human direct/repository/menu launches retain jobSessionFile. Session start binds the refresher; shutdown clears interval and footer. The combined regression caught a session-start picker reset which could interrupt an open menu; removed the reset without weakening the existing picker test.
- New tests verify session-owned terminal observations do not duplicate chat notices, pending human attention remains in the footer, teardown clears it, and a direct human launch binds its parent while returning human text.

## Validation environment

Bun 1.4.2 at /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin, bash with SHELL=/bin/bash. Outer interactive fish reports untrusted mise config; explicit Bun/bashed commands avoid that startup issue without changing trust or installing anything. Dependencies reused via a local symlink to /home/tnfssc/Code/die/node_modules (not committed).

Real existing web runtime copied from /home/tnfssc/Code/die/dist/die-web, then built with bun scripts/build.ts --reuse-web. Packed archive SHA-256: 7686d28f46c1731ace8eab80dee6fdea0e9e2c0201337f72e461a40107bcfcbd. No placeholder web runtime or web source change.

Docker CLI/PTY fixture worker: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_207191c2-a86675007a5e-task_cb10aa51, branch die/combined-remote-docker-cli-and-pty-verif-cb10aa51, base 04e6b45. Parent jobs-semantics audit task_d2aba108 remains independently owned by the parent.

## Source and compiled validation

- bun run check: passed.
- bun run format:check: passed (428 files).
- bun run lint: exit zero, 549 warnings and 740 informational diagnostics; no lint errors. Not claimed warning-free.
- bun test tests/remote-extension.test.ts: 23 pass, 0 fail.
- bun test tests/live-*.test.ts: 285 pass, 3 opt-in skips, 0 fail (41 files). This is simulated/local regression coverage, not real microphone or paid-provider acceptance.
- bun test ./tests: final rerun 1,322 pass, 20 opt-in skips, 0 fail (190 files; 130.81 seconds). Initial run had 1,321 pass, 20 skips, one environmental failure: standalone web extraction hit ENOSPC on the shared /tmp tmpfs (16 GiB, 99% full). No assertion changed. The six web-runtime tests then passed unchanged using a worktree-local TMPDIR; full rerun used private disk-backed /home/tnfssc/.die/probe-207191c2. No other user's temporary data was removed.
- Compiled build passed using the existing real web runtime described above. Full suite includes standalone embedded web executable acceptance.

Text logs: [combined evidence (historical)](../quality/completed-run-retirement.md#recovery). Docker opt-ins are independently run by the fixture worker rather than misrepresented as covered by the default-suite skips.

All three Docker compiled gates passed unchanged: owner-continuation/native questions/repository return, PTY menus/quiet progress/human rendering, and print/JSON + two-parent jobs followup/isolation. See [compiled Docker report](combined-compiled-docker-2026-09-27.md) and [17 PTY frames (historical)](../quality/completed-run-retirement.md#recovery). Integration owner also inspected stable-active-polls, narrow-choice, and human-status frames. The Docker binary tested merge 04e6b45; subsequent production-source change is formatting only (git diff 04e6b45 HEAD -- src). No raw JSON fixture rewrite or interaction assertion weakening was needed.

Review/release remains parent-owned. Existing jobs dispatch acceptance/crash-uncertainty limits in jobs-integration.md remain unchanged; no exactly-once claim or real-provider/Live-audio proof is inferred.

 Values unchanged: existing actual-human-flow, single-owner, honest-uncertainty and isolated-evidence values already govern this merge.
