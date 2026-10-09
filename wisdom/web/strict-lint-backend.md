# Browser backend strict lint

Branch: `bruv/web-strict-lint-backend`.
Worktree: `/home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_176a7a3c`.
Base: `ac77ceec`, the local develop integration retaining browser Live guidance.
Parent tree: `/home/tnfssc/.bruv/worktrees/bruv-web-ghostty-integration`.

[The warning gate](../quality/biome-warning-gate.md) fails on warnings, not
just errors. This pass removes the 38 warnings in `audio-relay.ts`,
`input-ownership.ts`, `launcher.ts`, `terminal.ts` and
`scripts/web/browser-audio-probe.ts`. It does not clean the rest of the branch.

- Keep terminal-report matching and error-text control stripping byte-for-byte.
  Their two regex ignores explain that exact purpose.
- Check required ticket, replay chunk and source entry values at use. Keep
  terminal stop's shared promise; move its assignment out of the return.
- Give the probe's window fields and externally loaded Playwright page a local
  type contract. Use the existing `requireValue` for its two browser pages.
  The socket readiness declaration adds no runtime state.
- Leave trust, input ownership, timeouts, assertions and renderer selectors
  alone. The Ghostty worker may change selectors in the same probe; parent
  combines that overlap. No browser entry, server, CSS or package edits here.

## Proof

All commands use `TMPDIR=/var/tmp`; scratch logs are in `.tmp/strict-*`.

- Strict Biome lint on the five files: no warnings or errors; 16 template
  style infos remain. Format and `git diff --check` pass.
- Root `tsc --noEmit` and `bun run build` pass.
- Browser audio and audio TUI, input ownership, server, multiplexer,
  multiplayer server, theme, theme launch and compiled TUI: 48 pass, 0 fail.
  The first run lacked `dist/bruv`; building resolved it, without test edits.
- Existing launcher guidance/process tests: 7 pass, 0 fail. Source command
  assembly and both help flags pass direct assertions. Source and compiled
  help output match, including browser Live guidance.
- Cached Chromium audio probe passes: stop/reconnect, owner-only capture,
  denial retry, provider-error retry and coding PID survival. Media and
  provider are fake; this is not proof of audible speech or real providers.
- Whole-repo `bun run lint` still fails: 58 warnings, 194 infos across 1,302
  files. The remaining warnings are outside these five files.

Values stay unchanged. This applies the existing simple-owner, scope and
honest-proof values; it does not add a new project-wide rule.
