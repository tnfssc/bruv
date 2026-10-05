# Linked CI failures, 2026-10-05

## Work in progress

User sent two failing runs. Parent checkout starts at df6471cc (develop's merged dependency PR).

- Daily dependency run 37321109544, job 111800116876: candidate Pi 1.0.3 fails scripts/pi-host-adaptation.ts's exact 1.0.0 version check before typecheck. Review upstream and adapt; do not bypass the guard.
- CI run 37297354419: Linux fails only real TUI keeps questions near composer after progress, cancellation and reload (subprocess exit 1, expected 0). macOS passed. Need actual child error before calling it a flake.

## Owners and pickup

- Pi repair: task_51316c7a. Worktree /home/tnfssc/.bruv/worktrees/t3code-fcaffdf2-5442693331ce-task_51316c7a. Branch bruv/review-and-upgrade-pi-1.0.3-host-seams-51316c7a. Earlier task_68f015e9 made no changes and was stopped after 18 minutes without tools following a parse error. Its clean worktree remains at /home/tnfssc/.bruv/worktrees/t3code-fcaffdf2-5442693331ce-task_68f015e9.
- TUI repair: task_571cd247. Worktree /home/tnfssc/.bruv/worktrees/t3code-fcaffdf2-5442693331ce-task_571cd247. Branch bruv/fix-linux-real-tui-questions-test-failur-571cd247. Worker will commit code and feature wisdom.
- Parent reviews and integrates both commits, then checks the combined result.

Both worktree setup commands passed frozen install and asset preparation. Local tool versions: Bun 1.4.2. pnpm not on parent PATH yet. CI uses shared scripts/ci.sh and requires tmux. TUI repair is reviewed and integrated as e23e363d (worker d0af3dd0). Failure was the second tmux new-session, not the CLI exit. The fixture now keeps its private server alive across CLI reload and retains stderr in assertions. Original assertions and budgets remain. Worker shared Linux gate passed 1,959 tests, 30 skips, zero failures, plus paired smoke on Bash, tmux 3.4 and four CPUs. See ../questions/linux-tmux-reload-ci.md for reproduced lifecycle race and limits. Pi repair is still running. Combined validation comes after it.

Values unchanged so far. Existing proof and confidence rules already cover this work.

Pi repair integrated as 0a029606 (worker b7ba1c88). Parent fixed attribution and saved-startup pins found by full CI. See ../dependencies/pi-1.0.3-root-host-audit.md. Current blocker: long-thread Home navigation; worker task_570aade5 owns diagnosis. Shared CI log: /home/tnfssc/.bruv/ci-linked-failures-2026-10-05.log. First gate passed 1,952 tests, skipped 30, failed seven; six stale-pin failures are fixed and focused checks pass. The Home failure still reproduces.

Navigation diagnosis: Pi 1.0.3 uses Ctrl+Home/Ctrl+End for transcript scrolling. Bare Home/End move the editor cursor with tmux extended keys. Worker 16887eec corrected the fixture keys; all history/detail assertions remain. Integrated as 648403b3. Focused check: one test, 1,049 assertions passed. Worker path /home/tnfssc/.bruv/worktrees/t3code-fcaffdf2-5442693331ce-task_570aade5 is clean. Final combined Linux gate is task_ca703c2e; log /home/tnfssc/.bruv/ci-linked-failures-2026-10-05-final.log. Wait for completion, then record results.

Final combined Linux gate at 648403b3 passed: 1,959 tests, 30 opt-in skips, zero failures, 35,555 assertions across 272 files (73.56s root suite). Frozen install, format, lint, typecheck, paired build, offline transport and paired standalone smoke all passed. No hosted, macOS, paid-provider, device or release acceptance claimed.

The daily run also had MCP SDK 1.32.1 and es-module-lexer 3.0.3 changes. They are not in the Pi-only fix yet. Worker task_a6dbea72 now runs the real update script and validates that remaining candidate in /home/tnfssc/.bruv/worktrees/t3code-fcaffdf2-5442693331ce-task_a6dbea72, branch bruv/validate-remaining-daily-dependency-cand-a6dbea72. Parent integrates only after proof.
