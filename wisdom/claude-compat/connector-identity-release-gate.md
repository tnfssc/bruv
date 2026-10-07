# Connector identity release gate

## Source and ownership

- Worktree: /home/tnfssc/.bruv/worktrees/t3-1c4479b8-5442693331ce-task_00eaae99
- Branch: bruv/run-release-ci-gate-for-connector-identi-00eaae99
- Input HEAD: 449fb348 (unchanged exact-T3 UI acceptance), including 74b973a5
  (label-only CLI identity and paired update routing). Publication parent uses develop.
- This is a new release-follow-up worktree; the completed integration worktree
  was not edited. No push, PR, release, manual workflow dispatch, real
  install/update, provider authentication, or Live provider calls.

Read [values](../values.md), [identity proof](label-only-cli-identity.md), and
[exact-T3 acceptance](connector-version-probe-integration.md). Existing UI proof
uses unchanged T3 2702, an old-version control, and native loopback chat. No new
UI run is claimed here; the independent built-in-model warning remains.

## Actual gate

Run from the worktree above:

```sh
PATH=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin:/usr/bin:/bin \
CI_LOG_DIR="$PWD/artifacts/connector-release-gate/initial" \
/usr/bin/bash scripts/ci.sh linux > /tmp/connector-release-ci-initial.log 2>&1
```

The gate installs this worktree's own frozen-lockfile dependencies (219 packages
on the first run); there was no node_modules symlink or shareddeps mutation.
The explicit PATH gives every nested Bun/Bash invocation the same tools.
CI isolates transient sessions in its own TMPDIR. Install/update tests and the
smoke stage are temporary fixtures, not changes to the real installation.

Full stdout: /tmp/connector-release-ci-initial.log.
Per-stage logs: artifacts/connector-release-gate/initial/ (ignored local files).
A compact durable stdout excerpt lives beside this note under
proof/connector-identity-release-gate/gates.txt.

**Linux gate exit code: 0.** All eight stages completed: frozen install, format,
full lint, TypeScript check, paired build, source + compiled offline OpenAI
transport, complete root suite, and standalone paired smoke.

- Root tests: **2,227 pass, 30 skip, 0 fail**, 112,710 expect() calls across
  302 files (2,257 tests; 104.17 seconds).
- Format: 845 files checked, no fixes applied.
- Full lint: succeeds with 1,004 warnings; existing schema/deprecation
  diagnostics remain. No lint errors or format/check failures were observed.
  The warning count is not represented as warning-free.
- All seven terminal-perf-send cases pass in this actual CI run.
- Smoke: bruv paired standalone smoke test passed (not native parity acceptance).

The root gate uses its normal default environment, not the earlier compiled-test
binary overrides. Its 30 configured skips include opt-in LLM/live/remote/SDK and
compiled connector cases; none were added or skipped by this task. Prior
compiled connector acceptance remains documented in the input identity proof.
The actual release script itself is green, not just a focused subset.
After writing the documentation-only delta, root format and full lint were
rechecked with absolute Bun 1.4.2: exit 0. Stdout:
artifacts/connector-release-gate/documentation-check.log.

## Changes and lessons

No source or test changes were needed for the observed gate. The prior
six terminal-perf failures were order-sensitive process-global adapter state:
if the disk adapter captures getContextUsage after shake accounting has wrapped
it, its metadata-only estimator view reaches the accounting wrapper, which
calls missing manager.getSessionId. The production CLI installs disk before
shake; an isolated file previously passed. This run uses the release's actual
three-worker scheduling rather than the earlier unbounded full-suite command.
All seven terminal-perf-send tests passed here. That is not a claim to have
fixed or disproved the previously recorded ordering symptom. The prior baseline
reproduction is recorded in the input wisdom; no baseline rerun was needed.

Values reviewed and unchanged: existing exact-source proof, scope ownership,
and whole-gate validation cover this result. This is feature-local gate
knowledge, not a new repeated general lesson. Parent owns integration and
publication; this task only commits the release-gate wisdom and proof.
