# Independent long-thread audit

Parent-owned evidence. Implementation lives in `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_6d5d7a6d`, branch `fix/long-thread-tui-lag`. Audit baseline was `156e2450`. The integration branch starts at `origin/develop` (`b47e4f5f`), so unrelated local commits stay out. The first broad implementation worker was stopped before edits. Focused implementation branches are `fix/task-row-render-scaling` (`/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_6eac24a1`) and `fix/activity-repaint-history` (`/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_62848607`). Parent adds the compiled long-thread test and opens the PR after integration.

The following is the read-only audit report from before implementation. See [the final handoff](sdk-task-row-ownership-index.md) for the fix, matched benchmark, tests, human-selected PR scope, and separate local activity-cache branch.

## Findings

**The largest demonstrated bottleneck is Bruv’s task-row adapter, not terminal output or Markdown parsing.** A second independent problem is full disk-backed branch materialization on every fullscreen frame.

No repository/worktree/dependency files were edited. Probes were written only under `/tmp`; persistent-session fixtures were removed afterward.

### 1. Task-row ownership repeatedly scans the entire transcript

`src/ui/sdk-task-rows.ts`:

- **52–57:** every adapted component computes native/task content *before* applying activity collapse.
- **69–85:** each collapsed execute/task notice scans every sibling and reparses all typed task details.
- **87–101:** repeats snapshot merging and linear source-component searches for every row.
- **103:** repeats owner filtering.
- **153–158:** every `Container.render` also walks its children to adapt them.

For **N execute components with no tasks**, this already performs **N² sibling inspections per frame**. With R task rows, the repeated source searches can contribute **O(N²R)** work—cubic when R grows with N.

Activity collapse does not avoid this calculation: its projection receives already-rendered lines.

### 2. Activity synchronization reads all historical bodies every frame

`src/ui/rolling-activity.ts`:

- **85–87:** chat render calls `state.sync()`.
- **107:** sync calls `sessionManager.getBranch()`.
- **39–57:** membership then scans the full returned journal.
- **112:** user fallback uses `children.indexOf(child)` inside the child loop.
- **124, 134, 137:** further repeated `find`/`includes` membership searches.
- **139–150:** group labels repeatedly aggregate group tools.

The shipped CLI activates disk-backed history at `src/cli.ts:206–207`. Its `getBranch` implementation at **`src/history/session-manager.ts:295–298`** materializes every branch entry.

**`src/history/disk-entry-store.ts:436–460`** does synchronous reads on cache misses and JSON parsing even on cache hits. The byte cache is only **4 MiB**, declared at line 18. Consequently, activity repaint can reread historical bodies—including histories larger than the cache—with no visible transcript changes.

## Measured facts

All frame benchmarks used `renderLayoutFrame(..., 100, 30, ...)`, three warmups and five measured frames; numbers below are medians. These are local source/dependency benchmarks, **not compiled-binary or real-TTY latency measurements**.

### Real Pi ToolExecutionComponents, settled executes, no tasks

| Execute components | Native baseline | SDK task rows | SDK + collapsed activity |
|---:|---:|---:|---:|
| 100 | 0.185 ms | 1.545 ms | 1.168 ms |
| 500 | 0.384 ms | 21.389 ms | 31.693 ms |
| 1,000 | 1.154 ms | **135.757 ms** | **154.919 ms** |

Even with collapsed activity, all **1,000 native tools rendered per frame**.

An isolated prototype-shaped fixture counted precisely **1,000,000 result reads/frame at N=1,000**, and **4,000,000 at N=2,000**, with no task rows. This directly confirms the quadratic sibling scan.

### Valid typed task rows, isolated ownership calculation

With one distinct valid task row per execute:

| Components/tasks | Frame median |
|---:|---:|
| 100 | 14.997 ms |
| 200 | 71.504 ms |
| 400 | **427.777 ms** |

These frames performed **zero native renders**: the ownership calculation itself was expensive.

### Actual disk-backed SessionManager, empty visible chat

With 16-KiB user bodies and activity attached:

| Historical entries | Journal size | Frame median | Materializations/frame |
|---:|---:|---:|---:|
| 100 | 1.66 MB | 2.811 ms | 100 |
| 1,000 | 16.57 MB | **19.162 ms** | 1,000 |

There were **zero visible chat children**. This isolates historical branch work from transcript rendering.

## Frame/input/animation path

Dependency paths below are relative to `node_modules/@earendil-works/pi-tui/dist/`.

- `tui.js:563`: terminal input enters `handleTerminalInput`.
- **741–749:** focused editor input schedules an immediate frame.
- **624–675:** ordinary requests coalesce; animation rendering has a 16-ms minimum interval. Immediate input preempts that timer, but cannot interrupt synchronous frame work.
- `tui-alt-screen.js:1436–1447`: fullscreen rendering calls `renderLayoutFrame`; search refresh can request a second complete layout.
- `layout.js:275–291`: each frame creates a **fresh render cache**.
- **70–93:** scroll layout renders/measures the entire document before clipping.
- `tui.js:129–140`: ordinary Containers call every child and flatten every returned line.
- Fullscreen screen diff/output afterward is bounded by terminal height; expensive historical work has already happened.

Animations repeatedly trigger this path:

- Native loader: `components/loader.js:58–72`, default interval **80 ms**.
- Execute preview: `src/ui/execution-previews.ts:47–53`, **80 ms**.
- Live waveform: `src/live/extension.ts:621`, **80 ms**.

Thus an input-immediate scheduler cannot rescue a 150–400-ms synchronous frame.

## Dependency patch wiring

- `package.json` pins Pi coding-agent and pi-tui to **1.0.0**.
- `scripts/prepare-assets.ts:7–12` invokes `preparePiHost` **only for pi-coding-agent**.
- `scripts/pi-host-adaptation.ts:62–78` patches `chat-viewport.js` for compact editor sizing—not transcript performance.
- **84–109:** adaptations are version/hash guarded, idempotent, and validated before writes.
- Normal build/install runs asset preparation first. `scripts/build.ts` itself simply compiles the resulting dependency graph.
- There is **no existing pi-tui patch target** in this preparation path. A dependency-only manual edit would not be a reproducible fix.

The actual adapted chat viewport uses a normal Container document inside ScrollView; it is not virtualized.

## Economical reproduction

Retained probes:

```sh
bun /tmp/bruv-terminal-lag-real-01a104c7.ts
bun /tmp/bruv-terminal-lag-tasks-01a104c7.ts
bun /tmp/bruv-terminal-lag-history-01a104c7.ts
```

They require no provider, build, dependency installation, web terminal, or huge transcript capture. The real-component probe is the best first before/after comparison; the typed-row probe exposes ownership complexity separately.

## Fix/review priorities

1. **Compute ownership once per parent render/update**, with source-call and owner indexes. Do not rediscover the entire transcript separately for every child.
2. **Remove full `getBranch()` from unchanged animation/input frames.** Membership can be recomputed when journal position/content changes; avoid retaining historical bodies merely to cache it.
3. Preserve task deduplication, terminal-status precedence, execute labels, thrown-execute live ownership, failures, handoff/artifact warnings, and native detail expansion.
4. Verify updates with unchanged children: partial results, completed tasks, custom notices, labels and snapshots must invalidate appropriately.
5. Keep `/resume`, `/reload`, branch changes, disposal and regular-mode behavior correct. Existing `task-rows`, `rolling-activity`, and `conversation-density` tests cover important seams.
6. Add deterministic **work-count/scaling assertions**, not fragile millisecond thresholds.
7. Use the compiled-terminal acceptance guidance for final mouse/detail/scroll-anchor checks; source benchmarks are not visual acceptance.

**Other likely hotspots:** full-document flattening remains linear in components/lines; regular-screen `tui-main-screen.js:229–236,323–326` also renders and diffs the whole document; density wrappers copy returned arrays (`conversation-density.ts:400–435`). Markdown already has width/text caching. Bruv footer history already has a current-position cache (`footer.ts:82–113`), so blaming an unconditional footer scan would be inaccurate.

Relevant wisdom read included compiled-terminal acceptance, rolling-activity implementation, history SDK seam, and live-transcript viewport guidance. The history wisdom explicitly distinguishes bounded retained bodies from expensive full-demand APIs; activity repaint currently turns one such full-demand API into routine per-frame work.

Values stay the same. Existing guidance already calls for measured work, safe isolated changes, and real visible-frame checks.
