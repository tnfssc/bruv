# PR64 frontend surface rethink

Owner tree: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_d42a48e0 (bruv/web-surface-ui).
Probe worker: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_d42a48e0-5442693331ce-task_153494b1 (bruv/update-web-surface-probes-153494b1), commit cd4f1a84, applied here as 2330df18.
Parent integration: /home/tnfssc/.bruv/worktrees/bruv-web-surface-rethink. Parent owns PR64; no push from this task.

## Choices

One name-first rail with brand/add in one header. Workspace row IDs remain stable across snapshots. The row's Remove captures that workspace, never selects it. Full paths are available in title and accessible names; duplicate names alone get distinguishing suffixes. Removal confirms the path and shared impact.

One tab strip. No tab/global menus, reload control or healthy connection button. Width follows content within limits. Close is 24px desktop / 32px phone and is hidden on partially clipped shells; selecting a partial label reveals the full tab. Arrow/Home/End stay on the strip. Direct rename keeps its input across snapshots; save/confirmed close return to surviving xterm, cancel to invoker.

One folder form moves between rail and empty surface. Errors and drafts stay local and visible in the drawer. Folder POST uses the server worker's flattened state plus workspaceId/created; existing-folder selection uses that identity, not a guessed new tab. No server/launcher/README edits in this task.

Missing/known-invalid credentials show Access required. Other network failures are not called auth. List updates and PTY retries have separate messages. Replay gap freezes the screen and says View lost: original work still runs. New terminal leaves that shared original open. Ended tab removal still warns about remaining work.

/live alone starts capture. Voice shows phase and owner context, not an inert mic button. Pending Cancel sends the matching authenticated audio-error and aborts local capture; late tracks still close. Error/dismiss state is scoped to the owner tab. No ownership transfer on focus.

Only the visible xterm enables built-in screenReaderMode. Hidden xterms have no accessibility tree. Browser probes must type terminal text with keyboard.type; filling xterm's helper textarea does not emit input in screen-reader mode. No physical screen-reader claim.

Touch evidence: read-only worker task_9808a2c9 reproduced no history movement on stock xterm swipe, versus wheel reports to the real CLI. Minimal terminal-local helper scrolls normal buffers through scrollLines and forwards alternate-buffer swipes as pixel WheelEvents through xterm's existing mouse/PTY path. No toolbar, transcript, key interception or modifier changes. Evidence at /var/tmp/bruv-touch-review-EQ3qEf; this is Chromium emulation, not physical-phone acceptance.

## Proof checkpoint

Typecheck and embedded build pass. Focused tests/web passed 57 tests before touch helper; browser/touch tests then passed 27. Repo lint and format:check exited 0 (existing warnings/infos and two oversized wisdom JSON warnings remain). Final integrated probe runs are still pending.

Compiled headed X11 visual probe: artifacts/surface-rethink/frontend/probe.mjs, probe.log, observations.json. Completed with owned server exit 0, no page errors. Real offline PTYs and shell fixture output, no paid model calls. Two browsers kept different workspace selections. Viewed populated desktop/phone, close confirmation, drawer, desktop/phone retained-path error, empty-tabs phone, empty-folders desktop/phone, access phone. Edit CDP capture missed xterm paint and is rejected; edit-desktop-window.png is an actual owned X11 capture with full terminal output and was viewed. Access-phone still showed a stale-list banner in that older build; clearing it on known auth failure is now implemented and needs recapture. Empty-folder captures retained a prior failed draft by design, so they are not clean first-entry proof. Initial accessible-tree check found structure but blank text before first render; populated accessible-output check still pending.

Limits: no physical phone/keyboard/IME/screen reader, real mic/audio quality or paid provider. Final parent integrated build and hosted gate remain parent-owned.

Values assessed: existing finish-the-user-path, truthful-proof, attention and direct-edit values cover these decisions. No new value or expansion needed.

## Integrated proof checkpoint

Durable proof tree: /home/tnfssc/.bruv/worktrees/bruv-web-surface-proof-d42a, branch bruv/web-surface-proof-d42a. It combines frontend 61609792 with parent server d8fb0835 (proof cherry-pick a222f6b3). Only proof integration adds that other owner's server commit; frontend source tree never edits server/launcher/README.

60 focused web tests passed with touch helper. Integrated workspace smoke passed real CLIs, normalized-folder response selection, running shell surviving switch/reload, pending Cancel, late media release, explicit owner/mic-check and observer safety. Integrated two-browser multiplayer probe passed shared PID/I/O/state plus fake-provider voice (zero paid calls). Browser-audio probe passed normal /live, fake provider capture, denial/retry and provider-error release while CLI PID survived. Full-painted owner desktop, observer and owner phone frames were viewed. Fake Chromium device/provider only, no audible/physical acceptance.

Design probe initially hit transient width during shared PTY resize; immediate failure was followed by scrollWidth=390/no overflowing elements and a fully painted phone frame. Probe now waits for shared geometry to settle, rather than adding renderer CSS workarounds. Its phone raw-touch pairs had CDP event timestamps three seconds apart under headed scheduling, not the requested double tap. The probe now labels Chromium emulation and sets 150ms device timestamps; no product timeout expansion. Final complete design probe and updated access/accessible-output/swipe/gap proof remain pending.

Read-only review task_ce39edcb found the inactive lost/ended tab state missing from its aria-label. Fixed it; labels now use the visible title including that state. Folder Cancel is disabled while a request is pending; a failed phone request reopens its form drawer if it was dismissed. Retry messages remain stable even before first terminal output.

## Observed viewport containment fix

Later eight-tab phone navigation showed a persistent scrollWidth=678 on a 390px page. failure-geometry.json identifies only xterm-accessibility and its tree as overflowing, at 672px, while the screen rows had already resized. This is different from the earlier transient PTY size race. The terminal viewport now clips overflowing shared/frozen geometry and that invisible xterm layer with overflow:hidden. No forced refresh, fake renderer state or timeout expansion. Accessible text remains in xterm's tree. Status text can wrap long owner names, and phone status buttons have 32px targets.

## Recovery and output proof

Latest compiled proof at a6824584 finished with no page errors and owned server exit 0. Populated xterm accessibility text exists: one visible tree, no hidden-tab trees, including real shell output. Reopened terminal also has text. The actual server rejected a fixture reconnect cursor of 900000; the UI froze as View lost, did not call the CLI ended, and New terminal left the original PID 837056 present. Lost desktop/phone, clean empty-folder phone and clean access-phone frames were viewed; the auth stale-list banner is gone. Phone lost view stays at scrollWidth=390 despite the frozen desktop geometry.

The first CLI history probe used the collapsed !seq preview, which fit in the viewport; neither wheel nor swipe moved it. This is not touch acceptance. The updated probe expands real history with Ctrl+O before testing and requires both gestures to move output. No physical-device claim.

Design probe now reaches eight-tab keyboard overflow. Its old inactive-close step targeted a deliberately clipped shell, whose close control is correctly hidden. Probe now reveals the whole shell without selecting it. Cancel reveals that invoker again if a shared rename widened the tab. The old confirmed-inactive-close expectation was strip focus; it now checks surviving xterm focus, matching the chosen design.

## Final navigation refinements

Expanded real CLI history now moves for both swipe and wheel after Ctrl+O. The compiled probe asserts both changes, records actual rows, and retains original PID 882817 after View lost/New terminal. touch-history-phone.png was viewed with full CLI output and its Jump to latest affordance. This is Chromium emulation, not physical-phone acceptance.

The isolated inactive-close geometry probe shows a complete Tests shell at x=238.9..334.9 inside a x=58.9..347 strip, close visible, while another tab stays selected. The long headed design run still had delayed native scroll/focus interactions. Tab reveal is now scoped to the strip's own scrollLeft, not scrollIntoView on outer ancestors. Home proof waits for the selected shell to be revealed before manual scrolling. Long tabs cap width at the strip's available width, so narrow phones can still expose a whole close target. Workspace row removal prunes absent rows before ordering survivors, just like the tab strip, so an earlier row deletion need not detach a focused surviving row.

## Draft and final-gate corrections

Enter compares the visible rename draft with the current shared name, not the original name captured on opening. This preserves explicit local intent if another browser renamed the same tab while its editor stayed open. Rename fields stay in place until PATCH succeeds; 503 leaves the draft and focus for retry. No extra persistence or fallback state.

The final headless design probe reached its last empty-tab check; an old assertion still expected focus on hidden new-tab. It now expects the sole visible empty-action. The final isolated row probe passed: deleting an earlier workspace kept the later Remove control focused. No implicit workspace selection was added.
