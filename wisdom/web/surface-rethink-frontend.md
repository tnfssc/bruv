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
