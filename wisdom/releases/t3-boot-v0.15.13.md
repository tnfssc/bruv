# T3 boot fix and release v0.15.13

User sees `T3 Code could not load.` on latest stable v0.15.12. Fix underway. Do not publish until compiled browser boot passes.

- Fix worker: task_5adb044a. Worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_5adb044a`, branch `die/fix-released-t3-startup-failure-5adb044a`. Owns root cause and product regression tests.
- Release gate worker: task_6a1d394b. Worktree `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_6a1d394b`, branch `die/gate-release-on-browser-boot-6a1d394b`. Owns mandatory compiled browser gate, not product code.
- Research found release checks only prove CLI and transport, not browser boot. Existing preservation acceptance can run a relocated compiled executable with Chromium.

Next: review and combine worker commits, test integrated compiled binary, write release notes, push develop and dispatch Release workflow. Manual workflow prepares next patch version and publishes only after gates. Verify published release/assets without redundant binary hash download (see release-verification-preference.md). No local install requested.

Values reviewed. Existing delivered-path proof and human UI checks cover this bug; revisit after root cause is known.

## Integration

Cherry-picked gate 86f59ce as 3e8391c,
then fixed expected canceled trace exports in 1f50909. Product fix 25688b3 is
integrated as 8a3efcb. All worker code is reviewed.

Root gate passed cold boot and reload on the worker compiled candidate (proof
in artifacts/release/browser-boot.json). Root typecheck passed. Full local
canonical build is now running with the worker’s verified source checkout:
`DIE_T3_SOURCE=/home/tnfssc/.die/worktrees/die-a86675007a5e-task_5adb044a/.cache/t3-startup`.
The default source cache still has the old patch; do not reset someone else’s
cache. Initial attempts stopped before build due to that mismatch and missing
pnpm. Repo-local corepack shim `.cache/release-tool-bin` supplies pnpm.
Build log: `/var/tmp/die-t3-full-build.log`.

Prepared package/notes for v0.15.13. Push develop for exact-commit dry run,
then publish its tag only after local checks and hosted gates pass. CI now
requires final Linux browser cold load/reload as well as Mac updater/native gates.
Values: strengthened Value 1 with shipped-entry startup proof, linking root
cause wisdom. No new value.
