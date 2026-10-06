# Real-terminal performance workloads

Read values and the long-thread performance audit before designing these fixtures. No performance fixes are part of this change.

## API (scripts/terminal-perf/workloads.ts)

- `createWorkloads({ sizes?, modes?, columns?, rows? })` returns lazy named fixtures. Defaults: sizes 100/500/1000, 100 columns, 32 rows, all six modes.
- Names: `long-thread/<mode>/<size>`; modes: `input`, `animation`, `streaming`, `resize`, `scrollback`, `task-update`.
- Size means the number of settled executes **and** typed task rows, not terminal height or total components. Local/native/SSH sources are deterministic typed records; no actual tasks/connections are launched.
- Lifecycle: `workload.setup(); for (...) workload.step(); workload.dispose();`. Setup establishes and renders the baseline; steps are synchronous. Always dispose in finally. Repeated setup after disposal resets iteration and fixture data.
- Run ONE fixture at a time: conversation-density and SDK task-row adapters modify prototypes. Overlapping setup throws. Dispose restores adapters and drops the runtime, so the catalog does not retain all historical documents after running them.
- Each step returns `{ iteration, mutations, outputBytes, outputWrites, outputHash, screenHash, screenChanged, changedRows, output, work }`.
- `output` holds ONLY that frame's ANSI writes; the fake terminal resets its capture every frame. Hashes are deterministic FNV fingerprints, not cryptographic checksums. `changedRows` compares actual pi-tui screen lines, including rows removed by resize. Writes alone are not proof of visible progress.
- `work`: logical `frames`, `documentRenders`, `documentLines`, `componentRenders`, `componentLines`, `branchCalls`, `branchEntries`, `snapshotCalls`, `snapshotRows`, `renderRequests`. Counted lines/entries/rows sum over invocations, not unique retained entities. Frame count is one driver call; layout may render the document multiple times per frame. Render-request count tracks the public requestRender method, not private input-immediate scheduling.

## What runs

The public pi-tui **1.0.3** `TuiAltScreen.renderNow()` drives actual fullscreen layout, viewport clipping, terminal screen diffing, and ANSI writes through a fake Terminal. Setup calls `start()`; input and resize invoke its installed callbacks. Public renderNow synchronously drains requested scheduler work so sampling does not wait on timer cadence. Nothing invokes doRender privately or benchmarks isolated component.render alone.

The history uses actual SDK UserMessageComponent, AssistantMessageComponent, ToolExecutionComponent, CustomMessageComponent, plus Bruv conversation-density, installSdkTaskRows, ActivityController.attach, and execute/completion previews. Four executes per user turn keep rolling groups useful and include periodic settled notices. Session-manager getBranch returns a deterministic in-memory branch; branch and task-snapshot traversal counts reveal repeated historical work. It deliberately lacks the production disk-backed revision interface, so getBranch fallback scans are measured, not disk-backed history optimization.

The current SDK Theme instance is imported from the pinned package's resolved ESM entry directory because the package root does not expose that instance. Theme initialization disables filesystem watching.

## Bounded mutations and known scope

- Input dispatches Ctrl-U then one replacement character through TUI into real pi-tui Input (not Bruv's complete interactive editor).
- Animation manually advances real execute-preview spinner state, without intervals or wall-clock dependence. The live ToolExecutionComponent is a docked stack child outside the historical rolling document: collapsed rolling headers hide the native spinner. Historical activity/task ownership still traverses through the full frame.
- Streaming replaces an eight-line partial result with numbered chunks, rather than retaining an unbounded stream. Its live native tool is expanded inside the scroll view.
- Resize alternates the configured dimensions and a width/height reduced by 11/3. Scrollback alternates beginning/end of the retained document.
- Task updates change a live typed native row between running/succeeded; the historical settled rows remain unchanged.

These are provider-free fixtures, not full InteractiveMode, tmux/PTY, or visual acceptance tests. No timing threshold is asserted here. The harness/profiler owns timing and the 8 ms budget. A fast sample with zero screen changes must not count as performance success; preserve work counters in reports. Instrumentation, mutation, and hash collection add overhead if timing the complete step, so reports should identify that scope.

## Checks

`bun test tests/terminal-perf-workloads.test.ts` covers all six modes, deterministic repeated setup, real ANSI writes and changed screen rows, history work at 100/500/1000, sequential adapter restoration, option validation and fake-terminal callback/capture behavior. Work counts—not fragile milliseconds—prove historical work is present.
