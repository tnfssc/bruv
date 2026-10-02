# Old prompt flashes before the compact prompt

## Cause and fix

Pi 0.99.1 constructs a bordered CustomEditor, then InteractiveMode.init starts
its TUI **before** awaiting terminal colors (up to 100 ms) and extension startup.
Bruv's createCompactUI installs CompactEditor only during session_start. The
first scheduled paint can therefore show the old blank bordered prompt before
the chevron. This is not an old user draft or replayed session prompt.

src/ui/startup.ts now adapts InteractiveMode.init before invoking Pi main. It
replaces the inactive default editor with CompactEditor before native init runs.
Both defaultEditor and editor point at it, so Pi still wires startup submit,
exit, app shortcuts, autocomplete, and later input callbacks to the active
instance. The editor factory is visible to session_start so bruv does not replace
it a second time. Other extensions can still install their own editor. Text,
Pi's live theme, autocomplete row limit, and embedded working indicator are kept.
No terminal start is delayed, no user settings/history are changed, and no SDK
files are patched by this feature. The adapter is restored when Pi main ends.

This uses private Pi editor/init fields, like the existing presentation adapters.
Review it when upgrading Pi. It is not the browser/Tiptap composer lifecycle bug
in ../t3/composer-editor-startup-lifecycle.md.

## Proof

- Baseline compiled CLI + new plain-PTY test: **fails** on emitted native borders,
  then the chevron. See evidence/startup-editor-first-paint/before.txt.
- Fixed compiled CLI + identical test: only chevron editor from first paint;
  see evidence/startup-editor-first-paint/after.txt. The native footer still
  updates to the compact footer later; this fix addresses the prompt only.
- Existing tmux startup test alone passes even on baseline. tmux answers terminal
  queries before the first scheduled paint, hiding this schedule. The added Linux
  util-linux script PTY answers no terminal-color queries and records **all**
  output, rather than a settled pane screenshot. Ctrl-D exits the real CLI.
- Startup unit tests check pre-native-init replacement, default/active editor
  identity, draft preservation, autocomplete size, factory registration, native
  submit ownership, repeated init, restoration, and an already-selected editor.
- Focused editor tests cover paste/history/app shortcuts, spinner, mouse and
  autocomplete. Existing rendered startup verifies skill warning visibility and
  skill-command registration.

34 focused tests / 346 assertions pass across startup, editor, footer and startup
TUI suites. Root tsc --noEmit, focused Biome formatting and git diff --check pass.

## Validation setup and limits

Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_85c1218d
Branch: bruv/fix-old-prompt-flash-on-startup-85c1218d
Base: 58c1a3d

No install, release, provider call, or user's real session/configuration was used.
Bun 1.4.2 was called by absolute path (mise worktree config is not trusted).
The worktree had no dependencies. Reused prepared dependencies, but copied
pi-coding-agent locally because the shared package still has die host metadata.
Adjusted ONLY those local host marker/message spellings to bruv; maintained
prepare-assets then accepted the exact guarded hashes. Shared dependencies were
not changed by this correction.

The maintained --reuse-packed-web build correctly refused the old archive without
its current manifest. For this CLI-only probe, compiled src/cli.ts directly with
bun build --compile --minify, using prepared runtime assets and an existing
browser archive as an unused embedding input. This is **not** full production web
build/release proof. Linux PTY/tmux coverage only; no Mac/Ghostty, fresh install,
resumed-session/render-mode, live model, full repository suite, or browser gate.
Parent owns launch/install context. Do not infer a user's installed binary version
from this reproduction.

Values unchanged: existing values 1, 2, 6, 7 and 10 already cover real first-frame
proof, honest limits, user-work safety, simple fixes and durable handoff.

## Parent integration

Integrated on develop as c4af41c. Parent reviewed the startup adapter and PTY
regression, then reran startup/editor/footer tests in the main checkout:
32 pass, 335 assertions. git diff --check passed. The compiled PTY proof above
comes from the worker worktree, not a new main-checkout build.
The installed /home/tnfssc/.local/bin/bruv was not replaced. Shipping or local
installation remains a separate next step; no release was requested here.
