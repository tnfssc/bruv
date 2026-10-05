# Linked CI failures, 2026-10-05

## Finished

User sent daily dependency run 37321109544 (job 111800116876) and develop CI run 37297354419. Parent started at df6471cc. Fixes are committed locally on t3code/inspect-github-actions-run. Nothing was pushed; no hosted rerun, PR, macOS lane or release acceptance is claimed.

- e23e363d: question TUI fixture keeps its private tmux server alive across CLI reload. The failed child was the second tmux new-session, not Bruv. Killing the last session races automatic server shutdown. All UI assertions and budgets remain. Historical CI discarded tmux stderr; the lifecycle race reproduced locally on 3.6a, not locally built 3.4. See ../questions/linux-tmux-reload-ci.md.
- 0a029606: reviewed Pi 1.0.3 and rebased the coding-agent patch and exact host hashes. Keep fail-closed source, result and version checks. See ../dependencies/pi-1.0.3-root-host-audit.md.
- a89075aa: notice generation and saved-startup tests had stale Pi pins. Updated them to 1.0.3. Fetched upstream v1.0.3 LICENSE; it matched third_party/pi/LICENSE byte for byte. The generated bundle stays in ignored dist/release.
- 648403b3: long-thread fixture uses Ctrl+Home/Ctrl+End for transcript scrolling. Bare Home/End move the editor cursor with extended keys. All history and detail assertions remain. See ../tasks-ui/long-thread-detail-replay-2026-10-04.md.
- e767f8e3: ran the ordinary updater and included the remaining actual daily candidate. MCP SDK is 1.32.1; es-module-lexer is 3.0.3. Lockfile also updates @hono/node-server to 2.1.3 and hono to 4.13.13. See ../dependencies/daily-dependency-prs.md.

## Proof and limits

First combined gate exposed six stale-pin failures and the key mismatch: 1,952 passed, 30 skipped, seven failed. These failures were fixed, not hidden.

Combined repairs at 648403b3 passed shared Linux CI: 1,959 tests, 30 opt-in skips, zero failures, 35,555 assertions across 272 files. Frozen install, format, lint, typecheck, paired build, offline transport and paired standalone smoke passed. Log: /home/tnfssc/.bruv/ci-linked-failures-2026-10-05-final.log. Earlier failing log: /home/tnfssc/.bruv/ci-linked-failures-2026-10-05.log.

Actual remaining daily candidate a0a0e547 passed the same full gate in its worker checkout: 1,959 passed, 30 skipped, zero failed, plus paired smoke and notice generation. Parent integrated it as e767f8e3. Compared all source, tests, scripts, patches, package.json and bun.lock against the tested worker commit: identical. Reused that proof instead of repeating the full suite. Parent frozen install, preparation and notice generation passed after integration (211 packages; 657,015-byte notice bundle).

Still needs care: push/review and hosted CI on this branch. Paid providers, devices, macOS and release behavior were not checked. This proves the local actual dependency-update validation path, not hosted PR creation.

## Worker pickup

All worker paths remain under /home/tnfssc/.bruv/worktrees/:

- t3code-fcaffdf2-5442693331ce-task_571cd247, branch bruv/fix-linux-real-tui-questions-test-failur-571cd247, worker d0af3dd0.
- t3code-fcaffdf2-5442693331ce-task_51316c7a, branch bruv/review-and-upgrade-pi-1.0.3-host-seams-51316c7a, worker b7ba1c88.
- t3code-fcaffdf2-5442693331ce-task_570aade5, branch bruv/diagnose-pi-1.0.3-long-thread-home-navig-570aade5, worker 16887eec.
- t3code-fcaffdf2-5442693331ce-task_a6dbea72, branch bruv/validate-remaining-daily-dependency-cand-a6dbea72, worker a0a0e547. Full gate logs are in its artifacts/ci.
- Earlier task_68f015e9 made no changes and was stopped after a tool-call parse error and no further tool progress. Its clean worktree remains at t3code-fcaffdf2-5442693331ce-task_68f015e9.

Values unchanged. Existing checked dependency behavior, shipped-path proof and honest scope rules cover these findings. No new general rule was needed.

## Push, merge and release request

User then asked: push, make PR, merge, release. Branch pushed and PR https://github.com/tnfssc/bruv/pull/34 opened against develop and linked to this thread. T3 watches it. CodeRabbit posted only an opt-in notice, no findings. Hosted CI 37333558132: macOS passed; Linux failed only saved-startup empty-stopped at fixture until(grammars:ready). The fixture uses 100 setImmediate turns; imports did not finish before that count. Worker task_189c5d2c owns a completion-based wait fix in /home/tnfssc/.bruv/worktrees/t3code-fcaffdf2-5442693331ce-task_189c5d2c, branch bruv/fix-hosted-saved-startup-fixture-complet-189c5d2c. Parent must integrate/push its commit, await hosted checks, inspect readiness, merge, then dispatch release.yml on develop. Manual workflow prepares the next patch release itself (current latest v0.16.7), and publishes only after release gates. Do not download binaries just to recheck CI hashes; check publication and asset presence per ../releases/release-verification-preference.md. Nothing merged or released yet.
