# Terminal frame measurement

This is harness methodology, not evidence of shipped improvements. Extracted from combined source commit `134f7bcd`; runtime remains develop.

- Measure concrete synchronous `doRender` entry through return/throw, including layout, diff, escape construction and terminal writes. Count overhead as measured work.
- Report cold frames independently; do not bury them in warmup. Frame-cold is the fixture's first render in the current process, not fresh-process startup.
- Track content, screen, output and work counts with timings. An unchanged screen or different fixture cannot prove a speedup.
- Keep exclusive phase totals distinct from inclusive/nested spans. Unattributed work remains visible.
- Manual `renderNow` drains do not prove scheduler responsiveness. Dispatch/request-to-frame delay is not synchronous CPU. A counting terminal is not PTY/backpressure/paint evidence.
- Compare matched revision/configuration/content and measurement boundaries, serially on an otherwise quiet machine. No full matrix under parallel load. Use opt-in strict gates, never machine-speed assertions in normal tests.

On unchanged develop, tool complete samples render the historical document twice and reveal samples three times (including anchor work). Do not reuse the combined optimization's one-render expectations. Meaningful visibility/output/semantic assertions remain.

See [commands and dashboard](../../scripts/terminal-perf/README.md), [fixture details](terminal-perf-workloads.md), [interaction limits](terminal-interaction-lab.md), and [pickup](terminal-harness-pickup.md).
