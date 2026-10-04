# Compiled first-held PTY profile — 2026-10-04

## Scope / result

Read-only production investigation; exactly one LONG_TURNS=1000 compiled profile run, no second run, no build/install or production/harness edits. Actual compiled v0.16.0 SHA256: 6b6960c1632298ec97e260b54b46ffeae82b2f9697b047b0deba7b45a793e320. Private executable wrapper exports BUN_OPTIONS only for dist/bruv; parent bun test has BUN_OPTIONS unset. Private /tmp copy of tests/long-thread-pty-latency.test.ts adds diagnostic console timestamps and absolute imports/artifact paths only; budgets (100ms echo / 140ms spinner gap / 45 transitions), all samples, measurement order and assertions unchanged. Preload logs boot/exit timestamps and handles SIGHUP with process.exit(0), successfully flushing compiled profiles. The measured child profile is PID 2540934, not source CLI or parent Bun.

Probe directory: /tmp/bruv-compiled-held-profile-ofDBws
- profiles/CPU.20261004.113044.2540934.0.001.cpuprofile (long compiled child)
- run.log (diagnostic events and failed gate)
- child-timeline.jsonl (wall/monotonic boot + graceful exit)
- measurements.json, profile-analysis.txt, private harness/wrapper/preload

Exit 1 is expected held-input budget failure; untrusted mise warning did not prevent Bun/harness/profile execution.

## Measurements

Original /tmp/bruv-final-candidate-1000.json: first held 481.61672ms; remaining 11 samples range 48.2365–97.3143ms (their p95 97.3143ms). These later samples are described, NOT excluded from acceptance p95.

Profiled long run: idle p95 73.6112ms PASS; held p95/first 162.2503ms FAIL; later samples 49.3760–96.6166ms; spinner 61 transitions, gap p95 106.0721ms PASS. Short first held 4.3252ms. Request setup 1881.8839ms (original 2508.5782ms). Profiling run is diagnostic, not substitute acceptance evidence.

## Exact first-held window / call path

Harness long send event wall 1791099037255ms / parent performance.now 18305.538903ms; echoed wall 1791099037417ms / performance.now 18467.815618ms. Actual latency timer starts just after diagnostic send logging and reports 162.250336ms.

Compiled profile startTime 1791099028164215us, endTime 1791099044440412.2us are epoch-based. Boot preload wall 1791099028167ms / child performance.now 5.481949ms; exit wall 1791099044440ms / performance.now 16278.664016ms. Sum of profile deltas reaches within 3.72225ms of endTime. The first-held window contains 133 samples; epoch alignment is approximately millisecond precision, not exact terminal hardware timing.

Observed inclusive sampled first-held work:
- TUI doRender -> Lwe/AJ/mJ -> chat Container.render: 146.35ms.
- Its rolling hook r -> ActivityController.sync: 52.79ms, including 35.79ms under map -> materialize -> synchronous open/read/JSON.parse/remember. Source: src/ui/rolling-activity.ts:96, :120–130; src/history/session-manager.ts selectDiskBackedEntries filters metadata then materializes selected branch messages. Compiled hook and sync at bundle line 2578 retain identifiable source property names.
- Following SDK task-row container render d (bundle line 2583; src/ui/sdk-task-rows.ts:118): 85.89ms inclusive of native child rendering, taskRowsFromDetails (_m, bundle line 2556), per-child task/layout wrappers and spacing wrappers (X, bundle line 2741). Do NOT interpret the entire 85.89ms as task-row accounting self time. _m inclusive 20.40ms here, including native performIteration samples; those samples do NOT prove GC.
- Other TUI work 7.68ms; provider/other 15.65ms (including provider-stream callback t, bundle line 404, 12.03ms).

Timeline relative to send: rolling sync 0–44.07ms; render 44.07–78.89ms; provider/other 78.89–94.54ms; rolling sync 94.54–103.26ms; render 103.26–162ms. Membership materialization is on the first cold frame; subsequent sync still traverses children without that disk refresh.

Warm later sample k=1 (95.20ms echo) contains 52.20ms under one TUI render and 42.80ms under another render-timer callback; sync only 2.40ms for the identified first render stack, without the cold materialize stack. Ongoing whole-history render/layout traversal remains significant.

Request structuredClone/stringify work appears BEFORE held send (e.g. preceding 200ms contains 44.64ms structuredClone, 30.26ms stringify); it is not dominant inside the measured first-held window. No sampled footer-history or context-accounting rebuild dominates that window. No identifiable GC event proves a GC stall.

## Conclusion / proposal (not implemented)

Proven for this compiled diagnostic: first-held budget failure overlaps synchronous TUI work, including cold rolling membership disk refresh plus full-history rendering. Profiling/polling overhead and host scheduling remain confounders; inclusive sampling times are wall-time estimates, not exact CPU accounting. Diagnostic logging is in the parent, outside the child's CPU profile; preload has no per-input work. No non-profiled matched control was run.

The exact cause/magnitude of the original 481.6ms event remains UNPROVEN: this run reproduced only 162.3ms and cannot retroactively attribute the missing 319ms. Do not claim a measured fix or blame GC/late serialization from this evidence.

Narrow next proposal for parent approval: inspect incremental membership update on append-only user/boundary events so invalidating the revision need not re-materialize all historical user/assistant messages on the next render. Keep branch switches/full rebuild semantics and all safety gates. Consider steady whole-history task/layout rendering separately only if further work is authorized. No implementation performed.
