# Browser CI repair

Worktree: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_29c1887c. Base: PR68 head 29b7f880. Parent delivers through existing PR64; no worker push or PR changes.

## Causes and fixes

- [37940901015](https://github.com/tnfssc/bruv/actions/runs/37940901015): all Linux lanes stop at 16 HTML lint errors. Add button types, make labelled keyboard-focusable status tooltips native buttons, and give the closed dialog initial heading/label text. Five CSS lines preserve status padding, cursor and hover appearance. Browser code still sets the specific dialog text before opening it. No suppressions or CI policy changes.
- After lint, six notice tests lack the new Nerd Font inputs. Add all five synthetic notice files and assert they appear in the bundle. Keep total input below the existing 100-byte budget so its test still reaches the rendered-output check. No changed budget or weakened assertion.
- [37907910589](https://github.com/tnfssc/bruv/actions/runs/37907910589): web guidance test hangs after web became a server. Existing c3cfb741 already calls web --setup; it passes here. No timeout extension.

## Proof and limits

- Notice suite: 6 passed. Captured resource replay: 4 passed without inherited worker placement. Browser theme/TUI PTY tests: 2 passed under /var/tmp.
- Chromium workspace design probe passed: idle status hidden, keyboard-focus detail, dialog/menu actions, narrow screens and empty states. Viewed desktop and phone captures; compact appearance stays intact.
- Full unsharded Linux gate passed: 3,212 passed, 31 existing skips, 0 failures, 121,883 assertions across 370 files. Format, lint, typecheck, both resource budgets, paired build, offline OpenAI transport and paired smoke passed. Logs: artifacts/ci-verified/ and artifacts/ci-verified-gate.log. Captures: artifacts/workspace-design/.
- Earlier local setup failures: /tmp full (16 GiB); worktree temp paths find a Git ancestor and exceed tmux socket limits; home temp paths inherit .bruv resources and show trust prompts; worker placement disables root question binding. Use TMPDIR=/var/tmp (the gate makes its own short subdirectory) and unset inherited worker/config overrides, not product or test changes. Earlier logs stay under ignored artifacts/ci-*.
- Fresh GitHub green remains parent-owned. No new macOS/native-audio/device/paid-provider proof; native/macOS passed in the inspected run. See [integration proof](live-polish-integration.md).

## Merge

index.html overlaps logo edits: retain canonical logo plus button types, native status buttons and initial dialog text. browser.css adds padding: 0 and cursor: default to shared status styling and transparent terminal-controls button hover; keep connection padding 8px 3px. Notice changes are in generate-third-party-notices.test.ts, not the parent's asset fixture. No browser.ts edits.

Reproduce the Linux proof in this worker environment:

```sh
env -u BRUV_SUBAGENT_TYPE -u BRUV_SUBAGENT_DEPTH \
  -u BRUV_CODING_AGENT_DIR -u PI_PACKAGE_DIR -u PI_CODING_AGENT \
  -u CLAUDE_CONFIG_DIR -u BRUV_CLAUDE_COMPAT_HOME \
  -u BRUV_CLAUDE_COMPAT_BRUV_PATH TMPDIR=/var/tmp bun run ci
```

Values unchanged: existing values cover observed causes, real user paths and honest proof limits.
