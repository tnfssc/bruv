# PR 35 CI prerequisite (2026-10-05)

Worktree: /home/tnfssc/.bruv/worktrees/t3code-bc92964a-5442693331ce-task_c96a95bc
Branch: bruv/fix-pr-35-ci-failures-c96a95bc
Base: PR head 156877a185bfda41f72885ed37059a539cbb16c3, targeting develop.

Read values and CI linked-failures, local-ci-integration, full-path-simplification notes; also Live startup-audio-queue-testing. Values unchanged: existing honest proof and narrow ownership rules cover this.

## Observed failure and fix

`gh run view 37354320182 --log-failed`: both Linux x64 and macOS Live failed tests/live-startup-natural-fixture.test.ts:82 because naturalFixturePcm spawned ffmpeg, missing from PATH (ENOENT). Not format/types. Reproduced with Bun 1.4.2 and an empty temporary PATH: `bun test tests/live-startup-natural-fixture.test.ts` gave 5 passed, 1 failed with the exact error (/tmp/pr35-reproduce.log).

CI now conditionally installs ffmpeg (apt/brew) and prints its version before each gate. Regression checks setup/order for both lanes; it failed before the workflow fix. No production, conversion, assertion, check or release-workflow changes.

## Commands and results

- `bunx --no-install biome format --write .github/workflows/ci.yml tests/ci-runner.test.ts`: TS formatted; YAML is not Biome-supported.
- `bun test tests/live-startup-natural-fixture.test.ts tests/ci-runner.test.ts tests/live-macos-ci.test.ts tests/ci-selective-workflow.test.ts tests/release-workflows.test.ts`: 37 passed, 0 failed, 575 assertions (/tmp/pr35-focused.log).
- First `bun run ci`: checks/build/transport passed; root 1,977 passed, 30 skipped, 10 failed from local mise trust warnings polluting shell output. `mise trust mise.toml` fixed this checkout setup, no repository edit (/tmp/pr35-linux-ci.log).
- Clean `bun run ci`: frozen install, format, lint, typecheck, paired build, offline transport and all Live tests passed. Root: 1,986 passed, 30 skipped, 1 failed, 35,713 assertions (/tmp/pr35-linux-ci-clean.log). Remaining unrelated failure: connector wrapper; tests/claude-compat-runtime.test.ts:763 still sees shell PID immediately after runtime.close(). No connector edit.
- `bun run ci:macos` **on Linux**: 305 passed, 3 opt-in skips, 0 failed, 22,172 assertions (/tmp/pr35-live-lane-linux.log). Not native macOS proof.
- `bun run smoke -- --reuse-build`: paired standalone smoke passed (/tmp/pr35-smoke.log).
- `bun test tests/claude-compat-runtime.test.ts`: isolated connector wrapper passed (1 test, 1 assertion; child suite exited 0), /tmp/pr35-connector-focus.log. The full-suite shutdown failure did not reproduce alone; its cause remains unproven.

No paid providers, devices, credential edits, push, merge or release. Parent owns CodeRabbit/integration/merge/release. Hosted CI must prove native macOS/Homebrew and full green status; local full gate is not claimed green.

## Release workflow follow-up

The release job also runs bun test ./tests, including the default natural-fixture conversion test. Its existing single prerequisite apt install previously installed only tmux. Added ffmpeg to that same install command (no additional setup job); a regression test asserts the prerequisite step precedes the Deterministic tests step. Production code is unchanged.


Validation for this follow-up: bun test tests/release-workflows.test.ts passed (20 tests, 323 assertions); bun run format:check passed (747 files). bun run lint exited 0, reporting existing diagnostics across the repository; changed-file Biome check also exited 0 with four pre-existing workflow-placeholder warnings.
