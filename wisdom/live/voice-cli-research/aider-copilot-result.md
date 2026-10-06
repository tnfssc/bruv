## Findings

**Three real terminal interactions: Aider, Claude Code CLI, and GitHub Copilot CLI.** Evidence below is documentation/source inspection—not microphone testing.

### 1. Aider: explicit recording mode
[Docs](https://aider.chat/docs/usage/voice.html) · [Recording source](https://github.com/Aider-AI/aider/blob/main/aider/voice.py) · [Command source](https://github.com/Aider-AI/aider/blob/main/aider/commands.py) · [Input source](https://github.com/Aider-AI/aider/blob/main/aider/io.py)

- **Start:** enter `/voice`.
- **Stop:** **Enter**. **Ctrl+C** cancels (`KeyboardInterrupt` is caught).
- **Editor:** recording temporarily replaces the normal chat-input interaction with a recording prompt; no simultaneous normal prompt editing.
- **Transcript:** current source sets `self.io.placeholder = text`; the next editable prompt receives it through `default=default`. **Review/edit, then submit**—important nuance beyond the older documentation’s demonstration.
- **Typing protection:** explicit slash command, not a hijacked ordinary character.

> “Use the in-chat /voice command to start recording, and press ENTER when you’re done speaking.”

**Evidence:** docs + current implementation.

### 2. Claude Code CLI: hold Space, or empty-input tap mode
[Official docs](https://code.claude.com/docs/en/voice-dictation) · [Full Markdown documentation](https://code.claude.com/docs/en/voice-dictation.md)

- **Enable:** `/voice` or `/voice hold`.
- **Hold:** **hold Space**; **release Space** stops. **Esc / Ctrl+C** cancels and restores the previous prompt.
- **Toggle:** `/voice tap`, then **Space → speak → Space**. First tap starts only when the prompt is empty.
- **Editor/transcript:** live, dimmed transcription in the existing prompt; final text inserted at the cursor. Hold mode defaults to **review, then Enter**. Tap mode **automatically submits transcripts of at least three words**.
- **Typing protection:** hold detection uses rapid terminal key-repeat; ordinary Space taps remain spaces. Voice respects prompt context rather than stealing Space from transcript paging or Vim command mode.

> “A single `Space` tap still types a space, since hold detection only triggers on rapid repeat.”

> “The first tap only starts recording when the prompt input is empty…”

**Evidence:** official docs; no implementation or actual-run verification.

### 3. GitHub Copilot CLI: hold Space or explicit toggle
[Official docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/voice-input)

- **Enable/setup:** `/voice`; downloads a local speech runtime/model.
- **Hold:** **hold Space**, recording begins after a brief delay; **release Space** stops.
- **Toggle:** **Ctrl+X, then V**—a sequence, not a three-key chord. **Any key** stops. **Ctrl+Space** is an alternative only where terminal/OS bindings permit.
- **Editor/transcript:** inserts transcription at the existing prompt’s cursor, editable before submitting. Toggle recording is **not concurrent typing**: the next key stops recording.
- **Typing protection:** explicit toggle or delayed hold gesture. Docs don’t establish the exact hold-detection implementation or ordinary-tap handling.

> “The recognized text is inserted at the cursor position in the prompt input area, where you can edit it before submitting.”

**Evidence:** official docs; no actual-run verification.

## Simple shipped patterns

- **Explicit command → record → Enter → editable draft:** Aider.
- **Hold Space → release → editable draft:** Claude Code and Copilot.
- **Empty-input Space toggle:** Claude Code, **but with auto-submit semantics**.
- **Explicit toggle → any key stops:** Copilot.

None requires Tab-to-fake-buttons. **Aider’s modal approach is simplest; hold-to-talk preserves a mixed voice/text composition workflow.**

## Actual tvly commands

```sh
/home/tnfssc/.local/bin/tvly search "site:aider.chat \"/voice\"" --max-results 3 --json
/home/tnfssc/.local/bin/tvly search "site:code.claude.com voice hold space" --max-results 3 --json

/home/tnfssc/.local/bin/tvly extract https://aider.chat/docs/usage/voice.html --format text --json

/home/tnfssc/.local/bin/tvly extract https://aider.chat/docs/usage/voice.html https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/voice-input https://code.claude.com/docs/en/voice-dictation --query "voice recording start stop ordinary typing transcript" --chunks-per-source 2 --format text --json
```

Search worked. Initial extraction returned **`hourly_cap_reached`**, with `retry_after_seconds: 60`; public HTTPS `fetch()` retrieved the linked docs/source meanwhile. The later extraction succeeded. **No auth changes, keys requested, repository edits, or mockups.**