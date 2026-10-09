# Browser spacing system

The user rejected the prior padding pass and asked for a UI library such as shadcn/ui. Aligned control centers and green tests had not produced a coherent layout. Start from 0c651e35; keep the finished surface-rethink tree read-only.

## Source and library

Parent: /home/tnfssc/.bruv/worktrees/bruv-web-spacing-system, branch bruv/web-spacing-system. Worker task_16db86df: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_16db86df, branch bruv/web-spacing-components. Its 8799c907 became 84e4732c here. Parent owns publication as a follow-up to PR64. No merge or install unless asked.

Use real daisyUI 5.7.47 native Button/Input CSS. The pinned MIT package has no dependencies. controls.css imports only components/button.css and input.css. Bun embeds the result in the existing same-origin asset. No CDN, React, Tailwind runtime or library JavaScript. Keep the native dialog; it is not a daisyUI modal. Full license is included by the existing notice generator.

Independent reviewer task_f1496888 favored shadcn for shared controls and overlay behavior, while noting a React view migration and unmeasured bundle cost. Parent chose selective daisyUI CSS to standardize native controls without replacing tested PTY/audio ownership and DOM lifecycle. Custom terminal tabs still need editable titles, sibling close controls and horizontal reveal; stock tabs are not a substitute.

Raw imports are 45,219 and 29,115 bytes. The full 1,138,571-byte daisyUI stylesheet is not shipped. Bun's CSS lowering emits 197,903 bytes for the selected library styles. Complete embedded CSS is 215,215 bytes at integration, including xterm, local layout and font face. Packaging tests cap it at 250,000 bytes and reject unresolved imports/full modal styles. Do not mistake a gzip size estimate for the route's actual transfer size.

## Shared dimensions

Use 4/8/12/16/24/32px spacing tokens and semantic roles, not a token for each old magic number. Type, borders and intrinsic logo ratio are separate concerns.

- Controls: 32px desktop, 44px phone. Square actions use the same height and width. Chrome text stays 13px; phone form fields use 16px. Inline rename keeps its title font and inset.
- Headers: 40px desktop, 48px phone, with 4px top inset. Active tabs have rounded top corners and meet the terminal edge. No floating tab pills or bottom gutter.
- Workspace rows: 32/44px for one line. Only a visible path suffix adds 24px. List inset 8px, row text inset 8px, rail form inset 16px. Header and row trailing actions share an edge.
- Fields: 4px label and error gaps, 16px before actions, 8px between actions. Same form moves between rail/drawer and empty state.
- Dialogs: 16px padding, 4px title/detail gap, 16px footer gap. Native destructive confirmation remains.
- Empty states: one left-aligned 320px block, centered in the page. Hide the vacant rail when no workspaces remain. No ornamental card or repeated subtitle.
- Terminal gutters: 12px desktop, 8px phone. At 390x680 the healthy terminal area is 616px high. Xterm font, palette and PTY behavior are unchanged.
- Notices: 8px block padding and the terminal's content gutter. Text wraps; action targets stay full size. Initial list failure uses only the central Retry view, not a raw error plus a stale-list banner.

The worker's first component render used 48px desktop rows and a 64px phone header. Parent rejected that bulk. Library adoption is not visual acceptance. The integrated proportions keep the terminal dominant.

During rename, hide the close action and give its space to the field without moving the tab shell or neighbors. The phone draft is fully visible now. Names longer than the field still use normal input scrolling; that is not lost text. Enter/Escape/blur and failed-save draft retention remain.

Hiding the empty rail requires closing an open drawer when its last workspace disappears. Clear main.inert and focus folder entry. Added a regression. Initial-outage notices must not reappear as stale errors after the list recovers; that also has a regression.

## Checks and evidence

Worker checks passed before integration: 83 focused tests plus compiled design, recovery and voice probes. Parent reruns apply to the compact layout, not those older dimensions. Final parent check/build/lint/format and diff checks passed. Focused tests: 85 passed, zero failures, 664 assertions. Compiled design, recovery and workspace/voice probes passed; owned servers exited 0. The last initial-outage change was checked again with the focused suite and full recovery probe. Lint and format retain documented pre-existing warnings; this is not a zero-warning claim.

Commands: bun run check; bun run build; bun run lint; bun run format:check; bun test tests/web tests/packaging/prepare-assets.test.ts tests/packaging/generate-third-party-notices.test.ts. Compiled probes: scripts/web/browser-workspace-design.mjs, browser-recovery-design.mjs and browser-workspaces-smoke.mjs. Parent logs: artifacts/spacing-final/.

The design probe now checks shared sizes/gutters, field fonts, connected tab edges, stable shell geometry during rename, empty-form anchors, focus, shared edits and overflow. Its new-tab setup used to see the old selection between the event snapshot and POST reply. It now waits for the newly created tab to be selected before renaming. No assertion was dropped to hide that race. Old 48px/16px-chrome expectations were changed to the chosen 44px/13px contract.

A headed run stalled before its first double-click. That capture is not interaction proof. Final functional probes use headless Chromium; accept screenshots only when actual terminal output is painted. Never change the renderer or extend deadlines to make capture pass.

Parent viewed populated desktop/phone, drawer, dialog, empty form and rename images under artifacts/workspace-design; error form, View lost and Retry under artifacts/spacing-states; pending, denied and live voice under artifacts/spacing-voice. Terminal captures contain actual shell output. Folder-error-desktop remains form-only evidence if terminal paint is missing. Voice uses labeled fake device/provider and injected permission outcomes, not audible speech.

Independent rendered reviewer task_40634376 found the compact proportions coherent across populated views, drawer, dialogs and empty states. Its concern was clipped rename drafts. Parent reclaimed the close action's space, kept the shell still and rechecked desktop/phone captures. Do not claim every long name fits a bounded input. The reviewer had no voice captures yet; parent inspected those separately.

## Setup and limits

TMPDIR=/var/tmp is required here because /tmp is full. Chromium: /home/tnfssc/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome. PLAYWRIGHT_CORE: /home/tnfssc/.cache/ci-speed-browser/release-browser/node_modules/playwright-core/index.mjs. HEADLESS=1 for final functional runs. Headed uses DISPLAY=:0 and --ozone-platform=x11; Xvfb lacks libnettle.so.9.

No physical phone keyboard/IME, Safari/iOS, physical microphone, audible speech, actual screen-reader acceptance or paid-provider call. No backend/provider change. Hosted CI must validate the published head. Record its result on the PR, not in a new commit after handoff.

## Values

Values unchanged. Existing direct-flow, scarce-attention, ownership, work-preservation and honest-evidence values cover this task. The library and spacing recipes belong here, not in another general rule.
