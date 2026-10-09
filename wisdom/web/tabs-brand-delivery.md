# Terminal tabs, real branding, one PR

User asked for Chrome-like tabs and pointed out the sidebar used the wrong logo. Then asked to consolidate the web work into one PR and make CI pass.

Active integration worktree: /home/tnfssc/.bruv/worktrees/bruv-web-tabs-brand. Branch: bruv/web-tabs-brand. Base: bruv/web-live-polish, 29b7f880.

## Branding

Use canonical site/assets/brand/bruv-wordmark-light.svg in the black sidebar. No recreated text b. mark. Build preparation embeds the SVG from its canonical source into HTML; CSS sets its displayed size without changing geometry. Favicon comes from site/assets/brand/bruv-icon.svg as a local data URL. No new runtime route, dependency or network fetch. Keep the icon's light/dark support for browser chrome.

## Active pieces

- Parent owns branding and integration here.
- task_99ef25a5 owns Chrome-style tabs in /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_99ef25a5, bruv/web-chrome-tabs. Await commit, inspect desktop/phone and integrate. Keep brand SVG if HTML/CSS conflicts.
- task_29c1887c owns actual observed CI failure fixes in /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_29c1887c, bruv/web-ci-fixes. PR68 GitHub run37940901015 has three failing Linux shards and policy; native audio/macOS pass. Worker also checks prior PR64 run37907910589 Linux2/3.

## Delivery

Keep existing PR64 (base develop, remote head bruv/web-workspaces-tabs). Do not open another PR. Once integrated, push this descendant commit to that remote head without force. Confirm all superseded branch tips are ancestors or changes preserved, then close drafts65/67/68 with link to64. Do not delete worktrees or erase notes. Update64 title/body to full final scope. Register/watch64 through normal PR tools; fix actual CI failures and use host check results, not local tests, before claiming CI green. No merge requested.

This corrects too many small PRs for one user-facing task. Existing whole-task delivery and minimal-parts values apply; no new general value needed.

Branding checks: typecheck/build passed; packaging/font asset tests 2 passed (29 assertions). Actual Chromium design proof passed desktop1100×720 and phone390×680, including exact canonical favicon content. Parent viewed populated desktop and mobile drawer images in artifacts/workspace-design/. Tab redesign still pending.

Consolidation happened at 7e1a3257: ancestry checks passed for all four remote web branch tips, then fast-forward pushed to origin/bruv/web-workspaces-tabs. GitHub automatically marked65/67/68 MERGED into that branch (and retargeted the stack) on2026-10-09T14:15:09Z. PR64 alone stays OPEN against develop. No develop merge occurred. The explicit close attempt was unnecessary; read states before retrying. Continue updates on64 only.

## Integrated checks

CI repair fbf10a73 is integrated as e533aaad, preserving logo and native status-button accessibility. Chrome tabs2a9749f9 is integrated as45323091. Combined format/lint and check/build pass. Focused web/audio/packaging suites:71 passed,609 assertions,14 files. Worker CI repair full Linux gate passed3212 tests with31 existing skips; hosted final-head CI still must pass.

Parent reproduced the reported sparse focused-terminal capture. Before/after DOM text, colors and geometry remained identical. Playwright default caret suppression produced blank content; caret:initial captured the full terminal. Disabling screenshot animations also repainted it, but changing xterm cursorBlink or promoting rows to a layer did not solve default captures. Those speculative product changes were removed. Design screenshots now preserve actual caret styling instead of mutating the page for capture. Keep both focused-tab and focused-terminal frames. Probe evidence is ignored under artifacts/paint-probe/, artifacts/tabs-brand/ and artifacts/workspace-design/paint-*.

Final caret-preserving design probe passed. Parent viewed desktop, close-hover, phone overflow with terminal focus, and close-return captures. Both overflow focus states retain the real uname output; close-return is a newly selected idle CLI. Final build/check and format/lint passed. Deliver only to origin/bruv/web-workspaces-tabs for PR64. Hosted CI remains the next gate; do not call it green based solely on local results.
