# Task history resource lab

Run without models, API keys, or a T3 server:

```sh
bun run perf:resources --session /path/to/failed-native-session.jsonl
bun run perf:resources --profile ci
bun run perf:resources --profile stress
```

Both commands fail with exit code 1 if a budget is exceeded, a child crashes, its metrics are invalid, or it does not finish. The shared Linux CI/release gate runs both profiles. Reports and fixtures go under a new directory in artifacts/resource-harness. Use --out DIRECTORY to pick the artifact parent. CI keeps them in artifacts/ci/resources so existing failure-log uploads include them.

## Reuse an incident instead of waiting hours

Stop the source writer before capture. The size/mtime check detects common changes; it cannot prove a live writer is quiesced.

--session takes a private copy-on-write snapshot of an existing native Pi journal and runs the real session reopen and task-binding restore in a guarded child. It never sends a prompt or starts a model. The copy preserves the original root IDs and cursor data. Reflink is required; unsupported filesystems fail rather than silently copying gigabytes. The snapshot and report stay in a mode-0700 run directory. Do not upload real history without reviewing its private content.

The existing journal is input, so its bytes are recorded but not charged as new disk growth. New writes are still capped at 64 MiB. Captured replay keeps the 512 MiB RSS and 90 s limits, but does not kill merely for an existing entry count. The JSON report states that distinction. If indexing trips the limit, later restore stages are not claimed as tested.

## Measures

- Real persistent session and task-binding writes. The workload uses fake job/model activity but the shipped history and projection code.
- Journal bytes and entry count as the session grows.
- Child heap and RSS samples, plus independent Linux RSS and fixture disk samples every 100 ms.
- Fresh-process resume time and sampled peak memory. This includes session reopen and task binding, not just parsing a tiny fixture.
- Runtime version, source revision, dirty state, configuration, limits, exit status, metric timeline, and failure reason in report.json. A missing Git executable is reported explicitly rather than discarding measurements.

Write and resume run in separate owned processes. A failed write skips resume and says why; a partial fixture is not a successful session. The small profile checks startup/resume. The stress profile exercises a long fanout offline: 50 tasks with 2,000 updates each. The first 128 rounds add a child message; later rounds replay the same saved history. It keeps 100,000 task updates without charging the checkpoint budget for 100,000 required transcript copies. It runs seconds, not hours. Short fixture tests alone missed the incident.

| Profile | RSS | Fixture disk | Root journal entries | Time per phase |
| --- | --- | --- | --- | --- |
| ci | 384 MiB | 8 MiB | 8,192 | 30 s |
| stress | 512 MiB | 64 MiB | 50,000 | 90 s |

These are acceptance ceilings, not baselines to raise until a broken run passes. Compare the JSON timelines before and after changes. Keep exact runtime and workload settings when comparing results. Wall time and RSS vary across machines; journal growth is the stronger deterministic regression signal.

## Safety and limits

The supervisor kills only its own workload child, which must not spawn agents or other processes. No real home journal is opened, changed, or removed. The fixture scan does not follow symlinks. Stdout, stderr, metrics, and monitor samples are bounded. Evidence remains on disk until you choose to remove that exact run directory.

The watchdog samples; it is not a kernel memory quota and can overshoot between checks. Linux has an external RSS watchdog even while startup emits no metrics. Other platforms record only child-reported RSS; the report marks that gap. The Linux CI gate is the enforced resource check.

This lab covers persistent task history and resume. It does not prove the whole T3 server, browser, provider transports, or arbitrary shell/agent process trees stay bounded. Add a real workload for each new resource owner; do not rename this result as whole-product proof.

## Test the harness itself

```sh
bun test tests/resource-harness*.test.ts
```

The tests include bad telemetry, partial output, crashes, a stuck child, silent disk growth, external RSS enforcement, and output bounds. They must pass even if the production stress workload fails. A red workload is evidence of a product regression, not permission to relax the budget.
