# Integrated normal-session remote follow-up (2026-09-27)

Work in progress, not a completion or release claim. Parent worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_90d61a8a, base 5c760e05dbd063c124577e108c66248825fd53f7. User says finish the whole normal-session path, Docker only; no external host, publishing, installation or push. Saved answers in user-decisions.md remain binding. Main Live stays execute-only.

## Ownership / resume

- Native targeted questions, durable replies, progress/reconnect, cancellation and profile: task_3186c2c0, /home/tnfssc/.die/worktrees/die-a86675007a5e-task_90d61a8a-a86675007a5e-task_3186c2c0. Own existing src/remote production modules.
- Repo snapshot / safe return: task_1e761842, /home/tnfssc/.die/worktrees/die-a86675007a5e-task_90d61a8a-a86675007a5e-task_1e761842, branch die/remote-repository-snapshot-and-safe-retu-1e761842. New repository modules; parent wires transport/CLI.
- Explicit repo-local capabilities: task_8102da11, /home/tnfssc/.die/worktrees/die-a86675007a5e-task_90d61a8a-a86675007a5e-task_8102da11, branch die/remote-explicit-local-capabilities-8102da11. New capability modules; parent wires transport/CLI.
- Normal CLI Docker acceptance: task_965e3f89, /home/tnfssc/.die/worktrees/die-a86675007a5e-task_90d61a8a-a86675007a5e-task_965e3f89, branch die/integrated-docker-normal-cli-acceptance-965e3f89. Own scripts and fake-provider fixtures.
- Parent owns assembling all hooks, typed execute bridge, truthful prompts/docs, combined regression and review.

## Environment / baseline evidence

Installed Bun is /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun; Node /home/tnfssc/.local/share/mise/installs/node/24.21.0/bin/node. Mise emits untrusted-config warnings but invoking installed tools works. Frozen-lockfile install passed. Full web build initially hit missing pnpm, not a remote product failure. For CLI iteration copied unchanged /home/tnfssc/Code/die/dist/die-web into this worktree and used scripts/build.ts --reuse-web, then bun run check: passed. This does not replace parent's release web gates.

Baseline rebuilt normal CLI Linux Docker/SSH fake-provider lifecycle passed (/tmp/remote-integrated-baseline-e2e.log). This is first-slice baseline, not evidence for pending integration. No Mac or real provider claim. Values unchanged: this work applies existing whole-path, durable ownership and honest state values.

## Assembly and recovery fixes

The parent assembled production paths in 914da9b and subsequent reviewed work (pending final commit). Native module 62c8e87, repo 22ec87e, explicit capability 3093c61/50b58b3 and artifact ea2f898 are integrated, not left as detached experiments. Current user-facing behavior and limits are in src/remote/README.md.

- Snapshot transfer now sends an orphan commit, not local history; a cloned-bundle regression checks the old secret blob is absent. Local shared Git objects avoid copying history during preparation. Known credential/config paths and configured clean/smudge filters are rejected. Regular remote untracked result bytes are retained in a review patch.
- Parent integration fixed prepared task-directory adoption (upload creates the directory before launch), preserves result receipts across concurrent sessions, and decouples safe code return from offline artifact failures.
- SSH response buffering is byte-bounded with forced teardown; remote control awaits stdout flush before the CLI exits. The actual Docker run caught pipe-buffer truncation after larger journals.
- Native answers are human-only, target owner/version, retain per-reply receipts across multiple questions, and expose uncertain/delivered state. Stale targeted IDs or missing answer text cannot fall through to another question. Terminal replies cannot reopen work.
- Partial terminal transcript catch-up is auto-retried after a crash/disconnect. Parent regression and independent review task_46674cda reproduced the same first-page-done/second-page-failed bug before the fix. Review worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_90d61a8a-a86675007a5e-task_46674cda, branch die/review-integrated-remote-safety-and-reco-46674cda.
- Explicit read-only grants, pending requests, replies and revocations persist. Concurrent mailbox instances share a bounded request gate. Missing grants/offline clients really wait; neither host selection nor grants nor human answers are exposed to agent execute.
- Native cancellation uses the existing scoped job owner and confirms idle/no-live-jobs before cancelled. Accepted-before-start cancellation suppresses the task prompt. Missing/partial stop checkpoints remain unknown.
- Task-owned execute spill/session artifacts are hash-verified and cached. Native job text is copied from scoped in-memory job buffers before owner exit; any already-lost output is explicitly reported as a retention gap. Artifact worker path /home/tnfssc/.die/worktrees/die-a86675007a5e-task_90d61a8a-a86675007a5e-task_4dcc4421 (branch die/durable-offline-remote-text-artifacts-4dcc4421).

Expanded acceptance worker task_bb5e10c4 stalled without edits and was stopped; its lasting worktree is /home/tnfssc/.die/worktrees/die-a86675007a5e-task_90d61a8a-a86675007a5e-task_bb5e10c4. Parent implemented and ran the combined acceptance. No work from that stalled worker was imported.

## Evidence before final gates

Actual rebuilt normal CLI + disposable Linux Docker pinned SSH + deterministic fake provider passed native answers/continuation, detached owner completion, automatic reconnect, offline human transcript, tracked dirty snapshot/index-preserving safe return, changed-local review patch, explicit offline-waiting file/tool/skill grants, native background-job cancellation and cached text artifacts. Log /tmp/remote-integrated-all-e2e.log; binary SHA256 d22e522ada7d48f318f6a23f86612df26188a7f1f5ecbeb80f8a31e8cc836d9e. Production does not inspect fixture markers to decide completion.

First broad regression had 12 failures: ten from untrusted mise shell diagnostics contaminating command output, one from a test path containing “cache/”, and one real partial-terminal pagination bug. Read mise.toml (only pinned tools), trusted this worktree, retained actual installed tool paths, used /home/tnfssc/die-test-tmp-90d61a8a for disposable tests, and fixed the actual bug with regression coverage. Subsequent root suite passed 1251 / 18 skip / 0 fail (/tmp/remote-integrated-full-clean.log). No test was weakened to suppress mise output.

Final typecheck/format/lint pass (existing lint warnings remain). New final full rebuilt suite including opt-in Docker acceptance runs as task_f90ca122, /tmp/remote-integrated-final-all.log; do not claim that gate complete until its result. A small additional test proved active task control must not depend on a subsequently removed default profile; fixed control-only hello validation while preserving clear connect/new-default configuration errors.

Final boundary review task_c6ead351 reads current parent files; worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_90d61a8a-a86675007a5e-task_c6ead351, branch die/final-integrated-remote-boundary-review-c6ead351.

Release wisdom was read. No package version bump, install, push, publish or release dispatch performed. Reused unchanged embedded web assets for CLI iteration; parent still owns exact-SHA web/platform/updater/release gates. No Mac or real-provider proof. Values unchanged: integration, durability, scope and honest partial-state findings apply existing values, not a new broad principle.
