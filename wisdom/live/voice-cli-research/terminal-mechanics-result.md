## Bottom line

**Holding Space in the normal editor can work—but not universally, and not without distinguishing typing from speaking.** Kitty-protocol release events provide explicit evidence. Legacy terminals provide repeated characters, not release: detecting “release” from silence is a timeout heuristic.

Read-only research; no files changed or mockups built. Evidence below is **official docs/public source**, not an actual microphone/terminal run.

## Terminal engineering

[Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/):

> “The press event type is 1, the repeat type is 2 and the release type is 3.”

For unmodified Space, with suitable enhancements enabled:

```text
ESC [ 32 ; 1 : 1 u   press
ESC [ 32 ; 1 : 2 u   repeat
ESC [ 32 ; 1 : 3 u   release
```

The important requirements:

- **Flag 2:** report repeat/release events.
- **Flag 8:** report printable keys as escape codes. Otherwise Space is normally text.
- `ESC[>15u`, used by bruv, enables flags **1+2+4+8**; `ESC[<u` restores the previous mode.
- Support negotiation establishes protocol capability; an observed Space release establishes that the current input path actually delivers it.
- Absence of repeats does **not** prove release. OS repeat settings, buffering and terminal routing affect that inference.

Official specification:

> “In the default mode … only key press and repeat events are sent and there is no way to distinguish between them.”

**Ghostty:** its [encoder](https://github.com/ghostty-org/ghostty/blob/main/src/input/key_encode.zig#L113) explicitly gates releases on `report_events`, then encodes `.press`, `.repeat`, `.release`. **Code evidence; no local Ghostty run.**

**iTerm2:** [official preferences](https://iterm2.com/documentation-preferences-profiles-keys.html) recommend Kitty over its older CSI-u setting. Its [modern mapper](https://github.com/gnachman/iTerm2/blob/master/sources/Keyboard/iTermModernKeyMapper.swift#L679) handles `.keyUp` as `.release` when `.reportAllEventTypes` is enabled. Applications must be allowed to change key reporting. **Docs + code; no local iTerm2 run.** Neither finding guarantees release survives every multiplexer/input layer.

## What real tools do

| Tool/evidence | Start and exact stop controls | Editor, transcript and typing protection |
|---|---|---|
| **[Claude Code](https://code.claude.com/docs/en/voice-dictation#hold-to-record), official docs** | `/voice hold`; hold **Space**, release to finalize. `/voice tap`: **Space** starts only with an empty prompt; another **Space** stops. **Esc/Ctrl+C** cancel. | Integrated prompt, not a separate recording panel. Speech appears dimmed, then inserts at the cursor; hold mode normally waits for **Enter**. A Space tap remains ordinary typing. Voice activation follows contexts where Space would insert text—not transcript paging or Vim command mode. Tap mode auto-submits transcripts of ≥3 words. |
| **[Copilot CLI](https://docs.github.com/copilot/how-tos/copilot-cli/use-copilot-cli/voice-input), official docs** | `/voice` downloads/enables runtime/model; hold **Space**, release to transcribe. Toggle alternative: **Ctrl+X then V**; **any key** stops. **Ctrl+Space** works only where terminal/OS forwards it. | Transcript inserts at cursor for editing before submission. Hold starts “after a brief moment.” Docs do **not** establish its release-detection algorithm or simultaneous typing behavior; “any key stops” limits typing during toggle recording. |
| **[Codex 0.114.0](https://github.com/openai/codex/releases/tag/rust-v0.114.0), released source** | Opt-in `voice_transcription`; **Space** immediately records with an empty composer, otherwise waits **500 ms**. **Space release or another key press** stops. Legacy fallback: **700 ms initial grace**, then **250 ms repeat-idle timeout**. | Recording consumes input: the stopping key is not inserted. Transcript replaces a recording/transcribing placeholder. Pending Space becomes ordinary text if hold is not established; active paste bursts bypass the trigger. Important limitation: this tagged implementation is **under-development, off by default and disabled on Linux**—not a universal current Codex behavior. |
| **[TalkType](https://github.com/lmacan1/talktype), README + source** | Run separately; **F9** starts, **F9** stops/transcribes/pastes. **F8** re-pastes last transcript. Despite “push-to-talk” branding, this is a toggle. | Editor remains outside the recorder and usable. Uses OS keyboard monitoring, not terminal release events; pastes into the original window. F9 avoids taking Space from typing, but [source](https://github.com/lmacan1/talktype/blob/main/talktype.py) uses a listener without suppression, so don’t assume F9 cannot also reach the target application. |

### Explicitly documented compromises

Claude:

> “Claude Code detects a held key by watching for rapid key-repeat events…”

> “The first couple of key-repeat characters type into the input during warmup and are removed automatically…”

Thus Claude proves an integrated **repeat-based** interaction exists; its docs do not prove a particular release timeout or Kitty implementation.

Codex’s [tagged source](https://github.com/openai/codex/blob/rust-v0.114.0/codex-rs/tui/src/bottom_pane/chat_composer.rs#L118) explicitly documents the heuristic:

> “While recording, repeated space events keep the recording alive; if they stop for a short window, we stop and transcribe.”

## What bruv can realistically retain or copy

Current `src/live/push-to-talk.ts` deliberately says:

> “No timeout guesses. A real Space release must prove hold support before sending.”

It currently provides:

- A **dedicated focused panel** that consumes input; the ordinary editor is **not usable while it owns focus**.
- One muted Space press/release to establish support, then hold Space/release to mute.
- Legacy-safe **Enter: talk; Backspace: mute**—idempotent rather than repeat-sensitive toggling.
- **Esc/Ctrl+C:** close muted; `/live talk`: reopen; `/live stop`: end Live.
- Muting on focus loss/disposal; paste never activates speaking.
- Live transcripts flow into Live/conversation handling, **not editable prompt dictation**.

**Recommendation, not a shipped feature claim:** retain the release-aware controller and audio gate. For editor-integrated operation, either use a separate speaking shortcut while leaving Space untouched, or explicitly adopt Claude/Codex’s delayed-Space discrimination. Supporting legacy “hold” would require accepting timeout inference; it cannot honestly preserve the current “real release only” guarantee. Prompt dictation would also require separate transcript-insertion behavior.

## Commands actually used

```bash
/home/tnfssc/.local/bin/tvly search "kitty keyboard protocol report event types release ghostty iterm2 Claude Code voice space hold"

cd /tmp && /home/tnfssc/.local/bin/tvly search "Claude Code voice hold space release terminal voice mode" --include-domains code.claude.com,github.com --json

cd /tmp && /home/tnfssc/.local/bin/tvly extract https://sw.kovidgoyal.net/kitty/keyboard-protocol/ https://ghostty.org/docs/vt/kitty-keyboard-protocol https://code.claude.com/docs/en/voice-mode --format text --json

cd /tmp && /home/tnfssc/.local/bin/tvly extract https://code.claude.com/docs/en/voice-dictation https://docs.github.com/copilot/how-tos/copilot-cli/use-copilot-cli/voice-input https://iterm2.com/documentation-preferences-profiles-keys.html https://github.com/lmacan1/talktype --format text --json
```

The guessed Ghostty and Claude `/voice-mode` URLs returned **404**. A later search returned **exit 3, `hourly_cap_reached`, retry-after 62 seconds**. Continued through direct public HTTPS using `fetch()` on official docs/GitHub sources; no authentication configuration or key requests.