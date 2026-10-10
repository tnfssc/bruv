# Browser workspace surface

Keep real Bruv terminals central: one workspace rail and one tab strip. Shared tabs mean shared PTYs and input; navigation stays local. Use pure black, Vesper, the official logo and embedded Nerd Font. [Worktree/agent discovery and presence](agent-workspace-direction.md) remain deferred.

## Direct controls

Use name-first workspace rows, direct Remove and paths on demand. Duplicate folder names get distinguishing path suffixes. Folder entry is inline; bad paths retain the draft, focus and local error, including in the phone drawer. Opening an existing canonical folder selects its workspace ID rather than guessing a new tab.

One tab strip, no duplicate menus, reload control or healthy-state dashboard. Rename by double-click, double-tap or F2. Enter saves; Escape, blur, blank or unchanged names cancel. Keep the tab shell and editor node stable across shared updates so a first click, caret or draft is not lost. Remove stale shells before repositioning surviving ones. Shared names may change while editing; Enter compares with the current shared name so a local draft still expresses intent. Failed saves retain draft and focus.

Hide Close while editing and give its space to the field without moving neighbors. A partly clipped tab must not expose a clipped destructive target; selecting its label reveals it. Arrow/Home/End navigation stays on the strip. Save and confirmed close return focus to surviving terminal work; cancel returns to the invoker.

Keep compact destructive confirmation. Close and Remove affect everyone and can stop lingering descendants after CLI exit. Name the tab/path and shared impact; focus Cancel. Wrap long unbroken target names on phones. Settle dialog results at submit/cancel before closing, so a queued old close event cannot consume a newly opened confirmation.

Use native buttons with explicit types for actions and keyboard-focusable status details. Give dialogs initial labels before browser code sets target text. The phone drawer traps focus and leaves terminal work inert while open. Closing it restores access. If the last workspace disappears, close the drawer, clear inert and focus folder entry. Empty screens show the next action, not repeated subtitles or decorative cards.

## Honest state and recovery

Missing/invalid credentials show Access required, not an empty workspace. Other network failures are not auth errors. Initial list failure has one central Retry view; recovered errors must not return as stale banners. List-update loss and PTY loss have separate recovery.

Replay gaps show View lost and freeze that renderer. The original CLI still runs; New terminal leaves it alive. Never infer CLI exit from lost replay. See [server ownership](browser-terminal.md).

`/live` requests the submitting browser's microphone. Show phase and workspace/tab owner only when useful. Pending Cancel and scoped dismissible errors are not permanent mic controls. Navigation never transfers voice. Run `/live stop` in the voice tab before starting it elsewhere.

[Ghostty](ghostty-renderer.md) exposes real current-cell accessibility output only for the active pane. Do not restore old xterm options or add a transcript. Cancel held touches on hide/document hide/disposal; returning to a pane needs a fresh gesture, not just a visibility check.

## Controls, spacing and sources

Use selective daisyUI 5.7.47 native Button/Input CSS through [controls.css](../../src/web/controls.css). Keep the native dialog and custom editable tabs; no React, Tailwind runtime, library JavaScript or full stylesheet. The notice generator keeps the MIT license. Library adoption and green tests are not visual acceptance.

[Browser CSS](../../src/web/browser.css) owns shared spacing and semantic roles. Keep compact desktop controls and touch-sized phone controls, aligned headers/actions, matched title/editor insets, and whole-cell terminal fitting. Font, borders and logo ratio are separate concerns. Measure shared edges, overflow and focus states, then judge the whole populated view. Do not cure one screenshot with unrelated pixel nudges.

Vesper sources: [official editor theme](https://github.com/raunofreiberg/vesper/blob/9043f3849b776949445f0cd4990365959cca35a3/themes/Vesper-dark-color-theme.json) and [terminal ANSI port](https://github.com/mbadolato/iTerm2-Color-Schemes/blob/4a5043e87c32158f0d7d9f6cdd03f30804c58bce/ghostty/Vesper). The workspace uses #000000 rather than the site's #101010. Cursor uses official peach; selection uses official translucent white, not the port's brown. Retain the Vesper MIT notice.

Build from canonical [wordmark](../../site/assets/brand/bruv-wordmark-light.svg) and [icon](../../site/assets/brand/bruv-icon.svg). Do not recreate the brand in text. Embed them locally; no extra fetch or route.

Drawer focus wraps through rendered controls only. When a focused row disappears, focus returns to a surviving sidebar control without stealing a live dialog's focus. Rename keeps a stable panel name and uses the field font size on phones, not the smaller tab-title size. The shared dialog is a yes/no destructive confirmation, not a hidden name editor.

## Checks

[Browser regressions](../../tests/web/browser.test.ts) keep rename/draft/focus, shared updates, local selection and destructive cancellation. Use the [operator guide's developer commands](../../src/web/README.md#developer-checks) and the compiled [design](../../scripts/web/browser-workspace-design.mjs), [recovery](../../scripts/web/browser-recovery-design.mjs) and [multiplayer](../../scripts/web/browser-multiplayer-smoke.mjs) checks. Inspect populated desktop and phone views, including edit, overflow, drawer, errors and confirmations. A blank terminal capture can prove a form, not current CLI output; investigate the actual rendered view before calling it a capture artifact. Keep disposable captures and run receipts out of durable guidance.
