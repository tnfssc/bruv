# Network lab: Docker owner and impaired host client

Code and commands: [README](../experiments/remote-network-lab/README.md). Original worktree /home/tnfssc/.die/worktrees/die-a86675007a5e-task_86a7ae68, branch die/remote-disconnect-ux-lab-86a7ae68, commit 1dfb5e1. Integrated into parent as d6c87e9, then reviewed and rerun. Production unchanged.

## Parent-verified results (2026-09-26)

Host Linux, Bun 1.4.2. Owner Docker Bun 1.2.23, Toxiproxy 2.9.0, images pinned by digest. Host is a Mac stand-in, not macOS. Unique Compose project, loopback ports, no credentials or home/socket mounts. Container CPU/memory/PID caps bound this fixture, not a production agent fleet.

Three sequential scripted tasks per condition. Median host-observed milliseconds from launch; task itself takes about 460ms. Application bytes include JSON bodies and URL paths, not HTTP/TCP overhead. Raw samples are in wisdom/experiments/remote-network-lab/results.json.

| condition | accepted | first visible progress | visible done | requests | request bytes | response bytes |
|---|---:|---:|---:|---:|---:|---:|
| baseline | <1 | 156 | 465 | 21 | 556 | 1326 |
| 100ms injected each way | 202 | 404 | 831 | 4 | 136 | 647 |
| 300ms injected each way | 602 | 1204 | 1806 | 3 | 110 | 607 |
| 1 KiB/s each way | 466 | 1168 | 1620 | 3 | 113 | 621 |

100ms each way is roughly 200ms minimum request RTT, not 100ms. Small samples, no p95 or internet-reliability claim. Bandwidth toxic rate is KiB/s. Initial worker set 1024 but labeled it 1024 B/s; that was really 1024 KiB/s and its result is superseded. A separate 16,384-byte response took 1ms at baseline and 2,072ms with an 8 KiB/s downstream cap. That one-transfer check verifies the toxic has an effect, not broad throughput performance. HTTP headers matter especially for small packets and are not counted here.

## What passed

- Discard a received launch response, retry same ID/spec, get one accepted event. Different spec conflicts. This is client-side discard, NOT a genuine lost TCP acceptance reply.
- Remote task continues during absence of client requests, reaches saved Mac-input question and waits. Reply retry is deduplicated. Mac input is only a string fixture, not an actual local tool capability.
- Disable proxy after accepting an independent task. Owner finishes. Cached accepted state remains readable offline, and three missing events catch up in 2ms after link restore with page size 1 (no latency toxic during this catchup).
- Runner stops owner and then asserts host disk transcript still shows completed offline-proof. Final observed cursor 63. Tests also reject a cursor gap before replica persistence.
- Two network unit tests pass, including proxy admin DELETE with empty 204 body. Joined with wire tests: eight pass. Strict standalone TypeScript checks pass.

## Review fixes and limits

Parent fixed empty DELETE JSON parsing, bandwidth units, object-prototype task lookup, cursor-ahead rejection, missing await in a rejection test, module declarations and types. Added bounded request deadlines, max-page validation, automated run/cleanup script, container limits and bulk bandwidth probe. Formatted source. A run launched while owner restart was still pending failed with ECONNRESET; readiness now belongs in runner. No silent general-purpose retry added.

Owner uses an append-only logical log but rewrites the whole state JSON file on every event. Replica also rewrites in full. Atomic rename is not an fsync/power-loss transaction guarantee. Total history/storage and catchup round trips are unbounded; page event count is bounded. This does NOT demonstrate bounded slow-consumer socket queues or memory. Restart code marks running tasks unknown, but restart recovery is not validated as a resumable workflow. Runtime epoch/reset reconciliation remains missing.

25ms polling caused 21 baseline requests for a tiny task. Next compare a bounded long poll/stream and batched catchup. Do not ship this polling or whole-file persistence as a scalable design. Need true ambiguous TCP delivery, larger history, local capability permissions, Mac sleep/wake, SSH/provider auth and real-agent integration tests. All runner-owned containers, networks and volumes were removed after the parent run.

Values unchanged. Existing truthful proof, safe recovery, bounded use and complete experience values cover the findings.
