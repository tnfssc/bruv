# Quiet browser terminal workspace

Follow-up: [command-owned microphone](live-command-microphone.md) removes the top-right mic button. The minimal workspace design remains; voice feedback is passive and shown only while in use.

Worktree: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_818e973e
Branch: bruv/web-workspace-design, based on bruv/web-multiplayer at 4fe62e80.
No old shipped worktree edits. No push, PR, release, or install.

## Design

Palette update: [pure-black Vesper workspace](vesper-theme.md) supersedes the charcoal/sage colors below, not the layout.

The PR65 demo passed functional checks but failed design acceptance. A real terminal is necessary, not sufficient. The old phone shell used about 300px before the terminal began. Cards and always-visible action buttons competed with the work.

The new shell uses a 212px charcoal sidebar, folder marks, subtle selected rows, and truncated secondary paths. Connected tabs use a restrained surface and sage underline. Add stays visible; rename/close and reload/remove move to keyboard menus. Folder, rename, and destructive flows use compact HTML dialogs, not browser prompt/confirm sheets. Destructive dialogs name the shared effect and focus Cancel. Menu-opened dialogs return focus to the trigger.

Connection is a labeled dot. One mic control retains its explicit attachment owner. Focus or hover reveals status and workspace/tab owner. An observer can inspect ownership but cannot stop another browser's mic. Healthy status no longer takes a separate row. Errors and disconnected input remain visible. On phones, one 44px strip replaces stacked toolbars; the workspace drawer traps focus and leaves the terminal inert until closed.

Terminal, state, server, relay, geometry, and audio protocols stay intact. No fake terminal, metrics, dashboard cards, gradients, provider calls, or new dependencies. Existing action IDs remain inside the new menu/dialog flows. Truncated tab names remain accessible in full.

## Rendered evidence

Ignored artifacts live under this worktree's absolute artifacts/workspace-design directory. Before frames came from the baseline compiled CLI before source changes. After frames came from the new compiled CLI with real PTYs, multiple workspaces, and multiple tabs.

- Before: before-desktop.png (1100×720), before-phone.png (390×680).
- Same populated scenario after: after-desktop.png, after-phone.png, after-drawer.png, after-voice.png.
- Natural project labels and three tabs: populated-desktop.png, populated-phone.png, populated-drawer.png.
- Details: tab-menu.png, rename-dialog.png, phone-close-dialog.png, phone-long-tab.png, empty-tabs-phone.png, empty-workspaces-desktop.png.

All listed before/after, menu, dialog, long-name, and empty-state frames were opened and visually inspected, not only asserted by scripts. Final visual acceptance belongs to the parent. Phone terminal height is 624px in a 680px viewport; no horizontal page overflow.

The read-only reviewer found no terminal/multiplayer/voice regression and identified menu-dialog focus return. Fixed it and proved Escape return in Chromium. UI proof checks menu arrows, blank rename, cancellation, destructive Cancel focus, drawer focus trap, empty-state actions, and long names.

## Checks and limits

Final checks in this worktree:
- bun run check: exit 0. bun run build: exit 0.
- bun test tests/web tests/live/browser-audio.test.ts tests/t3/web-launcher.test.ts tests/t3/web-launcher-process.test.ts: 45 passed, 0 failed, 376 assertions, 8 files.
- browser-workspace-design.mjs: exit 0; 1100×720 and 390×680; terminal height 624; menu/dialog/drawer focus, cancel, empty states, long names passed.
- browser-workspaces-smoke.mjs: exit 0; four real CLI PIDs, separate cwd/input/output, shell job across switch/reload, visible resize, replay/reconnect, keyboard/paste, cancel/delete cleanup, explicit voice owner and /live mic-check.
- browser-multiplayer-smoke.mjs: exit 0; two independent contexts shared PID 2830929, shared input/output, live workspace/tab sync, local selection, observer-safe voice, explicit handoff, providerCalls 0.
- browser-smoke.mjs: exit 0; compiled CLI + Chromium fake mic + real relay + strict CSP /live mic-check, no browser errors.
- browser-audio-probe.ts: exit 0; 8 capture frames / 5120 bytes, playback/gates/flush, stop/reconnect, browser disconnect observed, providerCalls 0.
- git diff --check and targeted Biome formatting passed.

Logs sit beside the images: focused-tests.log, design-check.log, after-workspaces.log, after-multiplayer.log, terminal-smoke.log, audio-probe.log. The earlier failing setup-only fixture log is kept as focused-tests-stale-fixture.log.

Browser tools:
- CHROMIUM_BIN=/home/tnfssc/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome
- PLAYWRIGHT_CORE=/home/tnfssc/.cache/ci-speed-browser/release-browser/node_modules/playwright-core/index.mjs

Playwright remains an external test tool. Baseline workspace smoke passed. Initial after runs exposed script assumptions about visible tooltip text and permanently visible mobile workspace controls. Scripts now use real drawer/menu/dialog flows; shared PID, cancellation, cleanup, input/output, replay, resize, and voice assertions remain. A stale setup-only process fixture called plain web; corrected it to web --setup, matching the existing launcher contract. No launcher behavior changed.

No paid provider or physical audible-speech acceptance. Chromium voice checks use fake media. No Safari, iOS keyboard, or physical touch-device claim. Full repository suite not repeated for this browser-only redesign.

Values §8 now requires judgment of actual populated desktop/phone renderings, not green functional tests or tiny demo frames. This corrects the acceptance failure rather than adding another functional gate.
