# Shared editor voice implementation

User said do that after the real CLI research. This is now product work, not another HTML mock. Target: normal editor tap Space stays text; hold Space speaks; ordinary shared conversation shows complete spoken turns once. Keep spoken replies and current provider/tool authority. No separate voice screen, focusable web buttons, or three-key chord.

Research: [real CLI patterns](voice-cli-research/findings.md). User owns the goal; parent chooses and integrates pieces. Values read, including the input-model lesson in #8.

## Ownership

- task_fc432d67: Editor-integrated hold Space input. Workspace /home/tnfssc/.bruv/worktrees/t3-7231ab8c-5442693331ce-task_fc432d67, branch bruv/editor-integrated-hold-space-input-fc432d67.
- task_7d11acb0: Shared conversation voice presentation. Workspace /home/tnfssc/.bruv/worktrees/t3-7231ab8c-5442693331ce-task_7d11acb0, branch bruv/shared-conversation-voice-presentation-7d11acb0.
- task_23037746: Plan real terminal acceptance for shared voice UI. Workspace parent shared checkout, branch parent branch.

Input worker owns src/ui/editor.ts, new editor-push-to-talk module and input tests. Conversation worker owns transcript grouping/presentation helpers, src/session/transcript.ts, main-owner passive presentation if needed, and focused tests. Parent owns src/live/extension.ts integration, terminal fixtures and end-to-end checks. Test-planning worker is read-only.

Each code worker must commit its patch; parent will inspect and integrate, then run combined checks. Do not conflate finished child work with a finished feature. Actual PTY renderer with fake provider/audio is available; real device/provider acceptance still separate.

## Setup and next steps

Automatic worktree setup failed on untrusted mise and Bun PATH. Bun 1.4.2 exists at /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun. Parent frozen-lockfile install and prepare:assets succeeded using explicit PATH and SHELL=/bin/sh. No trust/key/provider change. tmux, script and ffmpeg available. Workers have the explicit Bun path.

Parent is tracing extension lifecycle/render/persistence while workers implement. Wait for their API snippets before wiring extension. Preserve native capture-origin epochs; release/cancel must close host gate before async teardown. Normal Enter/Backspace must keep text behavior. Any repeat-idle legacy inference must be called an inference and tested, not passed off as a real key-up. Keep one history/context owner and never make passive display create a second model/tool turn.

Next: read test-plan result, integrate committed worker APIs, replace focused panel attachment/lifecycle in extension, show completed turns through shared conversation, keep only bounded partial draft view, update terse status and actual PTY fixtures. Run typecheck and focused provider/owner/input/transcript suites, inspect real visible frames at 80/120 columns and replay. No push/release requested.

Baseline before worker integration: explicit-Bun `bun run check` passed. This proves only the starting source typechecks, not the new behavior. Worker implementation and terminal acceptance are still pending.


## Integrated result

Input commit 87234f4e and conversation commit f5f5c918 are in the parent branch. The existing CompactEditor stays active. The focused panel, Enter/Backspace mic bindings, release probe and /live talk action are removed. /live starts voice. Tap Space types. Repeat-held Space opens the send gate. Release, typing, navigation, paste, focus loss, renderer change and stop close it. Typed drafts keep cursor, undo and paste state. Hands-free stays an explicit choice.

One terse status row remains. No static waveform or second completed transcript. Partial text stays bounded; full completed turns are ordinary history. GPT uses source-reference groups, not copied context. Casual GPT speech gets a visible group. An actually admitted current speech group stays hidden when the canonical user turn represents it. A delegated request can include earlier retained speech; earlier history must not be erased because it also forms request context.

The GPT 800 ms timer is a local display boundary only. It does not make text final, authorize tools, or prove playback. Stored uncertainty remains. UI marks partial/interrupted text when needed, but does not repeat Audio playback unverified under every reply. OpenAI whole-final replacement replaces outputUtterance as well as the draft log; deltas plus finals no longer produce HelloHello.

Provider control bytes cannot reach terminal prose. Raw passive source stays untouched. Direct finals that need sanitization retain exact source in hidden audit and safe prose for normal replay. OSC52/clear-screen/bidi probes cover custom rendering and direct replay. Temporary key probes were removed; no prompt logging remains. Stop warnings name the uncertainty plainly, never claim off on failure, and offer no unsupported retry. Tool results retain exact errors; jobs are untouched.

## Acceptance and limits

173 distinct focused input/owner/provider/transcript/presentation checks pass, plus two tmux/PTY checks at 80 and 120 columns. The final focused run had one obsolete autocomplete expectation for removed talk; that expectation was corrected and all 75 extension tests rerun green. Typecheck and focused Biome checks pass.

The PTY uses the real source CLI/editor/renderer, canonical owner and saved session. Only provider/mic are synthetic. It checks taps, repeats, draft preservation, stale capture rejection, blur, stop, long replies, whole-final replacements, resize and reopen. See tests/live-push-to-talk-tui.test.ts and its fixture. Captures inspected in /tmp/bruv-voice-acceptance are diagnostic frames, not product demos. They show full replies once, normal typed turns and editor, no You:/Voice: widget labels or raw replay JSON. The 80-column replay resizes the real window to 80 rows so both long replies fit; older messages naturally scroll off a 40-row viewport. Reopen needs session-only trust handling again. Slash-argument suggestions need dismissal before Enter submits; the fixture no longer mistakes accepted completion for broken stop.

No physical keyboard, real microphone, provider or paid API trial was run. Injected key releases prove PTY routing only. Legacy terminals infer release after 250 ms without repeats; not observed key-up. Physical hold/release on the user's terminal remains. GPT-Live primary has no manual input-turn control and remains continuous-only; use Gemini/OpenAI Realtime for hold-to-speak. No release, install or push requested.

README now matches terminal controls. Added input, conversation and test handoffs. Values #8 gained the lesson from the failed browser-button mock: design the target product's real input model, then prove it. No new value needed.
