# Inline terminal tab rename

## Scope

User: “why so complex menus modals and stuff bro just double click and rename if you want”.
Base: PR64 head 44d8270. Worktree: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_0a9aa8cb.
Branch: bruv/web-inline-rename. Parent updates PR64; no push or new PR here.

Double-click a title, double-tap it on touch, or focus a tab and press F2.
Enter trims and saves through the existing PATCH /api/tabs/:id API.
Escape, blur, a blank name or an unchanged name cancels. Only Enter submits.
Rename leaves the tab menu and shared dialog. Close confirmations, workspace
actions, terminal sessions, live ownership and local navigation stay intact.

## Why this shape

The editor holds one tab ID and its input node, not a second name store.
Keep tab nodes in place across snapshots: rebuilding them can break a real
double-click on its first click, lose the draft/caret, or trigger blur.
Shared names update the close label without replacing an open editor.
Deletion or leaving the workspace drops the edit without submitting it.
Remove stale shells before reconciling positions so deleting another tab
before the editor does not detach the focused input.

Stable buttons exposed a close-confirmation race in two early design runs.
Native Escape can restore focus before its queued close event. Reopening the
same button then lets that old event consume the fresh confirmation callback.
Settle dialog results at submit/cancel, before closing; ignore queued close
events. A focused regression cancels, immediately reopens, delivers the stale
close event, and still confirms the right DELETE. No dialog layout changed.

This is a direct-manipulation lesson for simple edits, not permission to
remove destructive safety. Added that distinction to the human-controls value.

## Proof

- TMPDIR=/var/tmp bun run check and bun run build passed.
- bun test tests/web: 51 passed, 0 failed, 427 assertions (9 files).
- Compiled browser-workspace-design.mjs passed at desktop and phone sizes:
  real double-click save/cancel, Home + F2 + Enter save, blank/blur cancellation,
  unchanged title geometry (<0.6px), long-name clipping, real touchscreen
  double-tap save/cancel, draft/focus/caret survival through shared rename,
  overflow navigation, captured close and empty states.
- Compiled browser-workspaces-smoke.mjs passed: real PTYs, input/output,
  switching/reload/reconnect, pending mic cleanup, observer safety and voice
  ownership. Compiled browser-multiplayer-smoke.mjs passed both with two
  independent contexts and two pages in one context. Concurrent rename keeps
  the input node, draft, selection and caret; Enter submits only its tab ID;
  remote deletion exits editing. Provider calls: zero.
- git diff --check and focused Biome formatting passed.

Browser runs use PLAYWRIGHT_CORE=/home/tnfssc/.cache/ci-speed-browser/release-browser/node_modules/playwright-core/index.mjs
and CHROMIUM_BIN=/home/tnfssc/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome.
All edited screenshot probes retain caret: "initial".
Logs: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_0a9aa8cb/artifacts/inline-rename/.

Opened and inspected these final frames under
/home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_0a9aa8cb/artifacts/workspace-design/:

- inline-rename-desktop.png (1100×720)
- inline-rename-phone.png (390×680)
- populated-desktop.png and populated-phone.png
- phone-long-tab.png and phone-close-dialog.png
- tabs-phone-overflow-terminal.png

The inline frames show a same-size title field, black Vesper terminal, bundled
font and official brand. Phone long-name/overflow frames still show sparse
terminal paint despite caret:initial; the populated and inline frames show
real output. This is the known capture gap from chrome-tabs.md, not a claim
that every terminal frame paints correctly. No unrelated renderer fix added.
PTY/input/output/reload assertions pass. Parent should judge those raw frames.

No Safari/iOS, physical phone/keyboard/mic, paid voice calls, full repo suite,
push, new PR or hosted CI claim. Parent integrates and checks PR64 CI.
