# Animated feature demos: approved design, focused polish

The user approved checkpoint 9d2a44b4's visual design. Their follow-up requests less repeated copy, no permanent playback rows, looping demos and animation in text.html. Keep the continuous Ghostty page, Vesper, faithful per-feature UI and coalesced scrolling. Do not restart old previews (including 35203).

Current worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_0f2604c1
Branch: feat/landing-copy-loop-polish
HTML worker: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_0f2604c1-5442693331ce-task_fa49bfa4
Worker branch: bruv/animate-semantic-html-feature-demos-fa49bfa4

## Contract and provenance

One scrolling Ghostty Web/WASM terminal. Every main-page heading, panel, UI glyph, animation frame and control remains a terminal cell. No DOM imitation or screenshot plane. The three scripted conversations demonstrate worktree delegation, conversation during background jobs, and explicit reuse of wisdom files. One shared note directly above the group identifies all demos as scripted, not recorded model runs.

Requests, dialogue, outcomes, timing and footer values are illustrative. Source UI references are listed in site/demos.ts; existing CLI reference captures remain unchanged. No paid calls, credentials, private chats or new real-model evidence. The bundled U+F460 font subset preserves Bruv's editor prompt. Product themes are configurable; the page retains Vesper and source-colored demo cells.

## Copy

Read the full saved anti-slop-writing SKILL.md and doctrine. See [concrete before/after review](writing-sources/polish-review.md). Removed the hero category eyebrow, three numbered category labels, repeated demo disclaimers and stage captions. Retained one useful feature heading, short mechanism-grounded explanation, install/provider/platform instructions and Install/Source links. Dialogue now lets the next user turn demonstrate concurrency instead of announcing it twice.

## Playback

Shared playback.ts loops after each script plus a 6-second final hold (the final outcome already starts roughly two seconds before script end). demoFrame clamps to one stable final frame throughout the hold. Panel geometry is stable through typing, tool progress, completion and reset. Visible active panels share one 80ms clock; main-page changes still flow through one coalesced RAF and row-diff ANSI writes. Offscreen and document-hidden demos consume no playback time.

Terminal: no Play/Pause/Replay rows or progress captions. Hover a panel or Tab to its playback region to reveal a small border control. Clicking/tapping the panel toggles pause/play; Space or Enter does the same when focused. The shared instruction explains this before the demos. HTML remains reachable by the footer, A/Escape and the ordinary focusable alternate link. Focus can leave the terminal. Reduced motion shows final static states until explicit opt-in; changing the preference also stops current motion at its final state.

HTML: semantic content and complete transcripts ship in the document for crawlers, assistive tech and no-JS. Local JS enhances the panels with pre/span UI cells from the same demoFrame and shared timing. No Ghostty/canvas, GIF/video assets, runtime CDN or backend. This avoids blurry animated text and parallel asset generation. Hover/focus reveals one pause control; touch has a reachable control. It keeps static final UI with reduced motion and a full no-JS transcript.

## Verification

Focused test output is ephemeral under ignored `artifacts/landing-page/polish/`; durable conclusions remain here. See polish-checkpoint.md for final commands and remaining limits. No merge/deploy is authorized. Values unchanged: the existing values already require the requested mechanism, source-backed evidence, simple shared ownership and an inspectable handoff.
