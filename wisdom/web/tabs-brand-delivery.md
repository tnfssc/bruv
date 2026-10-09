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
