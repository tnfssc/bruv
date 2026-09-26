# Standalone remote wire experiment — 2026-09-26

Review worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7bef381e; branch: die/wire-benchmark-review-fixes-7bef381e. Parent reviewed a02f3e7; this review touches only experiments/remote-wire-bench and this note. Docker lab and real-agent probes run independently. Experiment README describes fixtures, axes and caveats.

Commands from root: /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun test experiments/remote-wire-bench ; /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun experiments/remote-wire-bench/bench.ts 42. Linux x86_64, Bun 1.4.2, seed 42, 32 events per task over 640 ms. JSON UTF-8 payload bytes only, no network or paid calls.

| active / total | history replay | full event deltas (outputs included) | lazy event deltas | full batch | lazy batch | lazy batch gzip | all-status polls | all-status snapshot + active deltas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 / 1 | 256,526 | 22,896 | 4,967 | 22,881 | 4,951 | 3,014 | 1,524 | 1,571 |
| 1 / 100 | 256,526 | 22,896 | 4,967 | 22,881 | 4,951 | 3,014 | 140,628 | 5,918 |
| 10 / 1000 | 2,563,762 | 228,879 | 49,579 | 228,585 | 49,275 | 12,707 | 1,437,672 | 59,873 |
| 1000 / 1000 | 258,581,730 | 23,025,122 | 5,086,239 | 22,994,508 | 5,054,549 | 1,060,185 | 1,552,512 | 1,600,403 |

Same active-task canonical content is represented by history replay and full event deltas. Lazy output fetch content alone adds 17,893 / 17,893 / 178,940 / 17,902,883 UTF-8 bytes respectively, before JSON fetch envelopes, requests or network overhead. Full delta vs replay isolates repetition. Full delta vs lazy delta isolates deferred outputs. Same-content raw vs batch isolates framing; lazy batch vs gzip isolates compression. Status comparison includes all-task initial coverage: if all 1000 change every tick, delta status is slightly *larger* than polling. Full 1000-active history replay generates 32,000 logical frames; bounded fixture, but not a realistic production traffic profile.

At 10/1000 lazy batching uses 16 frames vs 320 individual frames (full batching uses 26), and gzip reduces lazy batch bytes from 49,275 to 12,707. Maximum simulated batch wait is 40 ms. Single oversized canonical tool output emits immediately above 16 KiB, marked explicitly. Last-eight summary catchup is 1,326 bytes; full summary catchup 4,936 bytes; canonical full task 22,865 bytes. Summary catchup alone is NOT full transcript replication. Tests cover gap/duplicate immutability, missing output, ordering, time/byte caps, exact boundary and oversized semantics.

No meaningful CPU inference from prior single-run encode/decode sums: removed. Prior heapUsed was a one-shot snapshot, neither peak nor memory bound: removed. Frames are not packets; no sockets, agent processes, link latency, durability or offline recovery measured. These measurements are synthetic accounting, not a production protocol recommendation. Next: real transcripts, retained output fetch and reconnect, slow-link gap recovery and interactive delay. Values unchanged; no new general rule established.
