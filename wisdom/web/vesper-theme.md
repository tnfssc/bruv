# Pure-black Vesper workspace

Branch: bruv/web-vesper-theme. Worktree: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_b3b833b2. Base: approved bruv/web-workspace-design (PR67). No push or PR.

## Sources

Inspected site/terminal.ts, site/styles.css and wisdom/landing-page/writing-sources/vesper-theme.jsonc. The public site uses Vesper: #101010 background, white text, #ffc799 accent. This workspace deliberately uses **#000000** for the page, sidebar, tab strip and terminal. Menus use #161616; borders #282828. No layout or visible controls changed.

Official source, also fetched over HTTPS (stored copy matches apart from whitespace):
https://github.com/raunofreiberg/vesper/blob/9043f3849b776949445f0cd4990365959cca35a3/themes/Vesper-dark-color-theme.json

The official editor theme has no ANSI palette. The 16 slots come from this terminal port:
https://github.com/mbadolato/iTerm2-Color-Schemes/blob/4a5043e87c32158f0d7d9f6cdd03f30804c58bce/ghostty/Vesper

Cursor uses official peach; selection uses official translucent white, not the port's brown. ANSI black retains #101010, intentionally dark on black; the gray and colored slots stay readable. The existing Vesper MIT notice is site/licenses/vesper.txt.

## TUI scope

xterm controls default foreground/background, cursor, selection and 16 ANSI slots. It does not override explicit RGB or the rest of the indexed palette. Pi's default dark theme emits RGB from OKHSL; Bruv UI components use Pi's theme tokens.

Web launch writes bundled src/web/vesper.json to a temporary directory and uses existing --theme PATH --use-theme bruv-web-vesper flags. All Pi tokens are covered; message/tool backgrounds stay black. The file lasts across tabs and is removed on normal shutdown. User CLI args follow these defaults, so explicit --use-theme wins. Saved theme settings and native defaults are untouched. Other programs' RGB output and later user theme choices remain their own colors.

## Proof

- bun run check/build and formatting/diff checks passed.
- Focused web/audio/launcher tests: 49 passed, 456 assertions. Compiled web proof checks peach RGB, launch flags, unchanged saved settings and theme-file cleanup.
- browser-workspace-design.mjs: desktop 1100×720, phone 390×680; active tabs, menus, dialogs, drawer focus, long names and empty states passed. Phone terminal height remains 624px.
- browser-theme-smoke.mjs: real shell PTY and built browser assets; computed page/xterm backgrounds rgb(0, 0, 0), white text, all 16 ANSI slots and explicit RGB passed; no phone overflow.
- Multiplayer: two browsers, shared CLI/input/output, workspace sync and observer-safe voice handoff passed. Compiled CLI fake-mic/real-relay/strict-CSP smoke passed. No browser errors or provider calls.

Viewed screenshots (paths relative to this worktree):
- artifacts/workspace-design/populated-desktop.png
- artifacts/workspace-design/populated-phone.png
- artifacts/workspace-design/tab-menu.png
- artifacts/workspace-design/populated-drawer.png
- artifacts/workspace-design/rename-dialog.png
- artifacts/workspace-design/phone-close-dialog.png
- artifacts/vesper-theme/ansi-desktop.png
- artifacts/vesper-theme/ansi-phone.png

Logs: artifacts/vesper-theme. Chromium Linux and emulated phone only; no Safari, physical-device, audible-speech or paid-provider claim. ANSI screenshots are labeled shell fixtures, not model output.

## Integration

Cherry-pick the theme commit. browser.ts edits only the Terminal theme object; CSS edits only colors. launcher.ts adds theme-file imports, setup and cleanup: keep them around the other worker's /live help/launch edits. Do not restore old mic controls during conflict resolution. No /live worker worktree or mic behavior was touched. Bun.build and embedded assets remain unchanged.

Values are unchanged: §§1, 2, 7, 8 and 10 already cover scoped work, honest proof, minimal UI and handoff. Palette and per-run details belong here.
