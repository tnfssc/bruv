# Browser terminal and Live experiment

## Request and plan

User asked for a real browser terminal for Bruv. The browser owns microphone and speakers. The remote CLI owns the agent and tools. Prove this first. If it works, add optional `bruv web herdr` (not the default), with Herdr itself running in the terminal and microphone passing through to the right Bruv session.

Current bruv web only prints external T3 setup guidance. Older browser audio notes describe removed code, not a current working integration. Keep the setup guide reachable while adding the terminal.

## Worker handoffs

Parent: /home/tnfssc/.t3/worktrees/bruv/t3-6f8b2e16, branch t3/web-terminal-live-mode. Base 02e69f6a.

- Terminal worker task_b6cbd9fe: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_b6cbd9fe. Branch bruv/build-browser-terminal-experiment-b6cbd9fe. Owns terminal server/client, launcher, dependencies and assets.
- Audio worker task_a238e8d3: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_a238e8d3. Branch bruv/bridge-live-audio-to-browser-a238e8d3. Owns Live device transport and audio relay/browser modules. Parent wires server hooks.
- Research task_d3d8604d: current checkout, read only. Uses tvly as requested to find authoritative Herdr source and integration limits. Prior misspelled research task_1d290df5 was stopped.

## Acceptance and boundaries

Use the real PTY and Bruv TUI. A terminal screenshot is not proof of microphone forwarding. Check capture, audio frames both ways, stop and browser disconnect, and no task cancellation on audio disconnect. Distinguish fake media/provider evidence from real audible speech. Loopback by default; authenticate terminal access and validate browser Origin. Remote microphone needs HTTPS or a localhost tunnel. Browser audio must attach to one session explicitly, never silently follow pane selection.

No release, publish or PR requested yet. Workers commit code and plain notes; parent integrates and checks the whole path. Existing values on whole-path proof, evidence honesty, ownership, and small designs apply; no new value yet.

## Local test tools

Herdr is installed at /usr/bin/herdr. Browser automation can use /home/tnfssc/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome and /home/tnfssc/.cache/ci-speed-browser/release-browser/node_modules/playwright-core/index.mjs. These are discovered paths, not proof the new flow works.

## Herdr research (tvly, 2026-10-09)

Official sources: https://github.com/herdrdev/herdr and https://herdr.dev/docs/cli-reference/ , https://herdr.dev/docs/socket-api/ , https://herdr.dev/docs/session-state/ . Installed /usr/bin/herdr is 0.9.0.

Use the full TUI: herdr --session bruv-web-<unique-name>. Not agent attach, which lacks the full sidebar view. Never reuse or stop the user's default session. A fresh daemon inherits environment; a running daemon does not receive changed client environment. Create Bruv shells with explicit per-pane env via socket API (avoid secret CLI arguments), then run the absolute Bruv command in that pane. workspace create, tab create and pane split support explicit env. Existing processes cannot gain new relay environment on reattach.

Bruv already has src/herdr-agent-state.ts. It reports herdr:bruv under a pi-compatible identity for root TUI processes. Clear inherited child-role settings for launched root Bruv. Do not overwrite Herdr's authoritative pane/socket identity. The v0.9.0 resume allowlist excludes herdr:bruv: surviving detach/reattach is not Bruv conversation restore after daemon restart. Cleanup only the dedicated session.

Still needs proof: actual sidebar display, terminal controls, per-pane env reaching Bruv, voice ownership with two panes, and detach/reconnect behavior. Herdr implementation stays gated on the first browser terminal/audio experiment.

## First browser probe

2026-10-09: scripts/web/browser-audio-probe.ts ran against the audio worker source in real headless Chromium with fake media. Passed: no capture before click; 9 capture frames / 5,760 PCM bytes; playback queue observed and flushed; capture gate closes and reopens; stop releases tracks and contexts; explicit reconnect works; browser close reaches CLI transport error. Zero provider calls. This proves device/relay mechanics, not audible speech or the combined terminal /live path. Parent still must run it against integrated files.

## Scope update

User narrowed the task on 2026-10-09: finish the normal browser terminal without Herdr. Do not implement bruv web herdr in this task. Keep the research above only as future context. One browser terminal and one owned audio route are enough.

## Integrated experiment

Parent cherry-picked audio 17b55208 as 4b9fb721 and terminal worker as ac6c82d2. Integrated src/web/server.ts mounts the exact Live route before the browser-only API guard. CLI peers authenticate with their private child-env secret, with no Origin; browser peers still need the terminal token and exact Origin. The relay uses a distinct live-audio channel so generic extensions named audio keep working. The capture worklet is served at /audio-worklet.js under strict same-origin CSP. No blob script permission was added.

Browser controls enable audio explicitly, bind to this server's one terminal, and release it on terminal disconnect/exit. /live stop and Disable microphone release voice only. Re-enable is explicit. CLI process and job state are not reconstructed in the browser.

Compiled browser acceptance passed on 2026-10-09: actual dist/bruv web, xterm rendering, browser fake microphone, pasted /live mic-check, CLI consent, relay start/stop and all tracks/contexts released. Also passed input, socket reconnect, page refresh, 390px layout, no page exceptions, and SIGTERM exit 0. The standalone Chromium audio probe passed against the integrated checkout too. Integrated server test verifies token/Origin protection, subprotocol negotiation, same-origin worklet, CLI secret route, and a still-responsive same PID after audio loss.

Zero-delay browser keyboard.type of the slash command hit an autocomplete race (visible /live mmic-check). The normal TUI test uses bracketed paste, so the committed browser gate does too. A separate paced-key probe is pending; do not hide this observation or call it a transport failure without evidence.

Scope is normal terminal only. Herdr research is deferred, not an unfinished implementation promise. Remaining acceptance: real human speech/acoustic quality and a paid provider session through the browser. Fake-device and fake-provider tests do not claim either. No release/version/PR requested. Values unchanged: the existing whole-path proof, ownership and honest-evidence values cover the lessons here.

Paced-key follow-up passed: typing /live mic-check at 50 ms per key produced the correct command. First Enter accepted the normal slash autocomplete selection; second Enter submitted it. Consent and mic-check completed, then reconnect/refresh/resize passed. The earlier paced timeout was an acceptance-script assumption about autocomplete, not lost terminal input. The unpaced synthetic typing duplication was not reproduced with paced input. The committed gate keeps bracketed paste to avoid testing completion timing as audio behavior.

## Review fixes

Review reproduced two gaps: an old audio socket survived terminal replacement/loss, and relay credentials reached tool/worker environment copies. Parent now releases both voice peers server-side on controlling-terminal loss or replacement. Each terminal attachment gets a fresh audio-owner capability; browser audio needs that capability plus the terminal token and exact Origin. Old tabs cannot reopen voice using their stale attachment. The surviving root CLI keeps its relay secret for explicit reconnect. Tool/worker environment copies strip both relay variables; the owning root environment retains them. Regression tests cover release, stale admission, same PID/input survival, and scrubbed copies.

The first wide regression run had 712 passes, 4 skips, and one failed packaging fixture. It copied browser.ts without its new audio imports. Added those real inputs to the fixture; the isolated packaging check then passed. This was not a product-bundle failure. Final gates are rerunning after the review fixes.

## Final checkpoint

Final typecheck and build passed. Focused wider suite: 722 passed, 4 skipped, 0 failed across 80 files (Live, web, CLI, architecture, packaging, remote-env and connector credential boundaries). Skips include paid provider acceptance. Packaged pair smoke passed; it is not native parity acceptance. Final compiled Chromium mic-check and standalone device/relay probe both passed after ownership fixes. Device probe observed 9 frames / 5,760 bytes, explicit reconnect and browser-loss teardown, with zero provider calls. The final scoped reviewer approved the two ownership fixes after 12 focused tests. Formatting, error-level lint, and diff whitespace checks pass.

Usage: run dist/bruv web from this checkout, or bun src/cli.ts web after asset preparation. Installed bruv is not updated by this work. Remote use is the same-port loopback SSH tunnel documented in src/web/README.md. This task does not add Herdr. Physical microphone/acoustic quality and paid-provider speech remain manual follow-up. No release, push, or PR was requested; commits stay local.

Wisdom added for terminal, audio transport, and the integrated experiment. Existing values already cover observed lessons (whole-path proof, session ownership, and honest evidence), so values.md is unchanged.
