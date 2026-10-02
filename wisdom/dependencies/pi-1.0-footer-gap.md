# Pi fullscreen footer gap (2026-10-02)

User asked for a layout review, not a fix. Scrolling feels fine. Keep that apart
from the spacing issue. No product code changed.

## Seen in the installed product

Ran /home/tnfssc/.local/bin/bruv (version 0.15.24) in isolated tmux panes,
120 columns by 40 rows. Fresh temporary HOME and agent directory, offline mode,
fake OpenAI key, gpt-4o, no saved session, no provider request. Compared explicit
fullscreen and regular modes on the same binary. This is a renderer comparison,
not a run of the old release binary.

[Fullscreen](evidence/pi-1.0/footer-gap/fullscreen.txt): prompt row 37,
blank rows 38–39, footer row 40.
[Regular](evidence/pi-1.0/footer-gap/regular.txt): prompt row 5,
footer row 6. No blank row between them.
The startup warning is tmux's extended-keys warning, not conversation content.

Wrapped input confirms the reserved height:
[150 characters](evidence/pi-1.0/footer-gap/fullscreen-150.txt) use two editor
rows and leave one blank row; [270 characters](evidence/pi-1.0/footer-gap/fullscreen-270.txt)
use three editor rows and leave none. Nothing was submitted.

## Why

Pi 1.0's dist/modes/interactive/chat-viewport.js creates a fixed input dock.
Its editor slot has minSize: 3. That fits Pi's bordered editor.
Our src/ui/editor.ts CompactEditor.render drops both border rows and renders
one row for a short prompt. Fullscreen still allocates three rows, so two empty
rows remain below it. Regular mode stacks actual rendered rows and does not
apply that minimum.

The larger space ABOVE the input dock is a separate layout change. Fullscreen
lets the transcript grow to fill the screen and anchors input/footer at the
bottom. Regular mode places input/footer right after content. Do not remove the
fullscreen scroll view just to fix the two wasted editor rows.

Relevant commits: 34b8bd9 upgraded Pi; 6bc6e28 kept Pi's new fullscreen default.
The existing startup test checks alternate-screen entry, prompt presence and
absence of native borders. It does not assert the visible distance to the footer.

## Next step

If asked to fix this, adapt the fullscreen editor slot to the compact editor's
actual minimum height. Keep fullscreen scrolling and bottom anchoring. Add a
real terminal-frame assertion for prompt/footer adjacency, plus wrapped-input
coverage. Use the maintained host adaptation rather than an untracked edit to
node_modules. No fix or release has been made by this audit.

Values unchanged. Existing values 2, 8 and 9 already call for visible-frame proof
and reviewing user-facing changes during a dependency upgrade.

## Fix and PR in progress

User asked for a fix in a worktree and a pull request.
Worktree: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_56d2a750`.
Branch: `bruv/fix-fullscreen-compact-editor-footer-gap-56d2a750`.
Base: `b608e45`. Worker task: `task_56d2a750`.
Worker owns code, tests and commit. Parent reviews, pushes and opens the PR.
Keep fullscreen scrolling and bottom anchoring; fix the compact editor height.

## Independent old/new check

Read-only audit task `task_cff8369e` compared the published Pi 0.99.1 viewport
with installed Pi 1.0.0. The chat-viewport.js files are byte-identical
(SHA-256 `77ff3d8a3f20950a95cc3b758ab04ee7cffdaba5a490a2390626e781ae30f70a`).
The three-row minimum already existed in optional fullscreen. The new default
exposed it; the upgrade did not add new footer padding. Our editor/footer did
not change. One spacer above the editor is also unchanged from 0.99.1.
An actual-component layout probe at 80x12 and 80x24 independently reproduced
the two wasted rows. Setting the probe editor slot minimum to one removed them
and kept the footer anchored. The probe did not modify product files.

Focused review `task_b9019fca` found no blockers in the in-progress patch.
It checked the dynamic editor-slot minimum, native replacement preservation,
host preparation/runtime gate, and test coverage. Review did not rerun build.
Worker finished commit `333452d` with 54 passing tests (545 assertions), a fresh
build, typecheck, format and targeted lint. Parent reviewed the patch and visible
frames. See [fix handoff](pi-1.0-footer-gap-fix.md) for full proof and limits.
Parent owns push and PR. No merge, release or install requested.
