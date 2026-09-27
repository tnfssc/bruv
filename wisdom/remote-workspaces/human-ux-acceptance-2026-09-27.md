# Normal CLI remote human path (2026-09-27)

## What was missing

The released remote command had explicit/RPC operations, not a human inbox or argument completions. Passing a native answer through RPC did not prove the normal terminal interaction. /questions is the current parent conversation/native question inbox; /remote owns SSH remote task questions. The local/native menu audit found no production regression, and its compiled PTY tests now explicitly assert the visible completion menu and the tail of a selected long choice.

## Integrated behavior

- No-argument /remote opens the shared searchable picker, with pending questions first and task prompts/state, connection, launch, refresh, and task actions. Cached transcripts remain readable without SSH. Commands and RPC remain available.
- Question choices/custom editor use fresh sync before opening and before submission, then bind the displayed owner/version. Escape never sends an answer, connects a partly entered host, or requests cancellation. Raw selected choice text is retained, not trimmed into a different choice.
- A saved uncertain reply stays visible and can reconcile only its saved text/owner/version/reply ID after human confirmation. It is not offered as a new pending question. Known failed-sync and foreign-owner answer/cancel actions are unavailable; retry sync remains an explicit recovery action.
- Polling skips the picker and discards late notices while it is open. Transcript viewing exits the menu so it does not cover what the user asked to read.
- Shared picker text is height-bounded, with PgUp/PgDn to reach long question/choice text and selection preserved through resize. Wide screens devote more space to labels rather than imposing the old 30-column maximum.

## Isolation and reproducibility

The Docker/SSH fixture creates its own HOME, agent config, SSH key, known-host pin, container and native question ledgers. Its provider is deterministic/fake. The harness unsets inherited DIE_SUBAGENT_DEPTH, DIE_SUBAGENT_TYPE and DIE_REMOTE_RUNTIME_STATE so the tested terminal is actually a normal human parent CLI. RPC seeds disposable tasks and independently changes a disposable question to test stale rejection; choice/free-text/cancel operations use real keystrokes in the compiled CLI. No real user question, remote host or provider was mutated.

Build uses absolute Bun 1.4.2 at /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun. Mise rejects untrusted worktree config, and the clean web fetch is blocked by the user's Git HTTPS-to-SSH rewrite/key failure. The final CLI is compiled from this worktree, with the real existing web runtime copied from /home/tnfssc/Code/die/dist/die-web via scripts/build.ts --reuse-web, not a placeholder and not an installed artifact. This is Linux loopback CLI evidence, not a fresh web build, external provider or Mac validation. Nothing was pushed, released or installed.

Run with an explicit PATH including Bun, docker, tmux and system tools:

	/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun scripts/build.ts --reuse-web
	DIE_REMOTE_E2E=1 DIE_REMOTE_PTY_E2E=1 bun test tests/remote-e2e.test.ts

Optional DIE_REMOTE_PTY_ARTIFACTS points to an absolute directory for plain terminal frames. Parent artifacts are in .cache/remote-ux-evidence (ignored). Final results and hashes are below.

## Worktrees retained

Parent integration: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_b42aa24e, branch die/make-remote-questions-and-commands-human-b42aa24e.
All child paths share that prefix followed by -a86675007a5e-:

- task_b06d31d1, branch die/remote-interactive-human-ux-b06d31d1: menu/completion implementation, 75d3579 integrated as d9fd818; parent hardened Escape, offline ownership and uncertain-reply recovery.
- task_60d187ca, branch die/compiled-remote-cli-pty-acceptance-60d187ca: PTY fixture, 52c4be5 integrated as 03b5d49; parent completed real menu sequencing/assertions and extended coverage.
- task_416c7232, branch die/audit-local-native-questions-ux-416c7232: audit, e7074c5 integrated as 4664a7c. Its placeholder-web worker build is superseded by parent compiled checks with real web assets.
- task_772273d4, branch die/complete-bounded-shared-picker-with-test-772273d4: tested viewport, c217bce integrated as 1c0053b. Parent chose this over remote worker's one-line truncation.
- task_a2005962, branch die/bounded-shared-question-picker-long-text-a2005962: rejected incomplete 40b53d1; NOT integrated. Missing tests and unsafe slicing were not acceptance evidence.

Values unchanged: existing #1 (complete built human path), #2 (precise proof), #4 (uncertain identity), #5 (bounded rendering) and #8 (rendered truth) already state the lesson. This work adds the missing acceptance gate, not a new principle.

## Final parent acceptance

Passed on the integrated compiled source: strict TypeScript --noEmit, then **89 tests / 21 files / 669 assertions, zero failures or skips** (120.44s). This includes the original Docker SSH RPC workflow (68.84s), actual normal CLI PTY workflow (44.52s), local/native /questions compiled PTYs, client ownership/retry tests, and shared picker resize/paging tests.

The PTY gate checks no-args menu/search, selectable choice and free-text submission on native questions, discarded draft and menu Escape, 50-column choice tail, visible subcommand/task/question completion followed by Tab expansion, task cancellation confirmation and cancellation Escape, stale external answer rejection, an unchanged picker across the 5-second poll boundary, unavailable offline answer actions and cached transcript reading. The disposable owner is stopped for the offline case. It checks no local user question ledger was created. Eleven plain terminal frames plus build/acceptance logs are retained under the parent's .cache/remote-ux-evidence.

- CLI SHA256: e5c076bb8f4cd42810b19ad557520e926b6f96d9b1f0da13bf4b87f032f89ba5
- Real reused web archive SHA256: 7686d28f46c1731ace8eab80dee6fdea0e9e2c0201337f72e461a40107bcfcbd
- Isolated fixture reports die 0.15.7. The initial version probe used the real HOME and saw stale immutable runtime metadata 0.15.6; the runner now probes version in its disposable HOME and never repairs the user's cache.

Final run environment: PATH=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin:/home/tnfssc/.local/bin:/usr/local/bin:/usr/bin:/bin; DIE_REMOTE_E2E=1; DIE_REMOTE_PTY_E2E=1. The command was bun test tests/remote-*.test.ts tests/questions*.test.ts after rebuild and tsc. Both Docker gates are opt-in, not silently skipped in this result. Earlier fixture red runs exposed premature waits against chat text, completion requests not yet rendered, and assumptions about truncated list labels; final assertions wait on actual picker/completion state and selected full text. They are not counted as successful evidence.
