## Findings

**Checked 6 Oct 2026. Read-only; no microphone interaction run.** Evidence below is official documentation or released source—not blogs or feature requests.

### Claude Code CLI: Space coexists with typing through repeat detection

[Official voice docs](https://code.claude.com/docs/en/voice-dictation) · [Keybinding reference](https://code.claude.com/docs/en/keybindings)

- **Enable:** `/voice`; default is hold mode. `/voice off` disables it.
- **Hold:** hold **Space** to record; release to finalize. Default behavior inserts text and waits for **Enter**.
- **Toggle:** `/voice tap`; **Space** starts only when the prompt is empty. The next Space stops and automatically submits transcripts of at least three words.
- **Cancel:** **Esc** or **Ctrl+C** discards the recording and restores the previous prompt.
- **Editor/transcript:** speech appears live, dimmed until finalized, at the cursor. Typing and dictation can be mixed; this does not establish simultaneous typing while holding Space.
- **Typing protection:**  
  > “A single `Space` tap still types a space, since hold detection only triggers on rapid repeat.”

  Warmup inserts repeat characters temporarily, then removes them when recording activates. Space triggers voice only where it would normally enter prompt text—not transcript paging or Vim NORMAL commands.
- **Rebinding:** action is `voice:pushToTalk`, context `Chat`. Documented modifier example: `meta+k`, which starts immediately without repeat warmup.

**Evidence:** current official docs; not a local run. These are Claude Code CLI/VS Code capabilities, not proof of Claude desktop behavior.

### Codex CLI: current release uses a dedicated voice toggle

Latest published release inspected: [**0.160.1**, 5 Oct 2026](https://github.com/openai/codex/releases/tag/rust-v0.160.1).

- **Start/stop:** **F8**, or `/voice`; explicit stop is `/voice stop`.
- **Mute/unmute:** **Ctrl+X**, or `/voice mute`.
- **No hold required:** this is live conversation, distinct from older dictation.
- **Editor stays available:** released code retains typed submissions and calls `note_realtime_typed_input(...)`. Voice uses a compact strip alongside the composer.
- **Transcript:** spoken user/assistant text becomes conversation-history cells, rather than editable dictation inserted into the draft.
- **Typing protection:** dedicated F8/Ctrl+X bindings do not commandeer ordinary Space input.

[Released keymap, lines 1661–1662](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/keymap.rs#L1661-L1662):
> `toggle_voice: default_bindings![plain(KeyCode::F(8))]`  
> `toggle_voice_mute: default_bindings![ctrl(KeyCode::Char('x'))]`

[Voice command routing](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/chatwidget/slash_dispatch.rs) · [Typed submissions](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/chatwidget/input_submission.rs#L489) · [Transcript history](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/chatwidget/realtime.rs#L1604-L1611)

**Evidence:** released code, not a microphone run or verified account availability.

### Older Codex hold-Space implementation: real, but not the current default

[Released 0.105.0 composer source](https://github.com/openai/codex/blob/rust-v0.105.0/codex-rs/tui/src/bottom_pane/chat_composer.rs)

- Enabled with `[features] voice_transcription = true`; [source labels it **UnderDevelopment**, default false](https://github.com/openai/codex/blob/rust-v0.105.0/codex-rs/core/src/features.rs#L650-L654).
- **Empty draft:** Space starts recording immediately.
- **Nonempty draft:** inserts a temporary space; a **500 ms hold** activates recording. Without key-release reporting, repeated Space events are required:
  > “otherwise the keypress is treated as a typed space.”
- **Stop:** Space release; terminals without release events infer release from repeat inactivity. A non-Space key also stops recording **and is consumed**—so the editor is not freely usable during capture.
- **Transcript:** recording meter → transcription spinner → replacement with editable text. No automatic submission shown.
- **Platform caveat:** this version compiles capture out on Linux.

**Evidence:** historical released implementation, not evidence that hold-Space is today’s Codex interaction.

### Codex desktop is separate

Current official pages resolve to the **ChatGPT desktop app**:

[Voice docs](https://learn.chatgpt.com/docs/features/voice) · [Keyboard commands](https://learn.chatgpt.com/docs/reference/commands)

- **Conversation:** select **Start voice chat** / **Stop voice chat**; documented start shortcut **Ctrl+Shift+V**.
- **Dictation:** documented start shortcut **Ctrl+Shift+D**.
- Official distinction:
  > “Use voice dictation when you only want to turn speech into prompt text before sending it.”
- Dedicated shortcuts avoid stealing spaces. The inspected docs **do not establish a dictation stop key or editing behavior during capture**; I would not invent either. Existing-task voice is explicitly rollout-dependent.

## Actual research commands

```sh
/home/tnfssc/.local/bin/tvly search 'Claude Code voice mode hold space dictation' --include-domains code.claude.com,docs.anthropic.com,claude.com --depth advanced --max-results 5 --json

/home/tnfssc/.local/bin/tvly search 'Codex CLI voice dictation hold space' --include-domains developers.openai.com,help.openai.com,github.com/openai/codex --depth advanced --max-results 6 --json

/home/tnfssc/.local/bin/tvly extract https://code.claude.com/docs/en/voice-dictation --json
```

These succeeded. A later source search and extraction failed with exit **3**:

> `"code": "hourly_cap_reached"`  
> `"message": "You reached the hourly keyless Tavily limit."`

Continued via public HTTPS, including:

```sh
curl -fsSL https://raw.githubusercontent.com/openai/codex/rust-v0.160.1/codex-rs/tui/src/keymap.rs | grep -n -A2 'toggle_voice: default_bindings'
```

**Bottom line:** Claude’s documented solution is **repeat-qualified Space**, plus empty-draft gating for tap mode. Current Codex instead uses **dedicated voice controls**. Neither supports inventing a global Space toggle that steals normal typing.