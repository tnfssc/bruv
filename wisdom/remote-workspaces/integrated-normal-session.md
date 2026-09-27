# Integrated normal-session remote follow-up (2026-09-27)

Production integration completed and committed; release remains parent-owned. Parent worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_90d61a8a, base 5c760e05dbd063c124577e108c66248825fd53f7. User says finish the whole normal-session path, Docker only; no external host, publishing, installation or push. Saved answers in user-decisions.md remain binding. Main Live stays execute-only.

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

The parent assembled production paths in 914da9b and completed recovery/offline integration in 26aa4c5. Native module 62c8e87, repo 22ec87e, explicit capability 3093c61/50b58b3 and artifact ea2f898 are integrated, not left as detached experiments. Current user-facing behavior and limits are in src/remote/README.md.

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

## Completed intermediate gate (26aa4c5 source)

Final rebuilt root suite **including** opt-in actual Docker/SSH acceptance passed: **1260 pass, 17 skip, 0 fail; 29139 assertions; 183 files; 196.71 s**. Command used installed Bun/Node, TMPDIR=/home/tnfssc/die-test-tmp-90d61a8a and DIE_REMOTE_E2E=1. Task task_f90ca122 completed successfully; raw log /tmp/remote-integrated-final-all.log. The Docker test passed in 66.09 s, now also asserting complete 9000-character execute stdout spill and full scoped native job text are cached, not merely their previews. Built CLI SHA256: **eab27a4c0177549ed3e90acd92e60c1445e227202ed76132ecd6f7b4a5d4e05c**.

Focused remote suite: **39 pass, 1 opt-in skip, 0 fail**, 242 assertions (/tmp/remote-integrated-final-unit.log). Final check/format/lint passed; lint retains existing warnings and infos, not suppressed. Full suite includes real tmux Pi/Live presentation tests; active loadout remains execute-only. These are Linux/fake-provider proofs, not Mac/audio hardware or paid-provider proofs.

Read-only final boundary review task_c6ead351 reported no confirmed blocking defect in artifacts, native job text pagination, cursors, reply identity/status and owner/epoch checks. It did not finish owner/cancellation/human-question review, so do not represent that as a full independent sign-off. Those paths are covered by parent source review, targeted tests and actual Docker/native lifecycle acceptance. Earlier independent terminal-pagination finding is fixed with a regression.

No remaining blocker to parent review/integration was observed. Deliberate supported-scope limits are documented in src/remote/README.md: conservative regular-file return, explicit credential/config-path denial, bounded text/requests, honest gap/unknown states, trusted repo/SSH user assumptions and no fleet/host deployment proof. The parent should review all commits from 5c760e0 through afd3a8c plus this wisdom update, integrate, run exact-SHA release/web/platform gates, and only then push/release. No CLI binary was installed; no commits were pushed and nothing was published. Values stayed unchanged because all fixes reinforced existing whole-path, durable ownership, bounded-use and honest-state principles.

### Last recovery hardening after the 26aa4c5 gate

Parent review found two narrowly defined recovery holes and added regressions: a control-process crash after durable answer receipt but before command-slot publication could leave a safely retryable reply stranded; recovery now republishes only that exact never-dispatched slot, never an existing possibly-dispatched same-ID command. Also, explicitly granting the same capability after revocation used the revoked ID; an explicit regrant now rotates to a persisted new identity, while retries reuse that new identity and the old grant remains revoked. Targeted tests passed (13 owner/client tests, then 6 mailbox/owner tests). Exact final rebuilt gates are being repeated before handoff; the 1260-pass result above remains evidence for 26aa4c5, not a claim that these last changes skipped testing.

The final source is frozen at **afd3a8c**. A rerun that was already running while the new regrant regression was added loaded the old services module and new test, producing one mixed-snapshot failure; this is not accepted as a gate. A clean fresh process rebuilt from committed afd3a8c completed task_47f31497 successfully with logs /tmp/remote-afd3a8c-{check,format,lint,unit,build,all}.log. No source edits during this gate.

## Final accepted handoff — afd3a8c

Frozen-source final gate passed: **1261 pass / 17 skip / 0 fail**, **29161 assertions**, **183 files**, **196.15 s**, including actual normal CLI Docker/SSH fake-provider acceptance and Live TUI regression. Focused remote suite: **40 pass / 1 opt-in skip / 0 fail**, 248 assertions. Typecheck, repository-wide format check and lint passed (476 warnings / 636 infos retained, not suppressed). Exact logs: /tmp/remote-afd3a8c-{check,format,lint,unit,build,all}.log. Task task_47f31497 exit 0. Built CLI SHA256 **7a8bec3f225ce31ddcf3ea4b35626bddad5d196e8f8f2435c9d293a17c02be72**.

Both late recovery fixes are in the tested commit **afd3a8c**; no source edits occurred during this final gate. This wisdom-only follow-up records the result. Parent worktree and branch remain /home/tnfssc/.die/worktrees/die-a86675007a5e-task_90d61a8a, die/finish-complete-integrated-remote-workfl-90d61a8a. Working tree was otherwise clean before this note. No remaining implementation blocker observed within the documented supported scope. Parent owns review/integration and all publication/install/release actions. Values unchanged for the reasons above.
