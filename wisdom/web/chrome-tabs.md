# Chrome-style terminal tabs

Branch: bruv/web-chrome-tabs. Base: bruv/web-live-polish at 29b7f880 (PR68).
Worktree: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_99ef25a5.

## Decisions

A single 40px strip. Rounded top corners, black active tab joined to the terminal, quiet inactive dividers, and a small + directly after the tabs. Tabs grow to 210px on desktop (164px on phone), shrink to 112px (104px), then scroll. Full titles stay in accessible labels and tooltips. No extra row, instructions, mic button, dependency, or backend change.

Select and close are sibling buttons, not nested controls. The existing tab menu still offers rename and close. Both close paths use the same captured-tab confirmation: running work stops for everyone only after confirmation. Cancel returns to the originating control, even after a shared snapshot rebuilt it; confirmed inactive close returns to the selected tab; active close returns to the remaining terminal ready to type, or + when empty.

Arrow/Home/End navigation stays on role=tab controls. Close buttons never select a tab. Rerenders retain focus without scrolling; local selection and viewport resize reveal the selected tab. Shared renames retain a person's manual overflow position. Active close returns terminal focus for the next task. No terminal renderer, geometry, or ownership rules changed.

## Proof

Compiled CLI + external Chromium, real PTYs, 1100×720 and 390×680. The design probe covers long names, eight tabs, keyboard overflow, sibling markup, inactive close, cancel across a shared rename, captured delete, active/last-tab focus return, menus, drawer, and empty states. Phone terminal height: 628px.

Screenshots and logs are ignored artifacts in this worktree: artifacts/workspace-design/ and artifacts/chrome-tabs/. Parent must review the final rendered result before publishing.

Checks: typecheck/build passed; 64 focused tests passed (555 assertions, 12 files). The compiled design probe, workspace lifecycle probe, two independent browser contexts, and two tabs in one browser context passed. These retain shared PTY/input/output, local selection, reload/reconnect, destructive cleanup, observer-safe voice, and explicit handoff assertions.

Viewed frames: populated-desktop.png, populated-phone.png, tabs-desktop-close-hover.png, tabs-phone-overflow-active.png, tabs-phone-overflow-terminal.png, tabs-phone-close-focus.png, phone-long-tab.png, phone-close-dialog.png, tabs-phone-close-return.png, tab-menu.png, and rename-dialog.png under artifacts/workspace-design/. The final fixture waits for the actual CLI prompt before typing and lets resize/rename frames settle before captures, rather than treating socket connection or DOM text as rendered proof.

## Test environment and limits

The machine's /tmp filled during browser checks. Chromium then crashed even on a bare HTML page. A long task-local TMPDIR also exceeded Chromium's Unix socket path limit. Final runs use a short, task-owned /var/tmp/bruv-tabs.* directory, recorded in artifacts/chrome-tabs/tmp-path.txt and passed through to fixture CLIs. Putting the fixture under the real home directory had also exposed ancestor .agents resources and correctly prompted for project trust despite an isolated HOME. /var/tmp avoids that inherited resource path without changing trust behavior. No unrelated temp files were deleted. Use a short writable TMPDIR outside user resource ancestors when replaying these checks.

Observed gap: some xterm captures after focus changes show sparse paint despite populated DOM text; other captures of the same panes show the real output. Both overflow focus states are saved. This varied across runs, so neither tab focus nor terminal focus is a paint guarantee. The strip and PTY regression pass, but parent should judge this capture/paint gap before publishing. No speculative renderer fix retained.

No Safari/iOS, physical touch/keyboard, physical microphone, paid provider, or full repository suite claim. Server, voice/input ownership, persistence, and root CLI are unchanged. Existing values already cover real rendered proof and safe test cleanup; no values edit needed.

Parent integration follow-up: the sparse capture was reproduced with Playwright default caret suppression and avoided with caret:initial, while DOM text/style/geometry stayed unchanged. The integrated design probe preserves caret styling for snapshots. No blink override, compositor workaround or renderer behavior change retained. See tabs-brand-delivery.md for evidence and single-PR delivery.

Follow-up: [inline tab rename](inline-tab-rename.md) replaces the Rename menu/dialog with direct editing. Close confirmations remain.
