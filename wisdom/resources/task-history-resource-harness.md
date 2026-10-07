# Task history resource harness

Harness for the 2026-10-07 OOM. See [thread evidence](readability-thread-oom-2026-10-07.md).

Parent worktree: /home/tnfssc/.t3/worktrees/bruv/t3-230f6fdf.
Worker: task_c64f22ef. Worktree: /home/tnfssc/.bruv/worktrees/t3-230f6fdf-5442693331ce-task_c64f22ef.
Worker branch: bruv/task-history-resource-workload-c64f22ef.
Worker owns the real persistent task-binding workload. Parent owns the supervisor, budgets, CLI, reports, CI wiring, and integration.

## What matters

Use the real task binding and disk-backed session code. Fake model/job activity, not history storage. Measure a long write and a fresh-process resume separately. A green short run does not prove long fanout is safe.

The supervisor samples Linux child RSS and fixture bytes every 100 ms. It also reads workload heap, journal bytes/count, and elapsed time. It kills only its owned workload process on a budget violation or timeout. Child metrics, stderr, and parent samples are bounded. No models, credentials, or real home journals are touched.

Reports and fixtures stay under a unique artifacts/resource-harness run directory. We do not destroy failing evidence. The sampling watchdog is not a kernel memory quota. It can overshoot between samples. The workload must remain model-free and single-process. Non-Linux hosts currently get child-reported RSS but no external RSS watchdog; record this limit in reports.

Current supervisor tests cover external RSS, disk growth without telemetry, hung workloads, bad rows, partial output, and output limits. The workload is integrated from worker commit 5bc6eb7e (parent cherry-pick). Each update adds one child entry in the standard profiles; --child-entries means entries per update, not total entries. The initial smoke trial used 128 entries per update by mistake. We corrected the workload size, not the budget.

## Measured on this machine

- Captured the actual 11,884,666,735-byte failed journal with a private CoW snapshot. Guarded replay failed after 16.4 s at 549.9 MiB RSS against a 512 MiB limit. It tripped while opening/indexing, before the indexed sample. Do not claim later cursor restore completed.
- Small profile: write 170.1 MiB RSS, 4.12 MiB fixture, 1,034 root rows in 878 ms. Separate resume: 113.0 MiB, 4.15 MiB, 1,042 rows in 436 ms.
- Offline stress: stopped after 19.2 s at 64.07 MiB fixture bytes (64 MiB limit), 501.6 MiB sampled RSS, and 10,052 root rows. The present product bug remains. The new stress CI/release gate is intentionally red until it is fixed; do not raise the cap to hide it.

Private local evidence: artifacts/resource-harness/captured-NWs8yd/report.json, ci-X9yDaT/report.json, and stress-uFUhCl/report.json. The captured fixture includes real private history. Do not commit or upload it. Reports and snapshots are retained locally. No original history or recovery files were changed.

Captured replay counts old journal bytes as input, not growth, and disables the entry-count cap for existing history. RSS, wall time, output, and new disk writes still have limits. Reflink is required. Source revision and runtime belong in reports. The portable fake-job test checks the same production history/binding paths, not a whole AgentSession or T3 server resume.

Workload tests were adjusted to allow fewer checkpoints after a real fix. They keep preservation, derived-history content, deduplication, and metric accuracy checks. They must not enshrine quadratic growth as required behavior.

Values stay the same for now. The existing measured-resource and safe-recovery values fit. No production history repair is part of this harness task.

## Review checkpoint

Code is committed locally through 21ff174a. Safety review task: task_5786fbb0. Worktree: /home/tnfssc/.bruv/worktrees/t3-230f6fdf-5442693331ce-task_5786fbb0. Branch: bruv/resource-harness-safety-review-5786fbb0. Review is read-only. Its findings still need parent triage.

Validation so far: 18 harness tests pass, TypeScript passes, focused Biome passes, bash syntax and git diff checks pass. Shared full CI is not green: the newly measured stress gate exposes the current product bug. Full build/root suite were not repeated for this script-only harness. Existing connector regressions are being checked separately. No PR or push yet.
