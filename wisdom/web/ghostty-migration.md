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

## Combined integration

Worker commit 029c2249 is integrated as b82058ce after develop merge ac77ceec and backend lint cleanup c73794c3. No cherry-pick conflicts. Frozen install and typecheck pass. Parent inspected the final worker populated desktop and phone captures: actual CLI output paints on both. Earlier startup and rename probe failures were cleared in the worker final gate; see ghostty-renderer.md for exact proof and limits.

Combined build/regression is task_851d0419. Strict lint still has 63 warnings; task_40ba090e owns cleanup in /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_40ba090e, branch bruv/ghostty-strict-lint, base b82058ce. Integrate its commit, rerun compiled browser checks against the final combined build, and inspect new captures before publishing only to PR64. No new PR, merge to develop, or install. Values unchanged: existing ownership, evidence and dependency-preservation guidance covers this work.

Combined b82058ce gate: build passed; 841 tests passed, four existing paid-provider/diagnostic skips, zero failures across 88 files. Compiled workspace design, Ghostty lifecycle/replay/AX, SGR mouse, multiplayer and fake-audio probes passed (task_b3de9509). Parent viewed fresh artifacts/ghostty/workspace-design/populated-desktop.png, populated-phone.png and lifecycle/replay-gap-desktop.png. Real CLI output paints; lost-view notice keeps original work alive. Fake audio made zero provider calls; no audible-speech claim. Logs are under artifacts/integration/. Remaining gate is lint worker integration and final changed-file verification, then PR64 hosted CI.

## Final local gate

Strict-lint commit 78d4c8af is integrated as 4f2fad30. Parent reviewed the DOM guards, narrowing and CSS cascade changes. Ghostty patch is unchanged. Final check, build, strict lint (zero warnings; 216 infos), format and diff checks pass. Final regression: 841 pass, four existing skips, 25,928 assertions across 88 files. Final compiled asset, workspace-design, lifecycle/replay/AX, mouse, multiplayer and fake-audio probes pass. Parent inspected the rebuilt desktop and phone rename captures; text paints and the rename field shows its full draft.

Final binary is 94,344,672 bytes, SHA-256 e13d9d32a15567ae16ab39909be4d261163ef3492482ec3376ebba3ae76638e3. Browser JS is 108,026 bytes. Embedded WASM is 423,045 bytes, one raw copy and no base64 copy. Source-free asset proof passes with GET 200, HEAD 405 and wrong Host 403. Evidence: artifacts/integration/final-*.log and artifacts/ghostty/packaging.json.

Latest fetched develop is a989356d and is included. Publish this tree to bruv/web-workspaces-tabs, PR64 only; hosted CI is the next gate. No merge into develop or CLI install. No physical-device, audible-speech or real screen-reader UX claim. Mouse encodings 1005/1015/1016 remain unsupported. Values unchanged: existing dependency-preservation and honest-proof rules cover the decisions.
