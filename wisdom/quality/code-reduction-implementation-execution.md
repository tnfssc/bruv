# Execution cleanup implementation — 2026-10-02

Scope: execution-01–08 from the code-reduction audit. All eight implemented; no feature or archive cuts. Durable branch: bruv/cleanup-task-execution-and-ui-duplicatio-51494356.

## Done

- 01: replaced both JSONC scanner passes with Bun.JSONC.parse; removed the test-only parser export. Kept size, schema, original-byte digest and setup policy. Explicit tests document the approved malformed-input tightening: unclosed block comments and comma-only arrays now fail instead of being silently repaired.
- 02: removed native timeout forwarding after rejection, and inherit alternatives after its return. Worktree source/setup remains nonoptional. Bridge blocked-request code and failed-reply cleanup each have one owner.
- 03: a local prepareLaunch closure owns child session metadata, argv, title, environment and stdin defaults. Inherit spawn/wait/batch cleanup and worktree reserve/activate/deadline ownership stay separate. Ordinary shell dispatch reuses setupShell. Tests assert exact argv, thinking:off, timeout ownership and continuity options only before the parent -- boundary.
- 04: monitor view branches keep headings/layout budgets; bounded inspection, output and agent activity render once afterward. Frozen identity, SSH notes, control stripping and small-height action rules remain.
- 05: footer uses common placement/full/short parts in the original four-candidate order, and shared question interpretation with distinct long/short labels. Cost, cache, live/remote/fast status and question priority remain.
- 06: removed unused folding/keybinding hint and executionStarted argument. Private wrapping still sanitizes full expanded text. Width-zero coverage checks the rendered preview; SDK tests still exercise partial/preparing/started/result transitions. No TUI test edits.
- 07: settlement shares only the resolve/retain/event/diagnostic/notify tail. Spawned process teardown/final-answer substitution and preparation error/abort handling remain distinct. Completed-budget and delivery assertions remain.
- 08: attention scheduling computes its deadline and calls existing clear/arm helpers. Disposed guard, one-timer behavior, quiet/snooze/review policy and noisy-activity resource assertions remain.

Deferred: execution-09+ is not approved. No other proposal in 01–08 was skipped. FFI lifetime handle, diagnostics sidecar, density, cost aggregation, image resize, native/SSH security and durable identity/recovery were not cut. No cross-owner edits needed.

## Proof and reproduction

Installed Bun frozen dependencies into this worktree, then ran scripts/prepare-assets.ts for local runtime assets. Bun is /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun. The host shell's untrusted mise startup polluted shell output; tests use SHELL=/bin/sh and PATH with that Bun directory plus /usr/bin:/bin.

Focused command (prefix with that environment and Bun):

    bun test tests/worktree-workspace.test.ts tests/job-service.test.ts tests/task-manager.test.ts tests/job-attention.test.ts tests/job-bridge.test.ts tests/job-bridge-protocol.test.ts tests/task-monitor.test.ts tests/task-monitor-source.test.ts tests/footer.test.ts tests/execution-previews.test.ts tests/foreground-execution-sdk.test.ts tests/conversation-density.test.ts tests/subagent-placement.test.ts

Result: 205 pass, 0 fail, 1605 assertions (13 files). node_modules/.bin/tsc --noEmit passed. Biome format on 12 changed TS files passed; Biome lint --max-diagnostics=200 on those files exited 0 (27 warnings, 49 infos; existing file-level style/control-regex warnings remain). git diff --check passed.

Compiled focused acceptance: dist/cleanup-jsonc.ts imports the real setup reader; Bun build --compile --minify plus dist/cleanup-jsonc passed 3 assertions (valid setup/digest and two malformed differences). For 20 compiled bridge tests, dist/cleanup-runner.ts uses the same internal runner entry and error formatting as cli.ts, compiled to the tests' required dist/bruv path. This is a focused runner fixture, NOT a complete CLI/web build; dist/bruv was removed after checks to avoid mistaking it for the product. Ignored fixture inputs and logs remain in dist/cleanup-evidence (logs), dist/cleanup-runner.ts and dist/cleanup-jsonc.ts. Initial missing assets/binary failures were setup failures, resolved before the passing final run.

Ephemeral baseline renderer comparisons: original footer/monitor loaded from HEAD into ignored dist files; 26 exact rendered-array comparisons passed for narrow/wide footer candidates, question states and list/inspect monitor heights. Do not retain baseline implementations as maintained tests. Existing real SDK/render tests remain; full product CLI/TUI/web integration gate remains with the parent. No provider, hardware or release action was run.

## Handoff

Production source: +136/-378 (net -242). Focused tests: +119/-21 (net +98). Combined code/tests: net -144; wisdom counted separately. Changes are limited to src/tasks, src/typescript, src/ui and three focused test files. Review risks: native parser deliberately rejects those malformed configs; internal executeInputPreview positional signature changed only at repository callers. No src/agent/extension.ts, src/t3 or *-tui.test.ts edits.

Values stayed unchanged: existing one-owner, honest-proof and preserve-meaningful-tests principles cover this work; parent owns integration of values.
