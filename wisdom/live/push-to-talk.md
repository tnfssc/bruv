# Live push-to-talk

User wants hold Space to speak. Release must stop sending audio and end the
speaking turn, not Live or playback. Local mic capture can stay open. Nearby
speech must not be sent or kept for the next hold. Continuous mic stays an
explicit choice.

## Current work

Main checkout: /home/tnfssc/.t3/worktrees/bruv/t3code-2140c5c0
Branch: t3code/live-hold-space-ptt. Started at b5b15811.

Provider worker: /home/tnfssc/.bruv/worktrees/t3code-2140c5c0-5442693331ce-task_9c2028e2
Branch: bruv/live-manual-audio-turns-9c2028e2.
Commit 2b03e5aa is integrated as e88477dd. Both provider constructors take a
fifth argument with inputMode: continuous or push-to-talk.
Google uses activityStart/activityEnd with automatic detection off. Realtime
uses VAD off, commit, response.create. Holds under 100 ms are cleared, not
padded or retained. Provider standalone defaults stay continuous for other
callers; the Live extension supplies the saved mode.

Native worker: /home/tnfssc/.bruv/worktrees/t3code-2140c5c0-5442693331ce-task_d1b23d40
Branch: bruv/live-capture-origin-push-to-talk-gate-d1b23d40.
Commit e05bc897 is integrated as 2b042cd5. Seam: audio.setCaptureGate(epoch: number | null),
capture(pcm, epoch?). The helper must gate at capture origin, reset converter
history, and tag holds. A host receive-time gate alone can leak queued pre-hold
speech. Parent closes its gate at release before any async helper command, and
rejects stale epochs. The gate promise means stdin accepted the command, not
that acquisition is armed; native code may discard the start of a hold.
Linux uses Pulse acquisition byte indices plus source latency. macOS uses tap
host time and ring tags. Both reset partial packets and converter/processor state.

## UI choices

New and old settings without inputMode now default to push-to-talk. Explicit
continuous settings stay continuous. /live input offers a menu or accepts
push-to-talk/continuous. Stop Live before changing mode.

The talk panel owns input focus. Ordinary editor Space remains text. Press and
release Space once while muted to prove release routing; then hold Space speaks.
No timer guesses. Enter starts talk and Backspace mutes on unsupported terminals.
Esc returns to text muted; /live talk reopens. Terminal focus loss and another UI
taking focus mute. Stop/navigation abort the panel without committing held audio.

Pi TUI 1.0.3 requests Kitty flags 7. Raw extension listeners see releases before
the normal component release filter. The panel temporarily pushes flags 15 on
Kitty terminals for all-key press/repeat reporting and restores the stack at
close. It still requires an observed Space release; negotiation alone is not
proof. The panel owns focus reporting only in scrollback mode. Fullscreen owns it
already; panel teardown must not switch it off. The small pi-tui 1.0.3 patch
forwards focus reports after fullscreen selection cleanup so extensions see
focus loss. Keep this patch until upstream has that behavior.

GPT-Live primary is not OpenAI Realtime. Current official Live docs have append
and session.close, but no manual input-turn end/commit. Push-to-talk + gpt-live-1
is rejected before devices open. Do not invent Realtime event names for Live.
Connector-host Claude frontend has no terminal hold controls. It reports that
limit and requires explicit continuous mode. No silent fallback.

## Proof and remaining work

Provider worker: 90 focused tests and typecheck passed.
Parent controls/config/extension/connector tests: 77 passed. Integrated typecheck
passed. Native worker: 19 focused tests, Linux helper build, portable C sanitizers
and virtual Pulse protocol test passed.
Real source CLI at 80 and 120 columns passed the talk-panel flow with synthetic
mic/provider and injected Kitty press/repeat/release. This proves splitting,
routing and rendered controls, not real terminal release support or acoustic
behavior. The first run exposed an Escape test wait bug: wait for the editor to
return, not panel text that also says /live talk.

UI review found modified Space releases left sending open, fullscreen swallowed
focus loss, and panel teardown disabled renderer-owned focus reporting. All are
fixed. A real TuiAltScreen regression and real CLI focus-report routing test pass.
Modified releases now close Space holds even if modifiers changed while held.
The focus setter also mutes when another dialog takes component focus.
Native review found no defects; 16 focused checks passed.

Initial Linux gate: 2002 passed, 30 skipped, 11 failed. Ten failures were
untrusted mise startup noise in unrelated shell assertions. Read and trusted
the tracked tools-only mise.toml locally. One GPT fixture needed explicit
continuous mode. All failed files plus new config/connector checks then passed
(44 tests). Renderer review fixes warranted a final full gate. It passed: format, lint,
typecheck, paired build, offline OpenAI transport, 2016 tests passed / 30 skipped /
0 failed, and paired standalone smoke. Logs are in artifacts/ci in this checkout.
The focused review-fix run also passed 76 tests across controls, extension and
real terminal flow. No remaining observed defect from either review.

Implementation is complete on this branch. No PR, release, real mic session or
paid provider acceptance was started. Next validation that still helps: compile
on macOS, then consented physical mic and real-terminal hold/release checks.
Physical macOS mic/terminal and live provider acceptance are not yet tested.
Swift compilation is also unverified on this Linux host; portable C and source
checks do not replace the macOS lane.

Values unchanged. Existing explicit intent, lifecycle ownership and honest proof
cover this. Capture epochs and Kitty calibration are feature details, not new
project values.
