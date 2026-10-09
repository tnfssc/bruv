# Component alignment review

User says the whole browser UI feels slightly misaligned. They asked for deep independent subagent reviews, not another quick screenshot glance. Keep PR64 as the only PR.

Active worktree: /home/tnfssc/.bruv/worktrees/bruv-web-alignment. Branch: bruv/web-alignment. Base32a0d90f; prior final CI green. Earlier feature worktrees are finished and must not be edited.

## Review owners

Read-only reviewers use the current source and isolated offline compiled-app browser fixtures. They share this worktree for artifacts only; parent owns source edits.

- task_057dc7b2: sidebar, canonical brand geometry and mobile drawer. Artifacts component-review/sidebar/.
- task_1945cbe3: Chrome-style tab strip, close controls, overflow and active shape. Artifacts component-review/tabs/.
- task_9e3139e3: toolbar controls, tooltip/menu/dialog spacing and baselines. Artifacts component-review/controls/.
- task_d144542c stalled after source reading and was cancelled. Replacement task_4decc620 owns the narrow rendered terminal geometry review. Artifacts component-review/terminal/.

Each should inspect actual screenshots and measure rectangles/computed styles at desktop1100×720,1440×900 and phone390×780; narrow landscape and states where relevant. Measure visible SVG/glyph ink as well as boxes. Findings must name real mismatches and concrete fixes, not invented issues. Return viewed images and measurements. Parent reviews how components fit together before making changes. This is a review partition, not a mandate for a framework or new runtime components.

## Constraints

Pure black, Vesper, official brand, Nerd Font, compact Chrome-inspired tabs. No filler, extra panels or microphone button. Preserve independent local navigation, shared terminals and command-driven microphone ownership. Use common spacing/row/icon anchors where they improve actual alignment. Do not hide important error or ownership state merely to look clean.

Use TMPDIR=/var/tmp; /tmp is full. Use caret:initial in Chromium captures; default Playwright caret suppression can falsely blank focused xterm captures. No renderer workaround. No paid provider calls or physical-device claims.

## Next

All four reviews are complete. Parent applied the measured fixes and reviewed the combined renders. Update only PR64, then wait for hosted CI on the new head. Do not merge without the user asking.

## Confirmed findings and changes underway

Tabs: controls were centered at y20 while tab labels/close controls used y23. Move the common6px inset to the tab-bar content row rather than padding only the tab list. All toolbar controls now share that row and a28px frame (32px tall on phone). Revealing only a title clipped its sibling close button; reveal the complete tab shell. Conditional edge fades show more tabs without another control or label.

Sidebar: the46px brand header shrank to28.23px under workspace overflow; make it non-shrinking. Folder SVG inline baseline added a2.09px optical offset; display it as a block. Drawer close right padding17px missed the row/action edge by9px; use8px on the right and retain the official SVG and left anchor. Logo ink itself was measured70×21px and aligned with the tab content; do not redraw or crop it.

Controls: primary Save focus ring used the same peach as its fill; add a2px gap so the existing ring is visible against the dark dialog. Voice/status had tiny unequal frames (27.36×15.39 and12×22); use shared frames and a5px tooltip gap matching menus. Replace text ellipsis with centered SVG circles. Keep voice passive and dialog geometry otherwise unchanged.

Geometry regression checks are being added to the real compiled-browser design probe: shared control centers, full-shell reveal at intermediate keyboard positions, folder/text centers, drawer right edge, dense-header invariance and primary focus offset. Existing screenshots and measured findings are retained under artifacts/component-review; final before/after inspection is still pending.

## Final check

Parent inspected populated-desktop.png, populated-drawer.png, alignment-primary-focus.png, alignment-desktop-wide.png, alignment-phone-intermediate-tab.png and alignment-phone-tall.png under artifacts/workspace-design/. These show the final combined build, not isolated CSS fixtures. The compiled design probe passed desktop1100×720, wide1440×900, phone390×680 and tall390×780 checks, plus menus, focus, close, overflow and dense workspace states.

The replacement terminal reviewer found no additional defect. Parent closed the desktop measurement gap: at1440×900 the terminal is1204×844 at(224,50), with an1184×828 xterm screen and46 rows. The residual rail and whole-cell slack are intentional. Tab close, plus, menu and connection frames share centerY23. Folder/text centers differ by less than0.01px. No terminal renderer workaround was added.

Two-browser and same-browser-tab probes passed after one transient fixture stop-command timeout on the first run. The stop assertion was not removed. Shared output, independent selection, voice handoff and observer safety remain covered with fake devices/providers only. Build and typecheck passed. Final focused tests passed:71 tests,604 assertions,0 failures. Results live in artifacts/alignment/final-tests.log. Focused Biome check passed with existing warnings and infos. Full hosted CI remains the next gate after push.

Values §8 now asks for component and shared-edge review when a dense UI feels off. Measure overflow and focus states, then judge the whole view. This sharpens the existing visual acceptance value; it does not add a new one. Physical touch, Safari/iOS, physical audio and paid providers remain unverified.
