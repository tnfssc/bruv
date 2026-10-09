# Browser voice and visual polish

Active integration worktree: /home/tnfssc/.bruv/worktrees/bruv-web-live-polish. Branch: bruv/web-live-polish. Base: bruv/web-workspace-design (PR67).

User approved compact design. Requested next: /live acquires the issuing browser's microphone without a manual toggle, pure-black Vesper theme, and bundled Nerd Font. Keep viewer navigation independent and the UI quiet. Use Bun embedded assets, not another frontend runtime.

## Pieces

- Vesper e8b9a9c8 integrated as b2bebaee. Worker: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_b3b833b2, bruv/web-vesper-theme. Sources and per-run TUI behavior: vesper-theme.md.
- Font 73fae899 integrated as a66c5b52. Worker: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_1a389c2a, bruv/web-nerd-font. Full regular JetBrainsMono Nerd Font Mono, WOFF2 1,083,072 bytes; isolated binary delta +1,085,440 bytes. Licenses retained. Details: browser-terminal-font.md.
- Audio acf21d87, 541932f7, 294f47af integrated as b8e565e6, a5cf0dfd, f178f7f4. Worker: /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_021035a9, bruv/web-live-command-microphone. Ownership and proof limits: live-command-microphone.md. Includes parent-written agent-workspace-direction.md (later worktree/agent tabs, people/presence, and attention constraints; not implemented here).

## Integration findings

Font startup makes the browser harness async. Retained the audio request tests and awaited font readiness; retained Vesper palette assertions.

The packaging preparation fixture needed the font and font CSS inputs and its expected asset list updated. First combined suite: 672 passed, 4 skipped, 1 failed on that stale fixture. Updated fixture plus browser suite: 13 passed. No product fallback or weakened assertion.

Parent visual review caught that mic-button removal accidentally narrowed the generic tooltip style to active voice only. This exposed Connected as permanent toolbar text. Restored the generic tooltip rule and added Chromium checks for hidden idle detail and visible keyboard-focus detail. Kept the passive voice label only while voice exists.

The design fixture had printed fake ready/check labels inside terminal output. Replaced that with a real uname -s invocation. Functional ownership checks live in dedicated probes, not decorative screenshot text.

## Final proof

- Final combined typecheck/build passed. Regression: 673 passed, 4 skipped, 0 failures, 24,814 assertions across 79 files. Skips cover paid providers and one optional diagnostic.
- Theme/font combined: 43 focused tests passed, plus actual Chromium font and palette probes.
- All five combined Chromium scripts passed: terminal smoke, multiplayer, workspace lifecycle, audio probe, design. Fake-provider normal /live captured only in the issuing browser; stop/retry, injected denial/provider error cleanup, and coding PID survival passed. No autoplay override or manual mic click.
- Same-browser tabs use the multiplayer script with BRUV_BROWSER_SHARED_CONTEXT=1. Passed shared terminal input/output, workspace synchronization, independent selection, reload, observer-safe voice and handoff. Default probe still uses two independent contexts.
- Parent viewed combined desktop/phone and active-owner phone images, caught the tooltip issue, then viewed corrected desktop, phone and drawer captures. Final design probe passed focus, cancel, drawer, long-name and empty-state checks; 624px terminal height at 390×680.
- Independent review task_4b1f4ad6 approved with no concrete blockers; 19 focused checks passed (195 assertions).

Logs: artifacts/web-polish/. Screenshots: artifacts/workspace-design/ and artifacts/web-multiplayer-*.png. Terminal font and palette fixtures: artifacts/font/ and artifacts/vesper-theme/.

## Delivery

This branch is the combined draft on top of PR67. Parent owns push/PR and screenshot attachments. No merge or install requested. No physical microphone/speech, real permission prompt, paid-provider, Safari/iOS or full-repository-suite proof.

Values already require real user-path tests, actual visual inspection, clear ownership, and durable handoffs. No new value for this integration.
