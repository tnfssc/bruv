# Task history resource harness

Work in progress for the 2026-10-07 OOM. See [thread evidence](readability-thread-oom-2026-10-07.md).

Parent worktree: /home/tnfssc/.t3/worktrees/bruv/t3-230f6fdf.
Worker: task_c64f22ef. Worktree: /home/tnfssc/.bruv/worktrees/t3-230f6fdf-5442693331ce-task_c64f22ef.
Worker branch: bruv/task-history-resource-workload-c64f22ef.
Worker owns the real persistent task-binding workload. Parent owns the supervisor, budgets, CLI, reports, CI wiring, and integration.

## What matters

Use the real task binding and disk-backed session code. Fake model/job activity, not history storage. Measure a long write and a fresh-process resume separately. A green short run does not prove long fanout is safe.

The supervisor samples Linux child RSS and fixture bytes every 100 ms. It also reads workload heap, journal bytes/count, and elapsed time. It kills only its owned workload process on a budget violation or timeout. Child metrics, stderr, and parent samples are bounded. No models, credentials, or real home journals are touched.

Reports and fixtures stay under a unique artifacts/resource-harness run directory. We do not destroy failing evidence. The sampling watchdog is not a kernel memory quota. It can overshoot between samples. The workload must remain model-free and single-process. Non-Linux hosts currently get child-reported RSS but no external RSS watchdog; record this limit in reports.

Current supervisor tests cover external RSS, disk growth without telemetry, hung workloads, bad rows, partial output, and output limits. Full workload validation and budget calibration are pending.

Values stay the same for now. The existing measured-resource and safe-recovery values fit. No production history repair is part of this harness task.
