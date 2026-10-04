# Compiled saved-thread detail proof — 2026-10-04

## Findings

The parent full-CI frame and this checkout's isolated baseline agree: expansion remains anchored at turn 93, while the test waits for turn 99 without pressing End. [Baseline failure](baseline-failure.txt) shows actual turn-93 results and the jump-to-latest hint. This was a viewport assumption, not lost results or upstream task-row ownership corruption.

A separate measured production issue was quadratic activity group/child lookup: [scaling failure](scaling-before.txt) records 501,500 child reads for N=1,000. The new identity index bounds sync at 2N reads and collapsed projection/member work at 8N without caching old task/result bodies or disabling grouping.

## Build and checks

Base checkout: 08ad5558b28c689893b8f3831d5b6bd5ad73f563 + the code/test changes committed with this report. Bun 1.4.2 (744846f84); TMPDIR=/var/tmp. Frozen lockfile install local to this checkout.


```sh
env PATH="$HOME/.local/share/mise/installs/bun/1.4.2/bin:$PATH" TMPDIR=/var/tmp bun run build

env PATH="$HOME/.local/share/mise/installs/bun/1.4.2/bin:$PATH" TMPDIR=/var/tmp bun test tests/long-thread-tui.test.ts tests/task-rows.test.ts tests/rolling-activity.test.ts
```

Fresh normal + connector pair build succeeded, without bundled T3. [Final isolated repeat](isolated-results.txt): **47 pass, 0 fail, 1,230 assertions**. [Expanded focused suite](focused-results.txt), also covering conversation density and both source/compiled execution previews: **106 pass, 0 fail, 1,600 assertions**. Focused Biome check and bun run check passed. An intermediate reopen test exposed tmux's last-session teardown race; respawn-pane now replaces the actual CLI process without restarting its terminal server, and the final replay passed twice.

Final isolated replay pair SHA-256:

- dist/bruv: 9f58c179c36b7d50e3cfd83bdc6d937be1560c1d57fb9903f0353f3b3cb425a3
- dist/bruv-claude-compat: c10211c5dbdeb47b0d8f93876ce8b6c6581f5c808957e678af7c3adb0a397552

These identify the proof build, not parent release assets. CLI terminal replay is against the normal binary; connector build success is not a new connector functional-acceptance claim. Native connector source and upstream sdk-task-rows were untouched.

## Frame review

[Actual frames](compiled-frames.txt) retain:

- fullscreen loaded/oldest history; grouped collapsed headers;
- expanded-anchor turn 93 output, followed by End showing the standalone DETAIL_saved-99-9 result;
- collapsed group with no detail, 48-column resize and retained draft;
- fresh process reopen, expanded oldest DETAIL_saved-0-0 and latest DETAIL_saved-99-9 results, then collapse;
- ordinary --tui-mode regular labels, full latest result and recollapsed labels, with no group projection.

Tests additionally verify all 2,101 persisted messages and the exact 1,000 original result bodies remain after these operations. The original last-detail and individual-label assertions remain; the label belongs to ordinary-mode replay rather than hidden fullscreen group members. Standalone-result-row assertions exclude a false positive from the same marker in source code.

No paid calls, submitted prompts, blanket sleep/deadline increase, grouping removal, global installs, release/version edits, or native connector changes. All owned tmux servers and temporary homes were cleaned. Full CI and final 0.16.0 assets remain parent-owned after integration.
