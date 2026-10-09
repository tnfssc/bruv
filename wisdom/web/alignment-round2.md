# Second rendered alignment review

User still sees subtle misalignment after inline rename. Review the current product again, not just the first fixes.

Worktree: /home/tnfssc/.bruv/worktrees/bruv-web-alignment-round2. Branch: bruv/web-alignment-round2. Base d90abf51; PR64 only. Parent owns source. Four independent read-only reviewers own sidebar, tabs/inline edit, controls/dialogs, and terminal/whole-layout rhythm. Artifacts go under artifacts/component-review-round2/<component>/.

Keep pure black Vesper, official brand, bundled font, compact tabs, direct rename, and independent multiplayer navigation. No filler or extra controls. Measure optical ink and shared edges; inspect real desktop and phone frames. No renderer workaround for screenshot artifacts.

Next: gather reports, judge whole view, make only demonstrated fixes, inspect combined render, run focused checks plus repository lint/format, update PR64 and wait for hosted CI. Values §8 already covers component measurement and whole-view judgment; reassess after findings.

Review jobs: task_8e4385f7 sidebar; task_c7d8d513 tabs/inline edit; task_716d3cd5 controls; task_5e215dbf terminal. Current compiled build passed. Reviewers are running; no source fixes yet.

## Terminal review result

Task5e215dbf found no confirmed geometry defect in fully painted states. Actual grids:1100×720 has101×36 cells;1440×900 has141×46;390×780 has43×40. Drawer overlays without resizing. Right/bottom slack is scrollbar reservation and whole-cell fitting. No arbitrary gutter nudge. Report: artifacts/component-review-round2/terminal/findings.md.

Repeated missing terminal paint in hover/edit/reconnect captures remains unresolved, even with caret:initial. Do not call it only a screenshot artifact without proof. Parent must inspect these states in a headed browser before whole-surface approval. Other three component reviews are still running.

## Controls review result

Task716d3cd5 found long unbroken names clip in destructive phone dialog titles. At390px the title line extends42.66px beyond its content width. Wrap dialog h2 anywhere; keep full target text and existing modal size. Normal dialog and toolbar optical centers passed; max observed icon center difference0.50px. No icon nudges. Report: artifacts/component-review-round2/controls/findings.md. Parent preview tool is disabled for this thread; do not retry. Check available headed shell browser paths before concluding render acceptance.

## Confirmed fixes

Tabs reviewer c7d8d513 found zero title padding let the inset focus/edit outline cover the first glyph. Title and editor now share5px start padding; shell padding decreases by5px so the overall text anchor stays fixed. The phone rule now applies11px to both title and editor instead of growing the editor to12px. The suggested larger phone close target was a P3 usability suggestion, not a demonstrated alignment defect; leave geometry alone in this pass.

Controls: dialog h2 now wraps anywhere so long unbroken names stay visible on phone. New compiled design assertions compare title/editor font size, line height, text start and padding, and check heading/dialog overflow for a long destructive target.

Sidebar reviewer8e4385f7 found no defect: brand/tab/drawer optical centers sharey23, folder/copy centers differ0.008px,21 workspaces keep46px header and50.797px rows. No arbitrary nudges.

Build/typecheck, repository lint and format,51 web tests passed. Compiled design probe passed. Parent opened corrected inline-rename-desktop.png, inline-rename-phone.png and phone-long-target-dialog.png in artifacts/workspace-design/.

Headed Chromium runs on DISPLAY=:0 with --ozone-platform=x11. Xvfb is broken (missing libnettle.so.9), not a product failure. Headed page captures show full text during edit/scrollbar hover, but one reconnect page capture is still incomplete. A window-only OS capture comparison is running to separate compositor/capture artifacts from actual display. No renderer patch or hidden state. Existing visual values already require this investigation; no values edit needed yet.

## Final window review

Parent inspected the actual Chrome X11 window, not only CDP page screenshots. artifacts/component-review-round2/headed/os-probe.mjs locates the one probe window by _NET_WM_NAME and captures that window with ImageMagick. The three *-window.png files for scrollbar hover, inline edit and reconnect all contain full terminal text. Parent opened each, plus corrected populated-desktop.png and the three correction frames above. The matching final reconnect page capture is also fully painted. No renderer behavior was changed. Earlier intermittent incomplete page captures remain unexplained; this is not proof they cannot occur on another machine. The tested headed states have direct visual evidence.

Initial XFetchName/name-only lookups could not find the probe; modern _NET_WM_NAME resolved it. Scripts and raw window captures stay in ignored artifacts. The public review screenshots use readable app-only frames, not oversized window captures.

Final local checks: build/typecheck pass; full repository lint and formatting pass with existing warnings;51 web tests,427 assertions pass; compiled design checks pass including shared editing, touch rename, overflow, dialogs and new text metrics. Changes are limited to CSS, the design probe and this note. No physical phone, Safari or paid-provider claim. Values unchanged: existing optical-review, evidence and direct-edit guidance already covers these findings. Push to PR64 only and watch its new CI head.
