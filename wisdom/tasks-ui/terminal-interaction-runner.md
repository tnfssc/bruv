# Terminal interaction runner

Measurement-only scripts, fixtures, tests and reports extracted from combined commit `134f7bcd`. No production optimizations or instrumentation are required. Runtime and SDK remain develop; observed budget misses are not fixture failures.

## Design / reuse

A single parent launches one child process per runnable case/repetition, **serially**. Send journal installers are permanent; never run SDK and Bruv journal fixture setup in the same process. Process isolation also prevents tool/navigation adapter and lifecycle SDK theme/watch collisions. Each tool case runs setup plus the full ordered nine-stage lifecycle, returning one report case per stage. All 13 exported shapes and 14 navigation modes are represented. A selected runnable case is exact (see --list), not a regex or output-stage ID. Defaults are one repetition, small history, real 16 KiB long send and 256 KiB large paste. Use repeat counts deliberately; no automated high-sample sweep.

Send uses the existing renderer-ready callback to attach both full-frame and action profilers **before init**. Real profiler snapshots and fixture spans are preserved together; frame spans remain classified as frames and inclusive nested scopes are never summed. No fixture API or production observer is added. Other fixtures have no renderer callback; their own method/segment and frame evidence is retained rather than pretending they have action-profiler tracing.

Report v1 embeds all raw evidence and source byte hashes as well as writing raw child files. The source fingerprint covers tracked production/scripts/patches/lock/package plus new harness files and installed SDK dist JS. Revision/dirty state, Bun/platform/arch/CPU/dependency versions identify the environment. Comparisons warn on mismatched scopes/parameters and content/screen/output; timing deltas alone are not behavior acceptance. Temporary session paths and time-dependent UI may change raw hashes: inspect raw samples, do not silently normalize away evidence.

## Accounting and honest boundaries

- Longest observed synchronous scope drives strict failure at duration >= budget. Cold/init are separate report cases, included in this observed gate. Repetitions use fresh child processes, so there is no implied warmed steady-state result.
- Send admission/acknowledgment, lifecycle awaited elapsed, frame scheduling, provider controlled timers and heartbeat gaps remain distinct from synchronous work. Async-prefix spans end on immediate return. Later continuations only count where separately instrumented.
- Tool mutation segments are non-overlapping and their sum is a lower bound for mutation work. The subsequent renderNow is contiguous in the same turn, but the existing fixture lacks both boundaries of the **complete** mutation-through-frame slice. The report must mark boundary missing; never manufacture a full slice by adding mutation and frame or wrapping hashing/cleanup and calling it product CPU.
- Navigation action callbacks have real entry/return boundaries; their scheduled frames are separate turns. Cold navigation covers render/start callback only, not setup/mount. Initialized lifecycle fixture uses fixed 80x24, not CLI dimensions.
- Counting terminal is not regular-screen coverage, PTY backpressure or emulator paint. SDK InteractiveMode/service lifecycle is not actual Bruv extension startup. Offline provider is a seam, not network/provider behavior. No claim that every main-thread continuation is instrumented.

Dashboard is a single offline HTML document. JSON escapes <, >, &, U+2028/U+2029; dynamic text uses textContent, never innerHTML. It drills into repetitions, top slow inclusive spans, checks and full raw snapshots and includes baseline warnings/deltas. Saved-report validation rejects missing raw references, empty cases/samples, invalid scope kinds and nonfinite/negative measured values. CLI rejects unknown cases/groups/flags and invalid bounded numeric values. Fixture failures produce exit 2 and leave partial/raw evidence; strict misses exit 1, not a machine-dependent CI assertion.

## Running and checking

Use `bun run perf:interactions --list` for exact runnable IDs. The catalog has 43 cases: seven send, eight dispatched tool-event workloads, 13 component shapes, 14 navigation modes, and initialized SDK lifecycle. Tool component cases retain setup plus nine ordered stages, not independent workload repetitions. Select small cases first and run serially.

```sh
bun run perf:interactions --cases send/short,tools/events/normal,tools/short,navigation/scroll-page --out artifacts/terminal-interactions/smoke
bun test tests/terminal-interactions-*.test.ts scripts/terminal-perf/interaction-tool-events.test.ts
```

See [guide](../../scripts/terminal-perf/README.md) and [extraction pickup](terminal-harness-pickup.md). Historic combined timings, fixes, task ownership and results do not describe this branch and are not included.
