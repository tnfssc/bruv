# Long-thread full-frame latency follow-up

## Current handoff

This is a draft, not a finished latency fix. Runtime commit e5fd9a7d builds both v0.16.0 binaries. The 100-turn gate passes. At 1,000 turns, idle typing and animation pass, but the first held-response input takes 482 ms and fails the 100 ms gate. Do not remove that sample or call the gate green.

Integration: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_43fd9f57, branch fix/long-thread-full-frame-latency. Develop advanced during the work; public v0.16.0 at 3eec281b was merged as 271e27a4. No unpublished rolling feature commit was imported. All implementation workers finished. No release or installation was performed.

Task task_87e7c1d4 completed one actual compiled profile, with no production edits. Its first held echo was 162 ms, still failing. Cold rolling membership materialization contributed about 53 ms; later native child/layout rendering about 86 ms inclusive. This proves a contributor in that run, NOT the exact cause of the original 482 ms event. Request cloning mostly preceded the input; no GC or footer stall was proven. See [the full profile report](../history/compiled-first-held-profile-2026-10-04.md). Next proposal: incrementally update append-only membership instead of rereading its entire historical prefix. That is not implemented.

## Built-app evidence

[Raw results](full-frame-latency-results.json) preserve every sample, binary hashes, host load, setup times and retained-frame paths. The baseline is the checksum-verified official v0.16.0 pair, kept privately under artifacts/latency/baseline-v0.16.0. The candidate SHA256 is 6b6960c1632298ec97e260b54b46ffeae82b2f9697b047b0deba7b45a793e320.

| Entries | Binary | Idle p95 | Held median / p95 | Spinner changes / 5 s | Gap p95 |
| --- | --- | --- | --- | --- | --- |
| 1,201 | release | 162 ms | 144 / 250 ms | 60 | 108 ms |
| 1,201 | candidate | 28 ms | 27 / 51 ms | 61 | 108 ms |
| 12,001 | release | 4,302 ms | 2,399 / 3,700 ms | 3 | 1,814 ms |
| 12,001 | candidate | 75 ms | 72 / 482 ms | 56 | 107 ms |

The large candidate's other eleven held-input samples are 48–97 ms. That is progress, not permission to discard the first sample. Request setup also takes about 2.5 seconds, reported separately.

The fixture has 1.54 MB at 100 turns and 15.43 MB at 1,000 turns, with saved prose and five execute/result pairs per turn. Both phases use 12 literal-key samples. The provider consumes the request and holds its response until measurement ends. Echo polling sleeps 20 ms; spinner polling sleeps 50 ms. These are observed terminal times/cadence, not exact hardware timestamps or FPS. See [harness notes](long-thread-pty-latency.md).

Thresholds stay echo p95 ≤100 ms, spinner-gap p95 ≤140 ms, and ≥45 transitions in five seconds. Request preparation gets 30 seconds so the large fixture can reach the measured phase. This changed a setup timeout, not those three gates.

Checks: 259 tests across 20 focused files pass, including isolated SDK subprocesses. TypeScript and the official paired build pass. Five compiled terminal-flow tests pass: previews, long-thread navigation/details, both editor modes and cache UI. The large latency gate still fails. [An earlier failed checkpoint](full-frame-latency-checkpoint.json) is retained, not final acceptance evidence.

## What changed and why

PR #25 removed real task-row loops but tested too narrow a path. The user installed it and still saw lag. Full CLI profiles found more work below the visible editor:

- SDK getContextUsage rebuilt a disk projection and branch every repaint. Required projections now seed only numeric usage. Live routed limits derive window/percent on read. A guarded single-user append uses SDK estimateTokens; other context changes use the canonical projection.
- The outer shake wrapper separately reread bodies. Its freshness boolean now keys on assistant/structural position. Invalid markers still fail closed. User/tool/cache bookkeeping cannot make stale usage fresh.
- Cache observations invalidated accounting without changing model-visible content. Semantic metadata positions ignore them. Footer totals still notice usage-bearing records across all branches, compaction attempts, fast markers and voice cost.
- Compaction and fast-setting hooks read whole branches to find a few records. [Indexed selectors](request-setup-metadata-selection.md) preserve context/branch rules and materialize only candidates. Invalid/incompatible opaque checkpoints still block even on unsupported providers.
- Settled execute previews reformatted rows, and their native Box shell repeated width/padding work. Both retain one width. The native cache covers completed execute tools without protocol images. updateDisplay clears it. Partial tools, images, live task overlays, expansion, mouse, theme and resize stay live.
- Pi loaded remaining grammars after saved transcript paint, then invalidated and rebuilt it. A tracked Bun patch starts grammar loading after editor mounting, awaits it before saved transcript paint, and skips only that redundant saved-session completion invalidation. Empty sessions stay lazy.
- Public v0.16.0 rolling activity called getBranch every frame. Its current ID membership Map now uses a weak semantic metadata revision including ACTIVITY_BOUNDARY. Bookkeeping/tool-result appends do not reload bodies. Live grouping still syncs every frame; rewrites/rereads replace metadata identities. A new relevant entry still causes a cold prefix read: this is the remaining measured contributor.

No history is truncated. Caches retain numbers, string IDs or one-width rows, not extra projections or per-leaf histories. A periodic context-cache TTL was rejected because it would periodically restore the stall.

## SDK and packaging assumptions

Pi stays pinned at 1.0.0. Its native estimator uses branch type/id for compaction and usage positions, so it gets the required projection plus temporary metadata skeletons. Tokens are independent of model window in this version. Upgrades must revisit both facts.

Disk history installs before the outer shake adapter in CLI and connector startup. Tests that mutate these global prototypes run in child processes. Inheriting another test's prior wrapper is not the production order. The native shell cache relies on ToolExecutionComponent.updateDisplay and sits below density/task/rolling overlays.

The grammar patch assumes saved messages are in session.state.messages at UI mount. Tests execute the actual patched SDK init and real grammar loader, including Elixir highlighting, typing during startup, empty sessions and startup errors. Existing invalidation tests cover theme/content/resize.

After checkout or cherry-pick, run bun install --frozen-lockfile to apply the tracked patch, then bun run build. The official build now makes a pair; the old web-payload reuse path no longer applies. Local Bun: /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun.

## Durable worktrees

The integration branch has the selected changes. These worktrees remain for provenance; the old periodic-cache proposal was not integrated unchanged. No child task is still running.

- /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_fa6de4df — fix/long-thread-render-tail
- /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_43fd9f57 — fix/long-thread-full-frame-latency
- /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_83b8ecf8 — fix/footer-context-repaint-latency
- /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_39ecf1c9 — test/long-thread-measured-latency
- /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_beb52913 — fix/context-projection-accounting-reuse
- /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_e17b18f2 — fix/large-thread-frame-scaling
- /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_c92d3d57 — fix/request-hook-history-scans
- /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_078fc82d — fix/saved-thread-grammar-readiness
- /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_2239a5c5 — fix/rolling-membership-frame-reads

The old unpublished fix/long-thread-local-feature branch remains separate. Read-only source reviews found no concrete blocker, but did not establish timing acceptance.

## Next step and lesson

Keep the PR draft while the large gate fails. If continuing, make only a fix supported by the compiled trace, rebuild, and rerun the same gates. Do not rerun until lucky or stop unrelated processes to improve timings.

The existing proof value was strengthened to require built-app input and animation measurements on realistic saved threads. No new value was needed: bounded ownership and honest acceptance cover the other lessons.
