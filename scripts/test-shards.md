# Complete root tests, bounded process parallelism

After the normal locked install, asset preparation and build **once**, replace only
the root deterministic test command with:

~~~sh
DIE_RUN_LLM_TESTS=0 bun scripts/test-shards.ts --shards 4 --log-dir artifacts/ci/test-shards
~~~

Run from the repository root. The workflow should retain/upload the whole log directory,
including on failure. No YAML or CI shell changes are part of this runner. It does not
replace format, lint, typecheck, build, web tests, offline transport or smoke checks.
It does not install to a user's home. It verifies the prepared assets and compiled
checkout-local `dist/die --version` match package.json before running the suite.
Do not point this at an unrelated installed binary. Use `--shards 1` for the same complete
suite in one process, or 3 on a smaller runner; the bound is 1–4 (default 4).

## Coverage and execution

- Discover exactly `tests/**/*.test.ts` on every invocation, including nested/new/changed
  files. No filename selection, changed-path rollout, or tests renamed/dropped.
- Deterministic greedy balancing: twelve rounded measured expensive-file costs,
  one uniform small weight for all other files, stable lexical ties. This small cost
  table affects assignment only; stale entries cannot remove a test. No scheduler,
  dependency graph, maintained 200-file list, or serial lane.
- Assert partition union equals discovery, with no duplicates or omissions. Save
  discovery and assignment in `partition.json`. Also verify every assigned file appears
  in Bun's output and totals agree with its final summary; incomplete output fails.
- Each shard is a normal serial `bun test ./file ...` process with the usual preload,
  assertions and timeouts. No global test concurrency or timeout overrides. Children
  spawned by tests still work normally. `DIE_RUN_LLM_TESTS=0` is enforced; all other existing
  opt-in guards/environment are unchanged.
- Fresh HOME, TMPDIR/TMP/TEMP and tmux socket directory for each process. Socket roots
  stay under /tmp to avoid Unix socket path limits with a long caller TMPDIR. Shard
  temporary data otherwise honors caller TMPDIR; use a filesystem with enough space.
- Every shard runs to completion even if another fails. A bad test, failed spawn,
  missing/partial summary or SIGINT/SIGTERM makes the runner nonzero. Cancellation
  signals process groups, escalates to SIGKILL, and kills only tmux servers reachable
  through its owned socket directories (tmux daemonizes outside process groups).
- Unique `run-*` log directories retain stdout/stderr per shard and `summary.json` with
  individual exits, durations, pass/skip/fail totals and interruption state. No logs
  are overwritten/deleted; only disposable homes/temp/socket directories are removed.
  Uncatchable SIGKILL cannot produce a final summary, but cannot exit successfully.

## Shared-resource audit

The assignment was audited before measuring, against the complete root test sources:

- Actual network servers in OpenAI, Live, task-monitor and t3 tests bind port 0.
  Unix listeners use unique fixture paths. Fixed localhost URLs elsewhere are mock
  inputs or deliberately refused endpoints, not listeners. The Docker fake provider
  on 18765 belongs to the existing separately opt-in remote-e2e fixture, skipped in
  the deterministic run; its opt-in guard is not changed.
- CLI/session/update/repository fixtures use mkdtemp (some explicitly /var/tmp) or
  PID/time-named paths. Home-backed SDK/session/runtime state is per process or a
  test's own fresh home. No developer config, authentication or installation is copied.
- Compiled tests read checkout-local dist/die. Install/smoke/web-runtime tests mutate
  **fixture** dist directories, not the checkout's build. prepare-assets.test.ts is
  the one real preparation call: dependencies/assets must already be prepared once;
  it asserts an idempotent run preserves asset mtimes. Pi host mutation/drift tests
  use disposable fixture dependencies. No build is performed by a shard.
- tui-harness.test.ts alone writes the checkout's .die-harness session records and
  artifacts/tui; its demo/regular sessions remain in that one file/process. Other
  TUI tests use their own PID/time sockets, additionally isolated by TMUX_TMPDIR.
- SDK mocks, module caches, environment mutations and process-local globals cannot
  cross Bun process boundaries. Tests are not made concurrent within a process.
  No shared writer/port conflict requiring an exceptional serial lane was found;
  the complete four-process run passed, including the compiled/TUI/deadline tests.

Future tests that introduce a fixed shared listener/writer still need review; a cost
bucket is not an isolation guarantee. Prefer a unique fixture over adding a serial lane.

## Local proof (2026-09-30)

Disposable detached worktree at revision e561bda plus this runner/test file. Copied
current compiled dist/die (package and binary version 0.15.14), prepared dependency
copy and assets; preparation ran once before both measurements. No user installation,
no per-shard build, no source-only substitution. Both runs discovered **206 files**:
204 from the earlier expanded-full log, existing ci-selective-runner tests, and these
runner tests. Both executed **1,442 pass / 20 skip / 0 fail**, all 1,462 test cases.

| Processes | Runner suite wall | Whole command wall | Peak sampled summed tree RSS |
| --- | --- | --- | --- |
| 1 | 160.41s | 160.76s | 1.21 GiB |
| 4 | 50.61s | 51.06s | 1.80 GiB |

Four-shard totals: 320/11, 341/2, 395/4, 386/3 pass/skip, all zero failures/exits.
About **68% lower wall time**, not a runner-minute claim. Setup/build were common
prerequisites excluded from this table, not deferred checks.

Conditions: Bun 1.4.2 (744846f84), Linux x86_64 Ryzen 9 7940HS, 8 cores/16 threads,
31.3 GiB RAM. Both process trees were pinned with taskset to logical CPUs 0–3;
about 16.6–16.8 GiB memory was available, with a pre-existing ~19 GiB of swap in use.
Resident-memory samples sum runner/descendants every 100ms (shared pages may be
counted twice; brief peaks may be missed). The first serial run precedes the sharded
run, so OS page caches/background desktop activity are uncontrolled. Fresh per-process
homes prevent reusing the prior run's user runtime. /tmp was almost full, so fixture
data used TMPDIR=/home/tnfssc/.die/t; short tmux sockets stayed in /tmp. Hosted runner
CPU topology, storage, memory and load differ; one local pair is not a p95 or hosted
CI promise. Focused runner tests ran alongside the measurement; later version-guard
and tmux-cleanup assertions were checked focused without repeating the entire suite.

Full evidence is retained locally under /home/tnfssc/.die/shard-proof-logs:
`{1,4}-runner.log`, `{1,4}-resources.json`, and `1/run-IyUzWH` / `4/run-FIwh3F`
with partition manifests, full Bun logs and summaries. The final focused runner tests
pass (5 tests), with format/lint and TypeScript checks passing as well.
