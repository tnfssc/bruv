# Network lab: local Docker owner + impaired host client

Branch: die/remote-disconnect-ux-lab-86a7ae68. Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_86a7ae68. Code/report: experiments/remote-network-lab/. No production edits. This is deterministic simulation, not SSH/Mac/LLM/provider proof. Read README for rerun/cleanup.

## Observed (2026-09-26)

Docker Bun 1.2.23 owner, Toxiproxy 2.9.0; host Linux Bun 1.2.23 extracted from pinned image. Unique Compose project, loopback-only published ports, no home or Docker socket mounts, no credentials. Three sequential tasks per condition, polling ~25ms; medians from committed raw results.json:

| condition | injected one-way latency per direction | launch accepted | first visible progress | visible done | requests | app request bytes | app response bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| baseline | 0ms | 1ms | 158ms | 472ms | 21 | 596 | 1374 |
| latency | 100ms | 203ms | 404ms | 834ms | 4 | 139 | 654 |
| latency | 300ms | 603ms | 1205ms | 1807ms | 3 | 112 | 613 |
| 1024 B/s toxic both directions | 0ms | 1ms | 161ms | 479ms | 21 | 601 | 1399 |

Injected one-way latency in EACH direction is not observed RTT: 100ms toxic yields ~200ms minimum request-response, 300ms yields ~600ms. App bytes are JSON body plus request URL, NOT TCP/wire bytes, exclude headers, retransmission, admin requests and benchmark /head initialization. Tiny payloads did not visibly react to bandwidth toxic (likely buffering/burst); don't infer throughput. Baseline high request count is 25ms polling; larger RTT naturally reduced request count. For low overhead prefer bounded incremental pages + event-driven notification/long poll in subsequent designs, without relying on eager transcript sync. Samples are small, no tail-latency evidence.

Durability demonstration: discarded launch acceptance response then retry stable ID -> one accepted event; spec mismatch rejected; disconnected task proceeds to a Mac-only question and waits; client reconnects, supplies answer, eventually done; plain task finishes during proxy outage and incremental page=1 catchup completes afterward (observed reconnect catchup 1ms for three missed events); offline snapshot during outage retained accepted status. Separately stopped owner container and ran host offline CLI: transcript showed completed offline-proof while server was down. Owner restart marks in-flight work unknown, not seamless recovery. Unit test: 1 pass, offline read and cursor validation. Demo assertions passed. On-disk owner outcomes and host transcript survive process stop; owner volume is intentionally deleted in cleanup.

## Design boundary / next step

Keep autonomous Linux task ownership independent of Mac connection. Mac retains offline transcript and resolves only blocked dependencies; capability/file/skill/CLI transfer here is represented ONLY by a question string and reply, no actual capability access. Global event log / atomic full-file rewrite, unauthenticated local HTTP, fixed port, busy polling, unbounded transcript and no secure transport are lab constraints, not rollout architecture. Never claim thousands-agent scaling from this run. Actual Mac host sleep/wake, SSH/network boundary, lost mid-flight TCP packets, model/agent callbacks, TCP bytes and auth need separate trials. No values.md edit: existing values on truthful proof, durable status and isolated experiments already capture lesson.
