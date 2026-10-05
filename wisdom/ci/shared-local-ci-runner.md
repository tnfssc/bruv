# Shared local / CI / Release checks (2026-10-05)

## One ordinary Linux gate

Local validation, the CI Linux job and the Release build job invoke `bun run ci`.
`scripts/ci.sh` owns the frozen install, format/lint/typecheck, paired build,
compiled offline OpenAI transport probe, `BRUV_RUN_LLM_TESTS=0 bun test --parallel=3 ./tests`,
and paired smoke with `--reuse-build`. Release no longer has a serial copy of
that suite. There is one ordinary suite run, not a CI run followed by a Release
rerun. Workflows own checkout, tools, download caches, PTY tooling and upload.

Every invocation creates and exports a fresh `TMPDIR` under the inherited temp
parent and deletes only that owned directory on exit, including gate failure.
Logs live outside it. `set -euo pipefail` propagates a failing command through
`tee` and stops later gates; `bun run ci` preserves the command's exit code.

`CI_LOG_DIR` is the only new contract: omitted/empty uses `artifacts/ci`;
an explicit path chooses the log destination (relative to the repository root,
or absolute). Release sets `CI_LOG_DIR: artifacts/release/ci`, beneath its
existing `release-failure-logs` upload. Ordinary build logs are now
`ci/build.log`, separate from final cross-target build logs. No alternate
Release mode, command list or test environment is maintained.

## Still separate on purpose

Release retains version/tag validation before the ordinary gate, the real Mac
helper and licensing, all final cross-target builds and launcher/checksum checks,
actual Linux updater checks, and the staged final pair's external unmodified
official T3 acceptance. Its actual Mac binary/updater/embedded-helper job still
runs on macOS. Publish still needs every final-artifact gate, with write permission
only in the publishing job. These are not replaced by ordinary CI or unit mocks.

`bun run ci:macos` remains the separate device-free source/Live lane. Running
that lane on Linux does not prove macOS behavior. Linux prerequisites are Bash,
Bun 1.4.2, Node 24.21.0, tmux, a Git checkout and locked-install network access.
Bundled T3/pnpm setup is no longer part of ordinary validation. Official T3 and
browser downloads belong only to the external Release acceptance job.

## Proof

`tests/ci-runner.test.ts` invokes the actual package commands with a fixture
Bun executable for inner gates. Default and Release destinations get identical
ordered commands/log output, force LLM tests off despite an inherited value of 1,
and use one existing fresh temp directory for every step. Success and failures
remove owned transient state, leave the temp parent's user-session sentinel
alone, retain gate output, return exact exit 37 and prevent smoke after test
failure. Workflow contracts require both jobs' identical command, one Release
invocation, no duplicated install/check/test/smoke commands, ordering before final
packaging, log upload coverage, and preservation of native/Mac/publish gates.
These fixtures prove orchestration, not official T3 acceptance or Mac execution.

Local focused check: 51 tests passed across eight runner/release/smoke contract
files (587 assertions). Bash syntax, formatting and diff whitespace checks passed.
The one actual Linux run used `CI_LOG_DIR=artifacts/release/ci bun run ci`:
locked install, format, lint (existing warnings), typecheck, paired build and
source/compiled offline transport passed. The root suite returned exit 1:
1,951 passed, 30 skipped, 11 failed across 272 files (76.05s). One failure was
the old inline-Release smoke contract, now fixed and covered by the final focused
run. Ten failures in job-bridge/runtime fixtures include mise untrusted-worktree
diagnostics in shell output; those files were left to their owners. This is not
a clean full-suite PASS. No second whole-suite run was made. The failed suite
correctly prevented smoke; a separate `bun run smoke -- --reuse-build` passed
against the same built pair without rebuilding or rerunning tests.

Proof stays in this checkout: `artifacts/release/ci/*.log`,
`artifacts/release/linux-gate.log`, `artifacts/release/focused-contracts.log`,
and `artifacts/release/manual-smoke.log`. Hosted Release, cross-target payloads,
official T3 acceptance and actual macOS updater execution were not run locally;
their workflow/orchestration contracts passed. No publish, push, PR or release.
No prepush/hook/actionlint work, runtime fixture fixes or missing-ffmpeg fix
belongs to this item.

Historical runner integration (before the external-T3 architecture): see
[local integration](local-ci-integration.md) and [root parallelism](root-test-parallelism.md).

Values unchanged: existing one-owner, shipped-path proof and honest-scope values
cover this change; no new general rule is needed.
