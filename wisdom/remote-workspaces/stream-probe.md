# Shared long-poll stream probe (2026-09-26)

Source/runner: [experiments/remote-stream-probe](../../experiments/remote-stream-probe/README.md); reproducible raw summary: [results.json](../../experiments/remote-stream-probe/results.json). Experiment only; no production change. Read with [network-lab](network-lab.md) and [wire-bench](wire-bench.md). Node 25.9.0 Linux x64, 16 CPUs, single run per condition; timing numbers below are milliseconds from server event creation to client replica visibility. The 1/100/1000 task streams are in one process, not independent samples or 1000 agents. No real LLM or Mac/SSH WAN. No p95 claim.

| synthetic scenario | approach | GETs | app request-path + JSON response bytes | acceptance / progress / question / result latency | response frames |
|---|---|---:|---:|---:|---:|
| 1 task, 0ms | shared 25ms polling | 18 | 1026 + 1749 | 28.5 / 3.2 / 25.7 / 13.1 | 18 |
| 1 task, 0ms | shared long-poll hints + catchup | 9 | 263 + 1353 | 4.4 / 5.3 / 3.6 / 5.1 | 9 |
| 1 task, 100ms each way | polling | 3 | 171 + 690 | 194.5 / 103.9 / 210.6 / 197.7 | 3 |
| 1 task, 100ms each way | hints + catchup | 4 | 128 + 1146 | 395.2 / 304.6 / 184.7 / 347.9 | 4 |
| 1 task, 300ms each way | polling | 2 | 114 + 619 | 592.3 / 501.8 / 381.2 / 744.8 | 2 |
| 1 task, 300ms each way | hints + catchup | 2 | 64 + 934 | 1195.5 / 1104.9 / 984.8 / 745.4 | 2 |
| 100 tasks, no delay | polling / hints | 21 / 13 | 1234 + 50530 / 504 + 49705 | result 3 / 5 | 21 / 13 |
| 1000 tasks, no delay | polling / hints | 74 / 69 | 4418 + 503436 / 3856 + 502766 | result 23.4 / 24.7 | 74 / 69 |

The high-delay hint path can be **worse**: hint plus page adds an RTT. Shared polling already amortizes tasks and high RTT suppresses request count. Existing network lab's 21 requests for one 460ms task were a *different per-task polling fixture*, not a claim this reproduces it. Data does not justify adopting a wire protocol. For Mac + one Linux server, favor simplest cursor catchup with one shared watcher if the need is confirmed; test actual link and UX before shipping.

A 1-task burst adds 12 progress events; 0/10/40ms progress batching gave 22/19/15 JSON response frames and 759+4940 / 588+4727 / 460+4543 request-path+response bytes. Question latency was 2.9/5.5/4.3ms: urgent events bypass batch timer, rather than waiting 40ms. Frames are responses, **not packets**. No TCP byte measurements. App bytes omit headers, TLS, retransmits. No compression or binary codec. These are synthetic JSON fixtures; the wire-bench is not a slow-consumer proof either.

Slow-reader/reconnect simulation paused client requests for 550ms while 128 x 4096-character transcript chunks accumulated (~512 KiB). Notification queue peaked at **4335 serialized bytes** (cap 8192), then explicitly signaled gap. Four bounded pages recovered all 132 events; 6 GETs and 245 request-path + 540852 response JSON bytes. Separate 2 MiB in-memory authoritative history retains transcript independent of queue. Unit tests overflow retention and confirm `history unavailable` instead of endless replay or silent loss; epoch mismatch rejects old cursor and conflicting recent duplicate payload rejects. Restart discards in-memory log; this is not durable history, a true network disconnect, or a measured bound on kernel socket queues. To prove slow TCP consumer safety, instrument socket write/backpressure and RSS under bandwidth impairment. Toxiproxy rates, if later added, are **KiB/s**, not B/s.

Strict TS + two unit tests + 14-run completeness/queue assertions passed. Values unchanged: existing show-what-is-real and bounded-use principles already require stating exactly what the network and queue experiments do not measure.
