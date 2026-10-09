# Browser voice and visual polish

Active integration worktree: /home/tnfssc/.bruv/worktrees/bruv-web-live-polish. Branch: bruv/web-live-polish. Base: bruv/web-workspace-design (PR67).

User approved compact design. Requested next: /live acquires the issuing browser's microphone without a manual toggle, pure-black Vesper theme, and bundled Nerd Font. Keep viewer navigation independent and the UI quiet. Use Bun embedded assets, not another frontend runtime.

## Pieces

- Vesper: worker bruv/web-vesper-theme, e8b9a9c8; integrated as b2bebaee. Parent viewed populated desktop and ANSI desktop screenshots. Source and test facts in vesper-theme.md.
- Command-driven mic: task_021035a9, branch bruv/web-live-command-microphone, worktree /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_021035a9. Still running. Its wisdom/web/agent-workspace-direction.md is a parent-written brief with later agent/worktree/presence direction; include it in delivery, not implementation scope.
- Bundled font: task_1a389c2a, branch bruv/web-nerd-font, worktree /home/tnfssc/.bruv/worktrees/t3-6f8b2e16-5442693331ce-task_1a389c2a. Completed as 73fae899; integrated as a66c5b52. Full regular JetBrainsMono Nerd Font Mono, WOFF2 1,083,072 bytes; worker measured binary delta +1,085,440 bytes. Parent viewed desktop and phone glyph/width fixture screenshots. Combined theme/font check and build task_285492dc now running.

## Next

Integrate completed commits here. Preserve Vesper xterm colors and web-only CLI theme setup when merging audio and font changes. Run combined build, focused suites, actual two-browser command-driven mic proof and desktop/phone visual review. Include exact bundled font size and license facts. No combined delivery or proof yet. Do not edit completed worker worktrees.

Values already require real user-path tests, actual visual inspection, clear ownership, and durable handoffs. No new value for this integration.

Combined Vesper/font build and typecheck passed. 43 focused tests passed (421 assertions). Integration needed one async harness fix: Vesper browser test must await font-ready setup. Next run actual combined Chromium font/theme probes, then integrate command-driven mic.
