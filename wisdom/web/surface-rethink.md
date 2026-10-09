# Browser workspace: rethink the whole surface

User asked for a bold review of every exposed browser surface. Five independent reviews informed one integrated design, not five separate products. Keep all work in [PR64](https://github.com/tnfssc/bruv/pull/64). Do not merge or install unless asked.

## Scope and choices

Keep real Bruv terminals, a workspace sidebar and terminal tabs. Shared tabs mean shared PTYs and input; navigation stays local. Keep pure black, Vesper, the official logo and embedded Nerd Font. Automatic worktree discovery, agent tabs, profiles and presence remain future work.

Subtraction is the redesign. One merged rail header. Name-first workspace rows with contextual removal and paths on demand. One direct tab strip, without duplicate menus or a healthy-state dashboard. The phone opener names the current workspace. Empty screens show the next action, not subtitles that repeat it.

Folder entry stays inline. Bad paths retain input, focus and a local error, including in the phone drawer. The server resolves canonical paths and reuses an existing workspace without creating a tab or changing its revision. POST /api/workspaces returns the flat snapshot plus workspaceId and created. The browser selects workspaceId locally.

Rename uses double-click, double-tap or F2. Enter saves; Escape or blur cancels. A failed save keeps the draft and focus. Enter compares against the current shared name, so another browser's rename does not erase explicit local intent. Successful saves and confirmed closes return focus to work. Cancel restores the invoker. Keep destructive confirmation for shared work and lingering descendants.

Access failure is not an empty workspace. List failure and PTY failure have separate recovery. Expired replay freezes a lost view; it does not mean the CLI exited. New terminal must leave the original process alive.

/live still requests the submitting browser's microphone. Show phase and owner. Pending Cancel and scoped dismissible errors are not permanent mic controls. Navigation never transfers voice. Use xterm's own accessibility output, enabled only for the visible pane. Do not add another transcript.

A touch belongs to the visible connected pane. An independent review caught a held alternate-screen touch sending input after a tab switch. Cancel gestures on hide and disposal, and reject hidden/disconnected starts and moves. Hide then show must not revive a gesture. See [touch ownership](browser-terminal-touch-lifecycle.md).

## Source and owners

Parent: /home/tnfssc/.bruv/worktrees/bruv-web-surface-rethink, branch bruv/web-surface-rethink. Base c66b65e3 was green on all eight hosted checks. Publish only to origin bruv/web-workspaces-tabs.

Review jobs: task_b5e188ff architecture; task_7c94d93c workspaces; task_aec180c3 terminals; task_66d639ec voice-state; task_7141b990 visual. Reports are under artifacts/surface-rethink/<scope>/findings.md. Later safety review task_79308eae found the held-touch bug and no other concrete blocker in its scoped boundaries.

Implementation worktrees, kept for recovery:
- Frontend task_d42a48e0: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_d42a48e0, branch bruv/web-surface-ui. All commits through 2b636acc are integrated. Parent equivalents run from 05c3a54 through 555574d6. Do not reapply them.
- Server/help task_b9132ef7: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_b9132ef7, branch bruv/web-surface-entry. Commit 36217ca8 became d8fb0835.
- Touch fix task_85bcabb5: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_85bcabb5, branch bruv/web-touch-owner-fix. Commit f6f3f4a became 13776552. Merge retained both the rename and touch regressions.
- Frontend combined proof tree: /home/tnfssc/.bruv/worktrees/bruv-web-surface-proof-d42a. Do not import its ancestry. Parent owns the final combined gate.

Details: [frontend](surface-rethink-frontend.md), [folder reuse](surface-folder-reuse.md). Finished worker trees must not be edited.

## Integration checks

Parent also aligned the merged rail controls to the tab baseline, removed redundant empty copy, and updated the packaging fixture to copy browser-terminal-touch.ts.

The first broad run had 705 pass, four existing skips and two failures. The asset fixture omitted the new module. The theme fixture's explicit child environment dropped TMPDIR. A direct launch reproduced exit 2 with ENOSPC and no startup URL: this machine's /tmp was full. The test now gives its child TMPDIR=root. No runtime fallback, weakened assertion or timeout increase.

Final parent check/build/lint/format passed. The web/live/launcher/asset/notice regression gate passed: 707 tests, four existing paid-provider/diagnostic skips, zero failures, 24,972 assertions. Logs: artifacts/surface-final/. This is not a zero-warning claim.

Final compiled design, workspace lifecycle, two-browser multiplayer and audio probes passed in the parent tree. They cover shared PID/input/output, local navigation, explicit voice handoff, observer safety, denial/error retry and zero paid-provider calls. A headed recovery probe passed real CLI swipe and wheel history after Ctrl+O, visible-only accessibility output, and View lost/New terminal with the original process alive. Owned fixture servers exited 0. The last change only adjusted empty-state spacing and removed stale static copy; build, format and the full design probe passed again afterward.

Parent viewed final populated desktop/phone and empty desktop/phone under artifacts/workspace-design/. Also viewed surface-rethink/frontend/view-lost-phone.png, touch-history-phone.png, access-phone.png and path-error-desktop.png, plus artifacts/web-workspaces-voice-owner.png. These contain real terminal output. The recovery fixture's printed sample check counts are fixture text, not test results. Design-probe folder-error-desktop.png lacks terminal paint and counts only as form evidence. Earlier drawer and inline-edit captures are described in the frontend note.

At this commit, code and proof are ready to push to PR64. Fresh hosted CI is still required; the old green head does not cover this redesign. Watch the PR after push and fix concrete failures. Record the hosted result on the PR, not as a new note in this tree after the task is done.

## Proof limits and setup

Use TMPDIR=/var/tmp for Git signing, builds and browser fixtures. Chromium: /home/tnfssc/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome. Playwright: /home/tnfssc/.cache/ci-speed-browser/release-browser/node_modules/playwright-core/index.mjs. Headed Chromium works with DISPLAY=:0 and --ozone-platform=x11. Xvfb lacks libnettle.so.9. Browser MCP is disabled for this thread.

Some CDP captures omit xterm paint. Reject those as terminal-output proof. The folder-error capture can prove its form without proving terminal paint. Actual owned X11 capture helpers live under the prior bruv-web-alignment-round2 worktree's artifacts/component-review-round2/headed/. Do not change the renderer to make a screenshot pass.

No physical microphone or audible-speech acceptance, paid-provider call, physical phone keyboard/IME, Safari/iOS or actual screen-reader acceptance. Fake voice probes and Chromium phone emulation are labeled evidence, not those claims.

## Values

Values unchanged. Existing values already require direct user flows, scarce attention, visible ownership, preserving shared work, shipped-path checks and honest evidence. This task adds concrete recipes and proof, not a new general rule.

## Spacing follow-up

The user rejected the prior spacing despite its green tests. The component-based rebuild and fresh visual evidence are recorded in [spacing system](spacing-system.md). It starts from 0c651e35 in a new task tree; the finished surface-rethink tree remains read-only.
