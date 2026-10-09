# Browser spacing system

This follows the user's rejection of the prior padding pass: green alignment tests were not visual acceptance. Baseline: 0c651e35 and [surface rethink](surface-rethink.md). Baseline images stay read-only in /home/tnfssc/.bruv/worktrees/bruv-web-surface-rethink/artifacts/workspace-design.

Implementation tree: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_16db86df. Branch: bruv/web-spacing-components. Parent integration tree: /home/tnfssc/.bruv/worktrees/bruv-web-spacing-system. Parent owns integration and publication. No push, PR, merge or CLI install here.

## Library and cost

Use real daisyUI 5.7.47 (MIT) native DOM buttons and inputs. Verified npm packaging and license locally. The pinned production package has no dependencies. src/web/controls.css imports only components/button.css and components/input.css; Bun bundles them into the existing same-origin CSS asset. No CDN, Tailwind reset/runtime, React migration or library JavaScript. Keep the native dialog and its existing showModal/focus/confirmation behavior; the modal component's extra variants are not needed.

Raw selected inputs: button 45,219 bytes and input 29,115 bytes. Full published daisyui.css: 1,138,571 bytes, not shipped. Bun's CSS lowering expands logical corners/nesting: selected output 197,903 bytes. Complete terminal.css asset, including xterm, local layout and font face: 214,568 bytes. Gzip estimate 13,029 bytes is a size comparison, not a claim that the route serves gzip. No new browser JS payload from the library. Packaging tests cap the complete CSS at 250,000 bytes and reject unresolved imports/full modal styles.

The library owns button/field styling, hover, disabled and variant states. Local .btn/.input rules set shared height, font, padding and gap through the library contract. Layout selectors handle text truncation and inline editing, not replacement handmade primary/secondary controls. Removed old primary-button/danger aliases and the overlapping old overrides. The dependency notice guide records the choice; generated THIRD_PARTY_LICENSES.txt includes the complete daisyUI MIT license. Actual generation: 214 production packages, 728,098 bytes.

## Dimensions and surface inventory

One spacing scale: 4/8/12/16/24/32px. Border and focus stroke widths, type sizes, content width limits and intrinsic art are not spacing steps.

| Surface | Shared rule |
| --- | --- |
| Rail and terminal headers | Same height: 48px desktop, 64px phone. 8px block inset. Shared content gutter: 12px desktop, 8px phone. |
| Buttons, folder/dialog fields, tab title/edit/close/new, drawer controls | 32px desktop, 48px phone. Phone UI and fields use 16px type; desktop 13px. Square controls use the same semantic height as width. |
| Workspace rows | Control height + 16px; 4px list gap; 8px list block padding. Text/remove stay centered. Secondary path labels use 4px gap. |
| Tabs and overflow | Same header gutter and control height. 8px title padding. Keep scroll/reveal, direct rename, close confirmation and keyboard navigation. No extra menu. |
| Terminal | Shared content gutter on every edge. At 390x680, healthy terminal area is exactly 600px high: 64px header + two 8px gutters. Real PTY/xterm font and palette unchanged. |
| Folder forms and inline errors | 8px label gap, 8px field-to-error gap, 16px section-to-actions, 8px between actions. Same form moves between rail/drawer and empty state. |
| Empty/access/retry | 16px title/body/action separation. Centered content, no ornamental card. Empty content padding 24px desktop/16px phone, nested inside terminal gutter. |
| Voice and recovery strips | 8px block padding, shared content gutter, 8px action gap. Long text wraps; buttons retain their shared size. |
| Dialogs | 24px content padding, 8px title/detail gap, 16px section/action gap, 8px between actions. Long names wrap. Native destructive confirmation remains explicit. |
| Phone drawer | Same 48px controls, header and row rules; 8px gutters. Drawer backdrop is not a visible control component. Focus and close target remain visible. |
| Logo | 80px wordmark width, intrinsic height. Geometry checks compare the SVG viewBox ratio; never force it into a square. |

A viewed empty-folder error exposed an actual selector collision: the old broad empty-state paragraph rule overrode the form's error color and 8px gap. Restrict empty copy to direct children. Geometry now checks inline error color and gap in both hosts. This was missed by alignment-only tests.

## Checks and viewed evidence

Artifacts are retained in the implementation tree, not committed as runtime inputs. Build/check, focused tests, lint and format logs: artifacts/spacing-checks/. Focused gate: tests/web, tests/packaging/prepare-assets.test.ts and tests/packaging/generate-third-party-notices.test.ts: 83 pass, zero fail, 652 assertions. Build and typecheck passed. Lint has existing warnings/info; format has the two existing oversized wisdom JSON warnings. This is not a zero-warning or whole-repo test claim.

Run with TMPDIR=/var/tmp, DISPLAY=:0, HEADLESS=0, PLAYWRIGHT_CORE=/home/tnfssc/.cache/ci-speed-browser/release-browser/node_modules/playwright-core/index.mjs and CHROMIUM_BIN=/home/tnfssc/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome. Build first with bun run build. Then:

- bun scripts/web/browser-workspace-design.mjs: shared scale, header/control/gutter geometry, logo ratio, fields/dialogs, actual PTY shell output, direct rename/failure-safe hooks, safe close, local folder selection, phone drawer and overflow, empty forms. Artifacts: workspace-design/. Geometry assertions now enforce the system, not only old center alignment. Retains substantive keyboard/touch/focus/confirmation assertions.
- bun scripts/web/browser-recovery-design.mjs: real CLI history expanded with Ctrl+O, emulated swipe and wheel, visible-only xterm accessibility output, replay gap freezes a view but keeps the original PID, New terminal preserves it, independent navigation, folder draft/error/empty/access states, emulated initial list outage and successful Retry. Artifacts: spacing-states/ and observations.json. Adapted the earlier recovery recipe into a tracked, portable script; removed its external capture helper and fictional check-count fixture text.
- bun scripts/web/browser-workspaces-smoke.mjs: four real CLIs and cwd/input/output separation, shell job survives switch/reload, explicit voice ownership, delayed permission cancellation, emulated denial then fresh retry, observer safety, handoff, reconnect and cleanup. Artifacts: spacing-voice/ and the existing web-workspaces images. New strip geometry/captures use the same shared dimensions. No provider/backend changes.

All three compiled probes passed and their owned fixture servers exited 0. Design widths include 1100 and 1440 desktop, 390 phone and taller variants. Recovery/voice include 1100x720 desktop and 390-wide phone. Phone evidence is Chromium viewport/touch emulation.

Viewed baseline populated-desktop.png and populated-phone.png. Viewed rebuilt workspace-design/populated-desktop.png, populated-phone.png, populated-drawer.png, folder-error-desktop.png, inline-rename-phone.png, phone-close-dialog.png, phone-long-target-dialog.png, tabs-phone-overflow-active.png, empty-tabs-phone.png, empty-workspaces-desktop.png and empty-workspaces-phone.png. Populated, rename, dialog and overflow captures contain painted terminal output. Folder-error-desktop is form-only evidence, not terminal proof. Wait for enabled-button transitions before empty-state captures.

Also viewed spacing-states/view-lost-desktop.png, view-lost-phone.png, touch-history-phone.png (real painted terminal output), access-phone.png, path-error-phone.png, empty-path-error-phone.png, retry-desktop.png and retry-phone.png (state/form evidence). Viewed spacing-voice/pending-desktop.png, pending-phone.png, denied-desktop.png, denied-phone.png and live-phone.png; all have real PTY paint behind the strips. Fake voice capture/provider and mocked permission outcomes are labeled fixture behavior, not audible speech acceptance.

A read-only second-agent visual review could not start because its model hit a rate limit. The implementation owner performed the viewed review. Parent should view the exact evidence before integration.

No physical phone keyboard/IME, Safari/iOS, physical microphone, audible speech or actual screen-reader acceptance claims. No paid-provider calls. Reject any blank xterm capture as terminal proof; no renderer workaround was added.

## Values

Reassessed wisdom/values.md. Values unchanged: direct flows, scarce attention, visible ownership, preserving shared work and shipped-path/honest evidence already apply. This feature adds concrete component and geometry recipes, not a new general rule.
