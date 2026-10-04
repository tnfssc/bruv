# Retired bundled T3 tooling (2026-10-04)

Worktree: /home/tnfssc/.bruv/worktrees/t3code-34db5acd-5442693331ce-task_a4993fe0
Branch: bruv/retire-old-bundled-t3-integration-toolin-a4993fe0

## Decision and scope

User approved deliberate deletion, not archival relocation or compatibility stubs.
The shipped path is the CLI/claude-compat pair plus separately installed official
T3. Traced executable consumers before removing the pinned upstream producer,
archive/receipt/cache tooling and its optional validation gates.

Removed 44 tracked files:
- All 29 files under integrations/ (upstream pin/patch/bootstrap/probes, build,
  gates and shared fixtures, including its READMEs).
- scripts/ci-web-validation.sh, scripts/ci-web.ts, scripts/packed-web.ts.
- src/t3/web/archive.ts and src/t3/web/file-imports.d.ts.
- tests/ci-web.test.ts, tests/packed-web.test.ts, tests/no-web-voice.test.ts,
  tests/t3-android-packaging.test.ts, tests/t3-migration-acceptance.test.ts.
- tests/t3/bruv-branding.test.ts, web-chunks.test.ts, web-fixtures.test.ts,
  web-runtime.test.ts, web-source.test.ts.

Kept native task routing tests with their existing v1 contract data inline in
that test, not a relocated integration tool. Kept production CI download-cache
assertions in ci-runner.test.ts while removing its unused producer fixture and
legacy cache test. Architecture checks now protect maintained adapters, paired
build and setup launcher, and forbid runtime imports from wisdom. Removed the
retired TS include and Linux CI's migration-only full-history checkout; feedback
still needs full history for trusted baseline discovery. Updated ARCHITECTURE.md
only for this retirement.

## Checks

Used absolute Bun 1.4.2 and PATH entries for installed Node 24.21.0/Bun; set
SHELL=/bin/bash for shell-spawning tests. No mise trust settings changed.

Passing:
- bun run check (final typecheck and asset preparation).
- bun run build (unchanged default paired build).
- bun run smoke -- --reuse-build (standalone pair and setup guide, no native parity claim).
- Final focused tests: 104 pass, 0 fail across 12 files: architecture, ci-runner,
  release-workflows, ci-selective-workflow, production-packaging, install-local,
  and tests/t3/.
- Connector tests: tests/claude-*.test.ts and tests/claude-*.test.mjs: 139 pass,
  10 skip, 0 fail (compiled/SDK-history opt-in tests skipped).
- Changed-file Biome format: 5 files clean. Changed-file lint: exit 0, five
  warnings for literal GitHub expression syntax (existing or moved assertions).
- git diff --check.

Earlier runs: inline fixture inference initially failed typecheck; retained the
old JSON.parse fixture's any typing and final check passed. A combined 226-test
run had 213 pass, 10 skip, 3 fail: two shell output assertions contained mise's
untrusted-worktree startup diagnostics; explicit Bash rerun passed. One isolated
connector process-shutdown assertion saw its PID still alive; the separate
connector rerun passed. No product shell/shutdown code changed to mask these.
Full root CI, paid providers, real T3 UI/native parity and other-platform gates
were not run.

## Remaining boundaries

No positive executable dependency on integrations/ remains in active src,
scripts, tests, TS config or workflows. Remaining retired-tool strings in active
tests are negative assertions preventing reintroduction. Package/lock changes
were unnecessary: es-module-lexer and resolve.exports are used by execute.
External official-T3 release setup/native validation remains independent and
unchanged, as do the current setup guide/launcher and paired build/install/release.

Historical experiments/audits/docs/wisdom and their prose were not modified or
moved. Parent owns its uncommitted relocation and documentation follow-up,
including stale src/t3/README.md and scripts/leak-audit/README.md references and
ARCHITECTURE.md's historical-location bullets. Apply this commit to the parent's
working tree without overwriting those moves. Only this new wisdom note was
added; values.md is unchanged because its existing retirement/single-owner and
safe-handoff principles already cover the work.

## Combined parent result

Applied worker commit `36e6d20c1d157d6f23a4bd38dd643990fe7e2346` into the parent's uncommitted folder move. Parent workspace:
/home/tnfssc/.t3/worktrees/bruv/t3code-34db5acd, branch
t3code/move-audits-docs-expts. Merged ARCHITECTURE.md rather than overwriting the
new wisdom paths. Deleted the two integration READMEs whose moved links had
changed locally. Historical evidence stays in wisdom; Git recovery commands
still use the paths that exist in those old commits.

Updated src/t3/README.md, scripts/leak-audit/README.md and the T3 experiment
entry points so they no longer direct people to maintained bundled tooling.
No active executable reference to integrations or the retired build/receipt
scripts remains. Remaining test mentions assert their absence.

Parent typecheck passes. Of 98 combined focused tests, 97 passed first; the
compiled setup-guide test failed because dist/bruv had not been built here.
Built the default pair, then that test passed unchanged. Paired standalone
smoke passes. All eight active changed code/config files pass Biome format.
Diff whitespace check passes. The worker's connector checks above also pass.
Full CI and native/browser/provider acceptance were not run. No release.

Values unchanged. The existing retirement and ownership lessons cover this
choice; there is no new general rule to add.

## Full-gate follow-up

The user asked to continue. Full Linux CI is now running as task_99f5f643
in the parent workspace. Command: explicit Bun 1.4.2/Node 24.21.0 PATH and
SHELL=/bin/bash, then `bash scripts/ci.sh linux`. Step logs live under
`artifacts/ci/`; the launch transcript is /tmp/bruv-folder-cleanup-ci.log.
Read-only review task_bdcb3254 checks the combined move and retirement for
missed current consumers and broken paths. No new cleanup scope was added.
Before calling the broad gate done, read both results, fix actual findings
and record any checks still missing. Changes remain uncommitted here.

First full gate: format, lint, typecheck, build and offline OpenAI transport
passed. Root tests had 1,958 pass, 30 skip and one installer fixture failure.
The installed-wrapper version probe inherited the parent agent's
BRUV_CLAUDE_COMPAT_BRUV_PATH and ran the real installed 0.16.5 CLI instead of
the fixture's 0.17.0 sibling. Cleared that field only for the version probe;
the installer still gets an explicit wrong override to test staging isolation.
All four download-installer tests now pass with /wrong-parent-cli inherited.
First failure log is kept at artifacts/ci-first-run/tests.log. A fresh full
gate is running; final transcript is /tmp/bruv-folder-cleanup-ci-final.log.

Read-only review task_bdcb3254 completed with no findings. It checked the
combined relocation and retirement for missed current consumers, broken paths
and mistaken removals. Final full CI task_69cbbabb is still the remaining gate.

## Final full gate

Full Linux CI task_69cbbabb passed after isolating the installer fixture probe.
Locked install, full format/lint, typecheck, default paired build, offline
OpenAI transport, all root tests and paired smoke are green. Root result:
1,959 pass, 30 skip, zero fail across 272 files (35,552 assertions). The skips
are the existing opt-in provider/native/SDK-history acceptance tests. This is
not a claim of browser, paid-provider, device or native-parity acceptance.
Final step logs are in artifacts/ci/; first failed tests are preserved in
artifacts/ci-first-run/tests.log. Read-only reference review had no findings.
Final git diff --check passes.

The combined parent changes are complete and uncommitted. No push or release.
Wisdom now holds the move, retirement decision, review and honest check results.
Values stay unchanged after this broad review: existing ownership, intentional
retirement and truthful-proof lessons cover what we learned. No new general
rule was needed.
