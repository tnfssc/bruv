# Test infrastructure cleanup implementation — 2026-10-02

Scope: tests1-02/04, tests2-03, tests3-02/04, tests1-followup1 F04, tests2-followup3 F03. Baseline: d80d7058a2f5481f067586fd7042fe2746cff4ae. Reports were read from the parent audit directory; proposals were checked against actual callers.

## Done

- Added only tmux command/capture, bounded frame polling and POSIX quotation primitives in tests/tui-helpers.ts. Fourteen TUI files use them; all existing test names, timeouts, assertions, key sequences, widths and negative cases remain. Source/compiled launch argv, private HOME/socket, theme links, cleanup and command-specific startup barriers stay local.
- Fixed the pre-existing apostrophe escaping drift. Added shell roundtrip assertions (including spaces/apostrophes/injection syntax) and a real private-tmux regression proving config, viewport vs scrollback, polling timeout and missing-marker diagnostics.
- Reused tests/helpers.ts run() in nine history child-process sites across seven files, including the matching projection-parity probe. Generated scripts, cwd/env keys, concurrent stream drainage and original failure diagnostics remain; native/adapted SDK probes and fs fault mocks still run in separate children. All now deliberately scrub inherited Herdr identity.
- Monitor readiness marker and harmless repeated slash-command probe remain local; the requests===0 check and confirmed-target-only stop assertions are unchanged. Live startup still uses the existing waitForLiveTuiStartup; goals still proves slash-command readiness; plain script PTY first-paint tests remain.

## Deliberately not generalized / deferred

- Fullscreen line parsing/capture success assertions remain local: routing the line-array predicate through shared string polling added complexity without useful ownership reduction. It still shares tmux/capture/quote mechanics.
- Did not extract source-theme setup, launch arrays, lifecycle ownership, generic SDK fixtures or command completion into a framework. No test, feature or archive was removed.
- tests1-04 SSH config consolidation is deferred to tooling coordination, not staged here: deleting fixture copies without runner staging breaks Docker build contexts. A single owner must update scripts/remote-e2e.sh, scripts/remote-placement-e2e.ts, scripts/remote-root-placement-e2e.ts, scripts/task-placement-clean-capture.ts plus tests/remote-typed-root-placement-fixture.test.ts and the three fixture configs together. Keep public-key-only policy and exact container COPY destination. No scripts/fixtures were changed by this worker.

## Validation / reproduction

Local dependencies: Bun 1.4.2 frozen install into this worktree (no parent node_modules symlink). Commands used PATH=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin:/usr/local/bin:/usr/bin:/bin. Existing parent dist/bruv was copied (not linked) into ignored local dist; local prepare-assets ran for source tests/typecheck. No full build, CI, provider, hardware or release action.

- bun test tests/subagent-settings-tui.test.ts tests/main-agent-mode-tui.test.ts tests/execution-previews-tui.test.ts tests/questions-tui.test.ts tests/task-monitor-tui.test.ts tests/live-picker-tui.test.ts tests/live-gpt-tui.test.ts tests/fullscreen-editor-tui.test.ts tests/questions-interactive-tui.test.ts tests/session-costs-tui.test.ts tests/cache-countdown-tui.test.ts tests/startup-tui.test.ts tests/goals-tui.test.ts tests/live-spoken-tui.test.ts tests/tui-helpers.test.ts — 21 pass, 0 fail, 363 expectations, 41.17s.
- After keeping fullscreen parsing local: bun test tests/fullscreen-editor-tui.test.ts tests/tui-helpers.test.ts — 4 pass, 0 fail, 130 expectations, 7.61s.
- bun test tests/history-sdk-099.test.ts tests/history-storage.test.ts tests/history-disk-retrieval.test.ts tests/history-storage-cleanup.test.ts tests/history-storage-lifecycle.test.ts tests/history-storage-io.test.ts tests/history-projection-parity.test.ts tests/offline-process-isolation.test.ts — 16 pass, 0 fail, 85 expectations, 3.44s. Each of the seven history files also passed in its own Bun invocation (15 tests total). This is selected discovery, not a full root suite.
- bun run check and final bunx tsc --noEmit passed. Scoped biome format and lint passed; lint has only two pre-existing noUselessStringRaw infos. git diff --check passed. Static comparison found exactly the same expect() count in every modified baseline file.

Net code/test diff: +209/-238 = -29 physical lines across 23 files, including 60 new regression-test lines. Infrastructure alone is -89 lines. Wisdom is separate. Risk: compiled acceptance used the existing binary, not a rebuild; parent owns the combined gate. The only intentional behavior change is correct shell quoting for formerly broken apostrophe arguments (plus deliberate Herdr scrubbing in history children).
