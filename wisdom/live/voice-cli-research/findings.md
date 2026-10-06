# What real voice CLIs do

User asked for tvly research after rejecting browser buttons, Tab-to-control, and a three-key hold chord. Parent used /home/tnfssc/.local/bin/tvly search/extract. All three read-only research tasks finished. No product code or new mock changed in this research round.

## Primary evidence

### Claude Code: repeat-qualified Space in the normal editor

Official docs: https://code.claude.com/docs/en/voice-dictation and its full .md URL. Parent stored discovery.json, claude-official.json and claude-voice-dictation.md. Tavily extract omitted prose, so parent fetched the official Markdown directly.

/voice hold enables default hold mode. Tap Space types a space. Rapid repeat starts recording after warmup; warmup spaces are removed on activation. Footer says keep holding… then listening…. Speech is dimmed in the existing prompt, then finalized at cursor position. Release normally finalizes without submitting; Enter sends. Auto-submit is optional. Space only triggers where it would type prompt text, not transcript paging or Vim non-insert mode. Esc/Ctrl+C cancel and restore the draft without also invoking their usual app action.

/voice tap is another documented mode: Space starts only when prompt empty; next Space stops regardless of content. At least three words auto-submit; shorter transcripts stay editable. Silence and total duration have caps. Docs explain START detection, not the raw release algorithm. Do not claim Kitty-only implementation or a particular release timeout from the docs.

### Copilot CLI: Space hold or a toggle sequence

Official docs: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/voice-input. Parent independently fetched official github/docs Markdown into copilot-voice-input.md.

/voice enables/downloads local speech runtime/model. Hold Space starts after a brief delay. Release inserts transcription at the prompt cursor for editing. Ctrl+X then V toggles a long recording; any key stops it. Ctrl+Space is an alternative only if OS/terminal forward it. Docs do not establish raw release detection or fully concurrent typing during recording.

### Aider: explicit record, then review

Docs: https://aider.chat/docs/usage/voice.html. Parent checked current main source, saved as aider-voice.py.txt, aider-commands.py.txt and aider-io.py.txt. /voice starts recording; Enter ends the recorder prompt; Ctrl+C cancels. Recording is modal. cmd_voice puts transcription in io.placeholder, then the regular prompt consumes it as an editable default. Review/edit then submit. The source is more precise than older demo wording.

### Codex: distinguish current conversation from old dictation

Current inspected tagged source: rust-v0.160.1. https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/keymap.rs. Parent independently fetched it and verified F8 toggle_voice and Ctrl+X toggle_voice_mute; excerpt in codex-0.160.1-keymap-evidence.txt. Released source routes /voice and /voice stop, keeps typed input available, and places spoken user/assistant turns in conversation history with a compact voice strip. Account availability and actual microphone behavior were not tested.

Older released 0.105.0 / 0.114.0 source has opt-in, under-development voice_transcription. Empty draft starts on Space; nonempty draft uses a delayed hold and repeat events. Legacy stop infers release from repeat inactivity; a non-Space key can stop and be consumed. It is disabled on Linux in the inspected versions. The two agents inspected different versions: these are not contradictions, and old hold behavior must not be presented as the current default.

### Terminal mechanics

Kitty specification: https://sw.kovidgoyal.net/kitty/keyboard-protocol/. Press/repeat/release are types 1/2/3. Flags 2 and 8 are important for printable Space release reporting. Ghostty encoder and iTerm2 mapper code support releases when reporting is enabled. Negotiation does not prove events survive every multiplexer/input route. Traditional input lacks explicit release; silence between repeats is an inference, not proof.

bruv src/live/push-to-talk.ts currently requires an observed release before enabling hold, uses a separate focused panel to keep plain Space out of the editor, and falls back to Enter talk / Backspace mute. Keep origin capture gating and muted focus-loss behavior. A shared-editor hold needs deliberate tap-versus-repeat handling, not just relabeling an HTML button.

## Parent recommendation

Use Claude's editor-level Space gesture and Codex's shared-chat presentation. /live enables voice. Ordinary Space still types. Holding Space speaks without Tab-to-a-button or moving to a separate screen. Show one terse hint/state in the existing input/footer area. Finished spoken turns stay in normal history. Keep bruv's spoken replies; Claude/Aider/Copilot mainly dictate prompt text, so do not copy their review/submit semantics or tool authority blindly. Release ending a live audio turn is different from finalizing editable dictation.

Do not promise universal hold support. Prefer real release where available. If compatibility requires a legacy inference, make that an explicit product decision and validate it in real terminals; otherwise use an explicit tap/toggle fallback. No production implementation was authorized here. The next mock must simulate the actual editor keystrokes, not pointer capture and button focus.

## Provenance and access

Read-only workers: task_20806933 (Claude/Codex), task_269ea871 (Aider/Copilot), task_f018cf6f (terminal mechanics). Full results are stored alongside this note. Their commands and source links are there. Parent successfully ran tvly search and extract. Some later worker calls hit hourly_cap_reached; they continued through public HTTPS, without auth/key changes. Guessed /voice-mode and Ghostty doc paths returned 404 and were not used as evidence.

These are current documentation and source inspections on 2026-10-06. No local run of the other CLIs, microphone test, key-release/hardware test, provider call, or paid audio request. Do not substitute docs, source or browser tests for real terminal acceptance.

## Wisdom and values

Research notes, primary excerpts, and delegated results added here. ui-rethink-handoff.md marks the browser control scheme rejected. Values #8 refined: use the product's real input model in mockups and research shipped controls; similar UI is not runtime proof. Repeated user corrections exposed the same lesson, so it belongs in the existing human-UI value, not a new value.
