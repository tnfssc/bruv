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
