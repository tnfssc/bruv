# Standalone remote wire experiment — 2026-09-26

Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_da069f45; branch: die/compact-agent-wire-experiments-da069f45. Handoff: experiment in ../../experiments/remote-wire-bench/README.md, not production. Docker/Toxiproxy lab is owned separately; no shared code changed. Read values.md and SSH prototype/research notes.

Commands from root: /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun test experiments/remote-wire-bench ; /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun experiments/remote-wire-bench/bench.ts 42 . Environment: Linux x86_64 kernel 7.0.3-1-cachyos, Bun 1.4.2, no sockets, seed 42, 32 events/task over 640 ms; 1/100/1000 agents simulated, 1/1/10 open tasks. Three tool outputs/task including one ~16 Ki-character output. Status baseline polls all agents at each of 32 ticks. UTF-8 JSON serialized payload bytes only, not packets or network overhead.

| agents (open) | naive full-history replay bytes | naive all-status polling bytes | compact raw event bytes | batch JSON bytes | batch gzip bytes | frame counts raw/batch | first delay | heapUsed MiB |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| 1 (1) | 256,526 | 1,940 | 4,967 | 4,951 | 3,014 | 32 / 16 | 40 ms | 1.8 |
| 100 (1) | 256,526 | 152,528 | 4,967 | 4,951 | 3,014 | 32 / 16 | 40 ms | 5.0 |
| 1000 (10) | 2,563,762 | 1,552,928 | 49,579 | 49,275 | 12,707 | 320 / 16 | 40 ms | 32.8 |

At 1000 agents replay takes 320 logical requests and status polling 32; cursor subscriptions take 10 plus one explicit gap fetch in slow-consumer example. Counts exclude per-output fetches. Last-eight-event catchup is 1,326 bytes; full compact task catchup 4,936 bytes; canonical full task 22,865 bytes, including tool outputs, with single large output fetch 16,593 UTF-8 bytes. Full catchup without blob fetch is NOT full transcript replication. Baseline replay plus status is 4,116,690 bytes at 1000 versus 49,275 batch JSON bytes for ten active tasks, but not apples-to-apples canonical-transcript sync: add blob transfers and all-task catchup as needed.

At 1000 agents measured encode/decode loop sums in ms: baseline replay 3.1/4.5, all-status polling 2.8/5.2, raw compact 0.2/0.2, batch JSON 0.1/0.1, gzip batch 0.4/0.3. At one agent gzip costs 1.1/0.5 ms versus near-zero raw (rounded to 0.1 ms). Compression saves bytes at ten active tasks but costs CPU; do not compress tiny events by default solely from this run. Batch caps bound bytes and synthetic wait (40 ms) but not production memory or socket latency. Tests: 3 passing for deterministic data, gap/duplicate/task-scoped IDs, explicit large-output availability/hydration and timer/byte-bound batches.

Interpretation: active subscriptions and append-only cursor events avoid replay/request amplification in this synthetic workload. 16 KiB/40 ms is a candidate, NOT a production protocol recommendation. Single-process timings and heapUsed are noisy, omit agent-process memory, OS buffers and packet overhead. Next test real transcripts, offline retention/reconnect and tool-output fetches, gap recovery on slow link, interactive delay on Mac/remote host. Values unchanged: existing bounds, truthfulness and recoverability principles already cover lesson; no new general rule established.
