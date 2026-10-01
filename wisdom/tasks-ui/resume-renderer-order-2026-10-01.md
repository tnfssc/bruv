# Task rows move after in-app resume

## What the user saw

On v0.15.21, three completed task rows stay together at the launch during live use. After in-app resume, the launch shows its execute label. Each task row appears beside its later completion message. Assistant replies stay in place.

This is not terminal scrollback. The earlier [direct startup check](installed-resume-noop-2026-10-01.md) tested a different path.

## Cause

The task-row adapter only wraps components when Container.addChild runs. See src/ui/sdk-task-rows.ts:128–132. Its wrappers put each task at its launch component using sourceCallId and suppress repeated completion rows (lines 57–81).

In-app resume shuts down the old session and removes those wrappers (src/agent/extension.ts:969–971). Pi then rebuilds the transcript before binding the new session extensions. session_start loads the saved task rows and installs a fresh adapter (extension.ts:906–917), but the components already exist. They are never wrapped.

The ordinary execute renderer now shows the launch label. Ordinary completion renderers show tasks at their saved completion positions. That produces the user's exact layout. Saved task IDs and sourceCallId links are intact; this is not missing journal data.

Verified lifecycle in node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js:
- 345–347: replacement callback uses renderBeforeBind: true.
- 1538–1547: rebuild first, bind extensions second.
- 4687–4697: in-app resume switches sessions and prints Resumed session.
- 753–755: direct startup binds extensions first, then renders messages.

The investigator also found the same ordering and addChild-only hook in the installed binary. An in-memory render of a matching recent journal reproduced both layouts by changing only build/install order. Its cost differs from the user's paste ($0.094 versus $0.117), so do not identify it as the exact original session.

Multiple completion turns make the drift obvious. They are not the cause. Opening directly with --session works because its install/build order is reversed. The user's pasted Resumed session line identifies the in-app path.

## Next work

No product fix made. Ensure adaptation covers components built before installation, or install at the correct lifecycle seam. Do not keep stale session wrappers alive. Keep the existing saved ownership metadata.

Add build → install → render coverage alongside install → build → render in tests/task-rows.test.ts. Check real in-app /resume, not only --session startup. /reload has the same rebuild-before-bind seam and needs a focused check too.

Research jobs: task_70371146 (code/journal trace) and task_4cdaa873 (installed tmux proof). Shared workspace /home/tnfssc/Code/die, HEAD 9fd15a0. No code worktree: this was read-only product research. Installed captures are under /home/tnfssc/bruv-evidence/resume-async-v0.15.21-20261001-2102 and its -retry sibling. Both workers finished. Installed tmux reproduction confirmed the bug through the /resume picker with the exact natural prompt. Cold --session startup grouped the rows correctly. Natural repro session: 01a0f948-fb40-70fe-bec6-55e755809105. The three-completion copied-journal check also reproduced the full pasted layout. Full evidence report: /home/tnfssc/bruv-evidence/resume-async-v0.15.21-20261001-2102/REPORT.md. Private CLIs exited normally and private tmux servers were removed.

Values unchanged. Value 8 already calls for checking real reopen and session-switch flows. The missing coverage here is a concrete instance, not a new rule.

## Fix in progress

User asked to fix, check similar bugs, push and release. Primary fix: task_ec55a2df, branch bruv/fix-task-row-adaptation-across-resume-ec55a2df, worktree /home/tnfssc/.bruv/worktrees/die-a86675007a5e-task_ec55a2df. Related lifecycle audit: task_d6023c4c, branch bruv/audit-related-session-renderer-lifecycle-d6023c4c, worktree /home/tnfssc/.bruv/worktrees/die-a86675007a5e-task_d6023c4c. Parent integrates commits and releases through the manual Release workflow after checks. No release dispatched yet.

## Related lifecycle audit

Task d6023c4c found no separate concrete defect. It checked cli/startup, conversation-density, quiet-tool-ui, footer, resume-safeguards, TypeScript execution previews, and Pi replacement/rebuild/reset ordering. Other transcript adapters install before Pi starts and stay active through switches. Footer listeners/timers and picker wrappers have teardown. Execution animations stop on shutdown. 59 focused tests passed; an in-memory five-rebuild probe kept spacing, hidden-thinking suppression, and detached-method restoration. This was code/test review, not live UI proof. No speculative fixes added.

## Integration checks

Parent cherry-picked a25c9b9 as fb1d401 on fix/task-rows-resume. Reviewed the localized render hook and teardown behavior. 101 tests passed across task-rows, execution-previews, conversation-density, footer, and resume-safeguards (677 assertions). Configured Biome format and lint passed on changed source/tests; git diff --check passed. A broader biome check also enabled import-assist rules not used by project gates and reported existing import ordering; no unrelated rewrite made. Hosted CI and independent visual proof still pending.

## Independent UI acceptance

12/12 checks passed against integrated source 7f0002d (fix fb1d401). Actual tmux UI exercised cold startup, repeated in-app /resume and /reload, and repeated switches between two copied sessions. No moved, duplicate, or stale task rows. Pre-fix source reproduced four hot resume/reload failures. Parent reviewed cold and resumed captures. Evidence report, commands, exact revisions and 34 full capture sets: /home/tnfssc/bruv-evidence/resume-fix-20261001/ (fixed-source/). Capture display tool sometimes omits unchanged glyphs; worker checked original PNG conversation pixels and found them identical across cold/resume/reload/switch-back. No screenshot bytes altered. This is credential-free saved-journal source acceptance, not compiled release binary proof. Original journals unchanged; private tmux cleaned up.

After review, values stay unchanged: value 8 already covers real session switch/reopen flows and honest visual evidence. The concrete lesson and reproduction stay here.

## Hosted validation hold

PR https://github.com/tnfssc/bruv/pull/21 at 3399263. Hosted CI 36930539074 failed one unrelated MCP test: tests/t3/production-bridge.test.ts:373 saw delete at index 1 before settled at index 2. macOS passed. Release not dispatched; do not bypass this gate. Investigation task_a01fa749 owns branch bruv/fix-observed-mcp-shutdown-ci-failure-a01fa749 at /home/tnfssc/.bruv/worktrees/die-a86675007a5e-task_a01fa749. Base 3399263. Full CI failure log: /home/tnfssc/bruv-evidence/resume-fix-20261001/ci-failure.log. Parent will review and integrate the narrow fix, then rerun CI, merge PR, and dispatch Release on develop.

## CI test correction

Reviewed and integrated a7b915a as 04d3759. The MCP test observed remote server cancellation rather than owned client cleanup; those events have no required network order. The correction spies on actual client reader cleanup, and adds a deterministic cleanup gate proving DELETE waits. Removing the production drain caused the new assertion to fail. Worker ran 1,900 repeated bridge tests and 44 related tests; parent integrated bridge/task-row run passed 36 tests, 141 assertions. No MCP product change. Details and caveats in ../t3/mcp-close-ci-observation.md. CI will rerun; release remains gated.
