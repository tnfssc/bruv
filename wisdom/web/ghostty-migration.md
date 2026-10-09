# Ghostty renderer migration

User asked why the browser uses xterm instead of the site's dependencies. Site uses ghostty-web 0.4.0. Reuse that renderer if it preserves the real terminal product. Keep the compact daisyUI chrome and server/voice ownership; do not copy the site's scripted, disabled-input path.

Parent integration tree: /home/tnfssc/.bruv/worktrees/bruv-web-ghostty-integration, branch bruv/web-ghostty-integration, base 58427903. Finished prior trees are read-only. User wants PR64 as the only review target. No publication, merge or install has happened for this task.

Compatibility task_f9bced5d finished in /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_f9bced5d, branch bruv/web-ghostty-check. Read wisdom/web/ghostty-040-compatibility-spike.md there. Real PTY keyboard/paste, two-browser sharing, resize, alternate screen and reconnect replay passed. It was a raw-mode fixture, not the full Bruv CLI. Probe-only WASM routing and narrow CSP changes were needed. No production changes.

Implementation task_72bfd83e owns /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_72bfd83e, branch bruv/web-ghostty-renderer. Close accessible-output, leaked document/host listeners, canceled-touch focus and binary-input gaps. Embed WASM with exact Host checks and only wasm-unsafe-eval. Avoid a permanent dual-renderer abstraction or global listener monkeypatches. Return a concrete blocker if a disproportionate fork is needed; do not quietly lose behavior.

Next: review its commits and compiled real-CLI proof, integrate, run the final gate and inspect actual renders. Existing values cover ownership and honest shipped-path evidence. Reassess at handoff; no new value yet.

## Ten-minute implementation checkpoint

Worker is active. The real Bruv fullscreen path needs SGR mouse tracking. Stock Ghostty0.4.0 emits arrow keys for alternate-screen wheel input and does not report mouse click/motion; the earlier raw PTY proof did not establish that parity. Treat this as a release blocker, not an acceptable silent input change. Worker is adding a narrow mode-aware package patch and binary-input proof. Core mouse semantics, native selection/Shift override and disableStdin must be checked before acceptance.

Current patch also removes embedded default WASM and repairs cleanup. Its raw diff is about1.29MB because compiled ESM/CJS contain huge base64/minified lines; do not call raw diff size an estimate of handwritten code. Review the actual patch surface, bundle cost and reproducible install after handoff. No parent source edits or publication yet.

At twenty minutes, parent viewed worker artifacts/ghostty/web-terminal-wide.png and web-terminal-narrow.png. Both show actual Bruv CLI input/output rendered by Ghostty; this is no longer only the raw PTY spike. Full integration gates are still in progress, with some intermediate failure captures present. Do not infer acceptance from those two images. Independent read-only safety reviewer task_15abc586 is checking source/patch ownership, WASM/CSP, mouse/binary input, touch, cleanup, accessible output and packaging. Source is moving; reconcile findings against final hashes.

Independent reviewer task_15abc586 returned no blocking findings for its snapshot: exact Host/GET WASM route, narrow CSP, server-owned sizing/replay, patched mouse/binary input and cleanup, touch ownership/focus, and bounded active-pane accessible output. It ran49 tests across5 files successfully. Reviewed SHA-256 prefixes/suffixes: package2e76f78e…56f757f6; lockc93dc9e4…7755682c; patchb50b3262…284dac78; serverf8b526ea…290c69b6; assets266f0a10…eefd88aac; browser8fd173f9…37131bec; touch980cfb48…a292b1f0; accessibility88dfb7da…472554aa; asset builder2f449595…5d3f5bb. These are snapshot findings, not a blanket approval of later changes. Compare final files before integration.

Thirty-minute checkpoint: compiled multiplayer, SGR mouse and lifecycle logs report successful proof. Recovery design also exited0. Do not accept the migration yet: the inspected workspace-design-fresh.log still failed to reach the rename editor, and workspaces-smoke-final.log still timed out at initial connection. These may predate later worker fixes; require a final handoff with exact source/patch/build hashes and passing updated runs. Current patch hash reported by worker is e29bfb5d8127eeff987c78a5e7c72ee82884a3e65ee424e22d245f49f6b814eb, not the earlier independent review snapshot. No parent source edits or publication.
