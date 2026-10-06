**Read-only findings:** workspace `/home/tnfssc/.t3/worktrees/bruv/t3-7231ab8c`. No edits or commit. Read research/values; preserve parent’s editor-Space/shared-history decision.

**Verified baseline**
```sh
PATH=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin:$PATH \
SHELL=/bin/sh \
/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun test \
 tests/editor.test.ts \
 tests/live-push-to-talk-tui.test.ts \
 tests/live-gpt-tui.test.ts
```
**11 passed, 0 failed.** Actual tmux/Pi rendering, synthetic audio/provider only. Existing PTT frames still show the rejected separate four-row control screen.

Dependencies/assets exist; Bun 1.4.2 and tmux 3.6a work. `shell()` invoked fish and emitted mise-trust errors despite intended shell settings; explicit `/bin/sh` through `Bun.spawn`/`spawnSync` worked. Do not change trust.

### Focused fixture changes

1. **Update `live-push-to-talk-tui` fixture/test**
   - Retain source CLI, fake capture frames, gate epochs, send/end counters.
   - Use the real owner, not today’s owner stub, for shared-history acceptance.
   - Add controllable connection warmup, stale-frame injection, playback/flush/stop counters.
   - Install the offline ordinary-response stream from `fixtures/live-spoken-tui.ts`, so normal Enter cannot call a provider.
   - Test widths **80 and 120**, height 40. Keep the editor visibly present throughout.
   - Stop asserting `Enter: talk`, `Backspace: mute`, and `Esc: return to text`.

2. **Replace `live-gpt-tui`’s bounded-widget acceptance**
   - Its current name/expectations explicitly bless the old widget.
   - Emit uniquely marked, finalized user/assistant turns plus a reply exceeding four wrapped rows.
   - Assert ordinary-history presentation, one occurrence per finalized turn, and complete reply beginning/middle/end—not merely `delta23`.
   - Keep GPT continuous-mode presentation separate from PTT gesture acceptance.

3. **Add saved-session reopen to that real-rendered flow**
   - Replace `--no-session` with `--session <SessionManager-created file>`.
   - Follow `long-thread-tui.test.ts`: `respawn-pane -k`, same session, no new fake speech on reopen.
   - Check persisted user/assistant message counts and reopened rendering; forbid visible transport JSON, `hostContext`, `gpt_live_provisional`, and `[live-transcript]`.

### Minimal acceptance sequence

- Type `left`, tap Space, type `right`: exact draft `left right`; no sends.
- Repeat with explicit CSI-u press/release:
  ```sh
  tmux -L "$socket" send-keys -t ptt -l "$(printf '\033[32;1:1u')"
  tmux -L "$socket" send-keys -t ptt -l "$(printf '\033[32;1:3u')"
  ```
- Hold using press plus repeated `ESC[32;1:2u` events; release with `ESC[32;1:3u`. Check activation and exact draft preservation.
- Repeat hold during delayed connection warmup; resolve connection while repeats continue. Check activation without deleting genuine draft spaces.
- After release, Escape cancellation, focus-out `ESC[O`, and `/live stop`: counters must remain unchanged despite ongoing/stale synthetic frames. Check playback teardown where applicable.
- Escape from a normal dialog must still restore the editor. Ordinary typed Enter must submit once and receive the offline reply.
- Finalized spoken turns must appear once beside typed turns, including the long reply; resize and reopen must retain them without JSON.

**Launch/setup:** reuse existing source launch:
```sh
env HOME="$home" PI_OFFLINE=1 BRUV_SUBAGENT_DEPTH=0 \
 OPENAI_API_KEY=offline-placeholder SHELL=/bin/sh \
 "$bun" "$root/src/cli.ts" --offline --no-session --no-extensions \
 -e "$root/tests/fixtures/live-push-to-talk-tui.ts" \
 --provider openai --model gpt-4o
```
Keep the existing temporary-HOME theme symlink; temporary tmux config should append `set -g default-shell /bin/sh`. Use `waitForLiveTuiStartup`; captures belong in temporary storage.

**Gap:** injected CSI-u events prove application handling through a real PTY, not physical keyboard/release delivery. Plain-repeat release inference needs a separate test only if parent chooses that compatibility behavior.