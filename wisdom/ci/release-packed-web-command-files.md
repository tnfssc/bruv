# Release packed-web command-file identity drift

Release36818925498 at base979e032 failed its first release target build on 2026-10-01. Format, lint, typecheck, fresh compiled test producer, offline OpenAI, deterministic tests and standalone smoke passed. No publication happened.

## Exact cause and owner

The drift is in `identity.environment` in `scripts/packed-web.ts`, not the archive digest or source pin. The environment filter omitted three per-step runner command-file variables: `GITHUB_PATH`, `GITHUB_ARTIFACTS`, and `GITHUB_ARTIFACTS_LIST`. Each carries a fresh path under `_runner_file_commands`; these paths are invocation metadata, not web configuration. The existing filter already handles the other command-file paths and `GITHUB_ACTION`.

The log identifies runner2.337.0. In that exact version:
- [FileCommandManager.InitializeFiles](https://github.com/actions/runner/blob/v2.337.0/src/Runner.Worker/FileCommandManager.cs) creates a new GUID suffix for each step and sets each command’s GitHub context path.
- [ExtensionManager](https://github.com/actions/runner/blob/v2.337.0/src/Runner.Common/ExtensionManager.cs) registers AddPathFileCommand, CreateArtifactsFileCommand and ArtifactsListFileCommand.
- [GitHubContext](https://github.com/actions/runner/blob/v2.337.0/src/Runner.Worker/GitHubContext.cs) exports all three as environment variables. Artifact feature flags gate processing/population, not InitializeFiles setting their paths.

Producer and consumer are distinct shell steps. Thus these three paths necessarily differ. Logs show their explicit job/build environment and tool versions stay aligned. The failed artifact contains logs, not the packed manifest or process.env snapshots; actual GUID strings and a complete original identity diff are unavailable. This limitation does not affect the runner-contract proof or isolated reproductions.

Fix only the local packed receipt’s input classification: exclude those exact three variables, not all GITHUB variables. Leave producerEnvironment (the separate hermetic CI-cache owner), workflow ordering, identity comparisons, lifetime checks, source/mode/toolchain checks, archive/key checks and tests intact. Smoke copies the CLI into a temporary directory and runs with env -i; it does not mutate the source or packed inputs. Target builds must keep reusing the checked initial producer. This is a code fix, not a release ordering correction.

## Proof and handoff

Branch: die/fix-release-packed-web-identity-drift-3d7ca5d1
Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3d7ca5d1

New parameterized regressions change only one command-file variable after a fresh receipt. Each verifies reuse and an unchanged input key. PATH-only rollover failed before its fix with exactly “Cannot reuse packed web ... build inputs changed”; both artifact rollovers failed with exactly the same error after the PATH-only fix. The final patch accepts all three. A new GITHUB_REF regression still rejects genuine context drift and changes the key. Existing source/content/mode, npm/environment, toolchain, key, missing/corrupt archive, symlink and compile-embedding assertions remain.

Final focused command (Bun1.4.2, Node24.21.0, pnpm11.27.1 on PATH; TMPDIR=/home/tnfssc/.die/tmp-pi-removal):

`DIE_T3_SOURCE=/release/runner/custom-t3-source bun test tests/packed-web.test.ts tests/ci-web.test.ts tests/release-workflows.test.ts`

52 pass, 0 fail, 481 assertions (2.14s). Inherited Release source isolation and explicit custom-source rejection remain proved. Focused biome format/lint and `bun run check` pass. No broad local suite or release dispatch was run. Initial local setup lacked dependencies/pnpm/runtime assets; providing the existing dependency tree/tool paths and running prepare:assets resolved those setup failures without changing tracked inputs.

Proof files under /home/tnfssc/.die/tmp-pi-removal/:
- packed-web-github-path-red.log
- packed-web-github-artifacts-red.log
- packed-web-github-command-files-green.log
- packed-web-github-path-typecheck.log and packed-web-github-path-lint.log
- release36818925498.log and release36818925498-logs/
- runner-v2.337.0-{FileCommandManager,GitHubContext,ActionRunner,ExtensionManager,CreateArtifactsFileCommand,ArtifactsListFileCommand}.cs

Parent must integrate this commit and dispatch a fresh Release. Rerunning the failed workflow uses old pinned code. Parent-owned wisdom/releases/v01515-release.md and model/force/checkpoint code are untouched. Values stay unchanged: existing ownership, exact-proof and safe-work values already cover this lesson.
