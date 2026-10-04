# Animated feature demos (in progress)

User's exact follow-up: "show the actual bruv ui mockup. animate it properly. show more of those. one per feature". f25fd18d was a deliberately stopped WIP content checkpoint, not an accepted final. Its product-story preview (39289) is stopped/superseded; do not restart it.

Main worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_db0abb27
Branch: feat/animated-feature-mockups
Demo worker: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_db0abb27-5442693331ce-task_9369c97e
Worker branch: bruv/bruv-source-backed-animated-demo-cells-9369c97e

## Contract

One scrolling Ghostty Web/WASM terminal. Every visible heading, UI glyph, panel, animation frame and playback control is a terminal cell. No screenshot/video overlay or terminal-themed DOM mockup. Three source-backed scripted Bruv sessions accompany three benefits: isolated delegated changes; background jobs while conversation continues; project wisdom across work sessions.

Each is labeled "Animated demo · scripted". Requests, assistant prose, outcomes and timing are illustrative, not a claim of a real model run or performance. No credentials, personal paths, model calls or private chats are used. Semantic HTML includes the same copy and full static demo transcripts.

## Playback

Stable-height panels; purposeful request typing, tool/job transitions, then readable final results. Play once on first meaningful visibility (at least eight panel rows), pause offscreen or document hidden, hold final state rather than looping. Each has Play/Pause and Replay controls with terminal-cell hit regions; Tab, Enter and Space operate playback, mouse and touch use measured cell coordinates. Reduced motion starts at the final static state, with explicit replay available. A single 80ms wakeup for visible active panels feeds the existing coalesced RAF and row-diff ANSI renderer; no per-panel perpetual timer. Font U+F460 is bundled as a tiny subset so the actual CompactEditor chevron works without a system Nerd Font.

## Source and verification

Pending final integration and visual review. Source references, evidence, command results, preview URL and remaining limitations will be added before commit.
