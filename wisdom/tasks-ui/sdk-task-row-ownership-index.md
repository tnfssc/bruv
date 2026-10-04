# SDK task-row ownership index

Each parent transcript render should collect execute details, typed notices, and the live task snapshot once, then index current ownership by task key and source call ID. Child components consume their precomputed owned rows. This avoids rescanning every sibling for each rendered child while retaining execute-detail > first typed-notice > matching live source ownership and execute-label lookup. Keep native expansion and original render behavior outside the indexed rows.

Evidence: the 2026-10-04 long-thread audit measured 155 ms for 1,000 tool rows and 428 ms for 400 typed task rows. The same actual-class probes, run against this worktree task-row module, measured 6.218 ms for the 1,000-tool empty-row + activity case and 6.026 ms for 400 task rows. Timings vary by host; tests/task-rows.test.ts asserts deterministic linear structured-row reads instead. The benchmark scripts are /tmp/bruv-terminal-lag-real-01a104c7.ts and /tmp/bruv-terminal-lag-tasks-01a104c7.ts.

Limit: transcript rendering, formatting, and other activity/history work still scale with component/row volume; this change addresses repeated task ownership discovery only. Source probes are performance evidence, not interactive-terminal acceptance.

Path/branch: src/ui/sdk-task-rows.ts, branch fix/task-row-render-scaling.
