# Command-owned browser microphone

Worktree: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_021035a9
Branch: bruv/web-live-command-microphone
Base: bruv/web-workspace-design, c3cfb741 (PR67).

## User path

Open the web terminal and type /live, or /live mic-check. This is the explicit user request. The owning CLI asks that browser for audio; browser permission still applies. No top-right mic toggle. Page load, selection, focus, and observer join do not ask for audio. Stop or device/provider failure releases voice, not coding jobs. Later /live makes a new request.

The old ban on automatic startup meant page-load capture, not acquisition in response to /live. Browser mic-check no longer asks for a second CLI confirmation. Native mic-check keeps its device consent prompt.

## Input and relay boundary

The server issues an opaque, one-use input ticket on Enter. It inserts a private OSC marker before Enter in the PTY input, not output. The root Live extension consumes that marker before the editor sees it. The /live handler captures the ticket at invocation, before async settings or dialogs, as an explicit argument. Later confirmation keystrokes cannot retarget it. BrowserLiveAudio hello carries the ticket beside the CLI-only relay secret.

The relay consumes the ticket, resolves its private attachment capability, reserves voice, and sends audio-request only to that attachment's terminal socket. Browser admission requires the same request ID and private capability. Public hashed owner IDs are passive feedback, never admission credentials. Tickets are bounded to 64 pending submissions per terminal; an expired, mixed, used, or detached ticket cannot acquire audio.

Input from two attachments between Enter submissions makes that submission mixed. Voice rejects rather than choosing first, last, or focused viewer. Ctrl-C resets the input authorship boundary. Focus packets and resize do not count. Bracketed paste line breaks are not submissions. This is deliberately conservative for collaborative editing: clear the prompt and type /live from one browser to retry.

One voice reservation spans terminals and browsers. An active owner cannot be stolen. Detach, disposal, CLI audio close/error, timeout, and server shutdown cancel pending requests and close audio sockets. Browser abort releases context and tracks; if a permission result arrives late its tracks are stopped before wiring capture. Browser permission prompts themselves cannot be cancelled by app code.

## Verification

Checks on 2026-10-09:

- Broader Live/web checkpoint: 657 passed, 4 skipped, 0 failed; 661 tests, 72 files, 24,609 assertions. Skips are paid provider acceptance and one optional upgrade diagnostic.
- Final focused run covers browser audio, actual TUI, Live extension and all web tests after simplifying ticket capture to take() and closing the framer on PTY exit. 130 passed, 0 failed; 9 files, 845 assertions.
- bun run check and build pass. Typecheck, formatting and diff whitespace checks pass. Targeted lint exits 0: no errors, 46 warnings and 39 infos (including existing non-null assertions/style advisories).
- Compiled terminal Chromium: LIVE_MIC_CHECK and BROWSER_OK [], zero browser errors. Keyboard input needs no mic-button click, no second CLI consent and no autoplay override. Existing autocomplete can accept a completion before Enter submits; that is terminal input, not an audio enable step.
- Compiled two-context multiplayer: pass true; shared PID 2998130; workspace sync, shared input/output, observer-safe voice, handoff, zero provider calls.
- Four compiled CLIs: shell work survived switch/reload; pending permission cancelled without transfer; owner disconnect released voice; PTY resize, keys, paste, reconnect and process cleanup retained.
- Audio probe: 7 capture frames / 4,480 bytes; playback, gates, stop/reconnect and browser disconnect. Two-browser normal /live with an injected fake provider: issuing browser captured, observer had no tracks, active owner stayed fixed, stop/retry and injected NotAllowedError retry passed. Fake provider error released tracks and allowed restart, with unchanged coding CLI PID.
- Design: 1100×720 desktop, 390×680 phone, terminal height 624. Menu/dialog/drawer keyboard and focus checks pass. Inspected actual populated desktop, phone and active-owner phone images. Minimal shell retained; no permanent mic button.

Evidence is ignored, under this worktree:

- artifacts/web-live-command/{build,final-check,focused-tests,final-focused,lint,terminal,multiplayer,workspaces,audio-probe,design}.log
- artifacts/workspace-design/populated-{desktop,phone,drawer}.png
- artifacts/web-multiplayer-{owner,observer,owner-phone}.png
- artifacts/web-terminal-{wide,narrow}.png

The normal /live fake-provider harness uses shipped browser assets/server, the actual Live extension and production input-ticket hook. The compiled long-running voice checks use /fixture-live (same handler, fake provider/owner); compiled /live mic-check uses the shipped default handler. No external provider calls. Permission-denial browser acceptance injects NotAllowedError; insecure context has a focused pre-device diagnostic test. Fake media is not physical sound-quality proof. No Safari/iOS, real permission-prompt UX or paid-provider claim. Full repository suite was not repeated.

Audio release never calls stopWork or cancels coding jobs. Terminal delete and server shutdown keep existing intentional PTY process-group disposal; other terminals stay alive on tab deletion. This change does not turn closing a terminal into background-process persistence.

Initial real-Bun review found that WebSocket onopen lost async-local context. Explicit request arguments fixed it. Review also caught suppressed permission errors, a pending-permission slot that blocked retry, and split-paste/Alt+Enter corruption. Those are fixed and tested. Public presence is now passive only: a delayed old owner-release snapshot cannot close a new request. Request-specific cancellation and audio sockets own teardown. Follow-up scoped review approved the integrated fixes (27 focused tests).

## Values

No new value needed. Values 1, 3, 6 and 8 already require the real user path, one explicit owner, privacy, and rendered acceptance. This fixes the old two-action browser flow, not a reason to capture on page load.

## Workers

- Focused audio tests: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_021035a9-5442693331ce-task_9f52cfbd, branch bruv/command-audio-focused-tests-9f52cfbd; test commit 93737332 integrated. Copied source there remains uncommitted; integration lives here.
- Browser probes: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_021035a9-5442693331ce-task_05e5e1a3, branch bruv/command-browser-acceptance-probes-05e5e1a3; six-file commit f746a5a8 integrated, then parent aligned its fixture with the final production ticket hook. Worker proof also remains there under artifacts/command-mic.
- Parent owns integration, docs and final checks. Previous finished feature worktrees were not edited. No push or PR; parent reviews and publishes.
