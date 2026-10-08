# Ordinary CI: three native Bun shards

## Change and coverage

Bun is pinned to 1.4.2. The ordinary Linux test job now has matrix shards 1, 2, 3, named **Full validation / Linux x64 (1/3)** through **(3/3)**. Each runs the same locked install, format/lint/typecheck, both resource profiles, paired binary build, offline OpenAI probe, and paired smoke. Only the root test invocation is partitioned: `bun test --parallel=3 ./tests --shard=1/3` (or 2/3, 3/3). Bun owns discovery/partitioning; there is no file list or scheduler.

`CI_TEST_SHARD` is optional, Linux-only, and accepts exactly 1/3, 2/3, 3/3; invalid values (including explicitly empty) exit 2 before install. With the variable unset, `bun run ci` still runs the complete suite. Real LLM tests remain disabled. Assertion bodies, existing per-test deadlines, stress budgets, native Linux and macOS checks are unchanged.

Matrix fail-fast is disabled so every shard can finish and provide its own failure logs. Artifact names include the shard number. The shared Linux gate still has a six-minute workflow step limit, not an increased test timeout. **CI policy** still requires feedback success and the whole `needs.test.result` matrix success plus native Linux and macOS success for full validation; failure/cancellation/skips cannot qualify. Docs-only admission stays unchanged.

## Baseline and expectation (not a promised result)

Healthy run [37831109349](https://github.com/tnfssc/bruv/actions/runs/37831109349) had an ordinary Linux job of **210 s**, root tests **132 s**, and stress **18 s**. Read-only GitHub jobs API review confirmed the successful Linux job ran 19:20:24–19:23:54 UTC and that native Linux, macOS, and CI policy all succeeded.

With three equally costly file partitions, a rough Linux estimate is **210 - 132 + 132/3 = 122 s**. The repeated 78 s is not removed: each shard independently proves its prechecks/build/offline/smoke. Native sharding is not duration-aware, so the slowest shard, runner contention, cold download/tool setup, and queue time may raise that estimate. Aggregate runner consumption increases; the aim is shorter critical-path feedback, not lower billed CPU time. Three bounded workers per shard means nine workers spread across three Linux runners, not unbounded concurrency on one runner.

## Release integration handoff

Release workflow/scripts are intentionally untouched. The old jobs API name **Full validation / Linux x64** becomes exactly the three names above. Any exact-SHA reuse verifier must require all three successful jobs, not one old name or an arbitrary prefix match, plus the unchanged native Linux, macOS, and CI policy jobs. Its API fixtures should include missing/failed/cancelled shards and docs-only/skipped validation, and its job-list pagination must still include every required job. Existing ordinary CI policy tests continue to reject incomplete dependency outcomes. No tracked release reuse-name consumer was present in this worktree during review; the release owner is adding that path separately. Branch protection should continue to require **CI policy**, not one individual shard.

## Checks and measurement

- Final full-repository format check, lint, TypeScript check, shell syntax and diff whitespace checks passed.
- Focused runner/workflow/macOS/resource/release-workflow/smoke tests: **150 passed, 0 failed**, 883 expectations.
- A disposable 12-file suite runs through the actual shared runner with real Bun 1.4.2: unsharded coverage equals the disjoint union of native 1/3, 2/3, 3/3 subsets. All non-test gate commands are recorded stubs only in that fixture. Invalid shard failure and failed-shard log/exit/smoke behavior are also tested.
- Isolated local unsharded gate: **126.914 s**, exit 1; root suite **109.97 s**, **3093 passed / 31 skipped / 2 failed**, 3126 tests across 352 files. All prechecks/resource profiles/build/offline probe succeeded; smoke correctly did not run after test failure. Stress write/resume reported 11.561 s / 0.446 s. This is a failed gate measurement, not healthy CI proof.
- The two failures were TUI harness session starts (duplicate-start and demo auto-kill). The measurement’s deeply nested owned TMPDIR made tmux’s Unix socket path too long. An independent owned-path probe with the same nesting produced a 117-byte socket path and `File name too long`, exit 1. No TUI assertions/timeouts were changed.
- Measurements use an owned HOME, XDG configuration/data/cache and temp tree, an empty inherited environment except PATH and owned paths, no provider credentials, LLM tests disabled, and an external `timeout --signal=KILL 360s` deadline. There was no repository dotenv file. Logs remain in `/tmp/bruv-shard-measure-9zlcO5/`; native root-shard measurements use the shorter owned tmp path without the runner’s extra nesting. These are local root-only subset timings, not full matrix gate/job measurements. GitHub post-change timing is not measured by a local run.

### Native root subsets (local, sequential measurements)

| Shard | Root wall time | Pass / skip / fail | Files |
| --- | ---: | --- | ---: |
| 1/3 | 45.550 s | 1035 / 14 / 0 | 118 |
| 2/3 | 33.673 s | 1022 / 13 / 0 | 117 |
| 3/3 | 49.832 s | 1038 / 4 / 0 | 117 |

All three subsets passed. Their union totals **3126 tests across 352 files**, matching the unsharded suite’s test/file counts; **3095 pass / 31 skip / 0 fail**. The disposable-suite integration test separately verifies a disjoint union, not just equal totals. The two TUI tests pass with the shorter owned TMPDIR. The root critical path is the slowest shard, **49.832 s**, not the summed 129.055 s; this shows nonuniform file cost and is not a GitHub job timing claim. Compared with the failed local unsharded 109.97 s run, root wall time is about 45% as long, but that failed baseline is not a clean healthy-run comparison. Full repeated prechecks and runner startup still need adding to any end-to-end estimate.

The separately invoked built-pair offline standalone smoke also passed. No provider/credential, hardware/native parity, or post-change GitHub CI proof is claimed.
