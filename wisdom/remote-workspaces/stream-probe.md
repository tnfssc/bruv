# Shared long-poll stream probe (2026-09-26)

Experiment only: [source/runner](../experiments/remote-stream-probe/README.md), [raw summaries](../experiments/remote-stream-probe/results.json). No production changes. Single Node 24.21.0 Linux x64 run per condition, with 1/100/1000 synthetic task streams in one process. Times below are **server creation to client replica visibility** in milliseconds; result/question entries are medians across tasks (n=1 for single-task conditions). No tails or p95 inference. Impairment is a loopback **application-level** sleep in each direction, not WAN/SSH/TCP shaping. 100/300ms per way gives at least 200/600ms RTT.

Three comparable shared-channel candidates: 25ms polling; compact long-poll highwater/gap hint followed by paginated fetch; direct data-bearing long-poll with bounded page. All use a handshake epoch, client cursor, and page `more` for catchup; no server-object oracle for client flow control. The earlier duplicated-full-event hint baseline was removed; its extra-RTT negative result was not evidence that direct long-poll was poor.

| Tasks | delay/way | mode | GETs | request-path + response JSON bytes | question / result ms |
|---:|---:|---|---:|---:|---:|
| 1 | 0 | poll / hint / direct | 18 / 10 / 6 | 975+1958 / 269+988 / 301+955 | 3.7/24.5 · 4.9/4.6 · 1.8/1.9 |
| 1 | 100 | poll / hint / direct | 3 / 3 / 3 | 120+705 / 70+648 / 124+704 | 186/171.9 · 386.7/146.9 · 183.1/145.7 |
| 1 | 300 | poll / hint / direct | 2 / 3 / 2 | 63+622 / 70+649 / 65+622 | 984.4/745 · 1587.8/1347.6 · 982.9/743.4 |
| 100 | 0 | poll / hint / direct | 22 / 14 / 10 | 1240+50853 / 510+49805 / 544+49829 | 21.7/13.5 · 6.2/5.5 · 2.8/2.5 |
| 1000 | 0 | poll / hint / direct | 73 / 70 / 66 | 4304+504190 / 3862+503551 / 3897+507584 | 29.8/39.6 · 28.8/27.6 · 26.8/25.7 |


The 100/300ms hint path can add a fetch RTT, while direct carries events in its first response. Shared polling amortizes tasks already; this single run is not a protocol recommendation. Do not compare its GET count with network-lab's per-task polling fixture. Event-loop scheduling changes timings between runs.

Progress batching (0/10/40ms, one burst task) gave 23/19/16 JSON responses; urgent events bypass the progress batch timer. Simulated reconnect pauses requests for 550ms, while 128 × 4096-character transcript chunks (~512 KiB) accumulate. The compact hint queue overflowed and explicitly signaled a gap; bounded pages recovered all 132 events. Its peak 4072 bytes under 4096-byte cap is the **sum of serialized hint entries**, not the full response frame (envelope, HTTP headers, TCP buffers excluded). Retained authoritative events have independent 2 MiB cap; 64-event and 32 KiB full-JSON-frame page caps are asserted. Oversized events are rejected before cursor increment; exhausted retention or changed epoch reports history unavailable, not silent replay. Restart discards in-memory history.

Strict TS, four unit tests, 19-run completeness/queue/page assertions passed on Node 24.21.0. This experiment did **not** measure TCP backpressure, RSS, packet counts, actual disconnection, compression, real LLMs, or Mac/SSH WAN. Test real link and UX before choosing a production protocol; instrument socket write/backpressure and RSS under bandwidth impairment before claiming slow TCP-reader safety. Toxiproxy bandwidth rates, if later used, are KiB/s, not B/s. See also [network-lab](network-lab.md) and [wire-bench](wire-bench.md).

## Parent integration check

Integrated original c63d2f5 as a0a8293 and review 77e871f as ac76cd6. Parent ran all 19 scenarios on Node 24.21.0 and replaced results.json; table above is the parent run. Added a full-frame exact-boundary test and used the longer JSON false boolean when sizing final pages (one-byte overrun avoided). Formatted source. The worker worktrees remain recorded in experiment-plan.md.

These timings include a cold handshake while events are already being generated. At high latency that extra startup RTT dominates; do not treat the table as steady-state performance of a connected client. Next separate warm connected event delivery from cold reconnect/catchup. Direct data-bearing long-poll removes the hint/fetch RTT, but this is still an application-delay simulation, not TCP backpressure proof. Values unchanged: existing proof and bounded-use rules apply.
