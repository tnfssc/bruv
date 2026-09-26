# Shared long-poll stream probe (2026-09-26)

Experiment only: [source/runner](../../experiments/remote-stream-probe/README.md), [raw summaries](../../experiments/remote-stream-probe/results.json). No production changes. Single Node 24.21.0 Linux x64 run per condition, with 1/100/1000 synthetic task streams in one process. Times below are **server creation to client replica visibility** in milliseconds; result/question entries are medians across tasks (n=1 for single-task conditions). No tails or p95 inference. Impairment is a loopback **application-level** sleep in each direction, not WAN/SSH/TCP shaping. 100/300ms per way gives at least 200/600ms RTT.

Three comparable shared-channel candidates: 25ms polling; compact long-poll highwater/gap hint followed by paginated fetch; direct data-bearing long-poll with bounded page. All use a handshake epoch, client cursor, and page `more` for catchup; no server-object oracle for client flow control. The earlier duplicated-full-event hint baseline was removed; its extra-RTT negative result was not evidence that direct long-poll was poor.

| Tasks | delay/way | mode | GETs | request-path + response JSON bytes | question / result ms |
|---:|---:|---|---:|---:|---:|
| 1 | 0 | poll / hint / direct | 18 / 10 / 6 | 975+1956 / 269+988 / 301+955 | 2.1/17.5 · 5.1/4.7 · 2.0/1.7 |
| 1 | 100 | poll / hint / direct | 3 / 3 / 3 | 120+705 / 70+649 / 124+705 | 185.7/173.7 · 385.6/144.8 · 183.6/144.6 |
| 1 | 300 | poll / hint / direct | 2 / 3 / 2 | 63+621 / 70+649 / 65+622 | 985.6/744.8 · 1589.5/1349 · 985.5/745.9 |
| 100 | 0 | poll / hint / direct | 22 / 14 / 10 | see raw file | result 8.1 / 4.8 / 2.1 |
| 1000 | 0 | poll / hint / direct | 73 / 70 / 66 | see raw file | result 31.1 / 30.6 / 28.0 |

The 100/300ms hint path can add a fetch RTT, while direct carries events in its first response. Shared polling amortizes tasks already; this single run is not a protocol recommendation. Do not compare its GET count with network-lab's per-task polling fixture. Event-loop scheduling changes timings between runs.

Progress batching (0/10/40ms, one burst task) gave 23/20/17 JSON responses; urgent events bypass the progress batch timer. Simulated reconnect pauses requests for 550ms, while 128 × 4096-character transcript chunks (~512 KiB) accumulate. The compact hint queue overflowed and explicitly signaled a gap; bounded pages recovered all 132 events. Its peak 4072 bytes under 4096-byte cap is the **sum of serialized hint entries**, not the full response frame (envelope, HTTP headers, TCP buffers excluded). Retained authoritative events have independent 2 MiB cap; 64-event and 32 KiB full-JSON-frame page caps are asserted. Oversized events are rejected before cursor increment; exhausted retention or changed epoch reports history unavailable, not silent replay. Restart discards in-memory history.

Strict TS, three unit tests, 19-run completeness/queue/page assertions passed on Node 24.21.0. This experiment did **not** measure TCP backpressure, RSS, packet counts, actual disconnection, compression, real LLMs, or Mac/SSH WAN. Test real link and UX before choosing a production protocol; instrument socket write/backpressure and RSS under bandwidth impairment before claiming slow TCP-reader safety. Toxiproxy bandwidth rates, if later used, are KiB/s, not B/s. See also [network-lab](network-lab.md) and [wire-bench](wire-bench.md).
