# Resume picker stream abort crash

Date: 2026-10-01. Pi 0.99.1. Bun 1.4.2 on Linux.

## Cause and fix

User saw uncaughtException AbortError with ABORT_ERR when resuming in this repo. The stack runs through cancelLoads and the stream abort signal.

Pi's buildSessionInfo returns early when the first parsed line is not a session header. Readline closes its iterator, but the input file stream stays open. Later cancellation can emit an error with no owner. A synthetic invalid-header file with more than one read buffer reproduces the same ABORT_ERR on Bun after SessionManager.list returns and its signal aborts. The pristine module exits 1. The adapted module exits 0. This proves the failure path, not that we identified a particular file in the user's history. Plain Node 24 probes did not reproduce it.

scripts/pi-host-adaptation.ts now owns an exact, hash-guarded SessionManager patch. Keep an error listener on each input stream through close. Readline still forwards active read errors to its iterator. Close readline and destroy the input in finally, including early returns. Ordinary unreadable files still become null; active cancellation still rejects. No process-wide AbortError filter.

prepare-assets accepts only the original or exact adapted SessionManager hash. Other source drift still fails closed. The disk-backed manager itself still leaves list/listAll native; this is a separate host fix.

## Proof

- tests/resume-stream-cancellation.test.ts: five subprocess cases cover current/all folders, late abort after invalid header, active abort, valid-session results, and a real read error from a directory named unreadable.jsonl.
- 21 tests passed across resume-stream-cancellation, pi-host, prepare-assets, and resume-safeguards after rebuilding the compiled CLI. This includes adaptation reverse/idempotence/drift checks and source/compiled entry points.
- Nine tests passed across resume-stream-cancellation, history-sdk-099, history-storage, and history-projection-parity after adding the read-error fixture. Persistent manager parity remains intact.
- bun run check, focused Biome format/lint, and git diff --check passed.
- Rebuilt dist/die with bun build --compile --minify src/cli.ts --outfile dist/die. Reused the unchanged packed web asset. An isolated PTY in this repo resumed a synthetic session into the editor with no uncaughtException or ABORT_ERR. It had no model credentials and made no provider call. The probe was terminated after observing the editor. Earlier unpatched PTY cancel probes did not reproduce the crash; the isolated Bun loader probe did.

No user history was changed. No full platform CI, release, push, or installation. The installed ~/.local/bin/die is still the earlier binary. Use ./dist/die -r here, or install the fixed build through the normal installer.

## Work handoff

Initial worker: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_5b70cc59, branch die/fix-stream-abort-crash-5b70cc59. It left the patch there without tests and hit an untrusted mise config. The parent stopped that worker after it made no further tool progress, applied its diff to /home/tnfssc/Code/die, added tests, and validated. The current workspace is the finished source of truth. The old worker worktree is not the final tested change.

Temporary probes were under /tmp/die-abort-unit-HIhzVf and /tmp/die-resume-probe-JblakJ. They are disposable; durable regression proof lives in tests. Future Pi upgrades must review this stream ownership patch and regenerate both hash guards.

## Values

No values change. Existing values already call for clear cancellation ownership, shipped-path checks, small guarded seams, and honest proof. This is a local recipe, not a new broad rule.
