# Remote task network lab

A deterministic task owner runs in Docker. A Linux host client stands in for the Mac. Toxiproxy sits between them. This is not an LLM, SSH transport, Mac app, or production remote mode.

## Run

From the repo root, with Docker Compose, curl and Bun (parent tested 1.4.2):

```sh
bash wisdom/experiments/remote-network-lab/run.sh
# Optional output location:
LAB_RESULTS=/tmp/network-results.json bash wisdom/experiments/remote-network-lab/run.sh
```

The runner starts a unique Compose project, waits for readiness, runs tests and the demo, reads the saved transcript with the owner stopped, and removes its containers/network/volume on exit. It uses fixed loopback ports 18783 (owner), 18784 (impaired link), 18785 (proxy admin). Do not run two copies at once. Images are pinned by digest. Containers have CPU, memory and PID limits. No home, credentials or Docker socket mounted. No paid calls. The owner volume is disposable; cleanup deletes its outcomes.

For manual exploration, use the commands in run.sh but keep the Compose project up. Host CLI:

```sh
LAB_REPLICA=/tmp/transcript.json bun wisdom/experiments/remote-network-lab/client.ts launch my-task needs-mac
LAB_REPLICA=/tmp/transcript.json bun wisdom/experiments/remote-network-lab/client.ts sync
LAB_REPLICA=/tmp/transcript.json bun wisdom/experiments/remote-network-lab/client.ts offline
LAB_REPLICA=/tmp/transcript.json bun wisdom/experiments/remote-network-lab/client.ts reply my-task fixture
```

Sync again after the reply. Offline/status never fetches the owner. A Mac capability is ONLY a saved question/reply here, not actual Mac file/CLI access.

## Protocol and proof

JSON v1: POST /launch {v,id,spec}, POST /reply {v,id,text}, GET /events?cursor=N&limit=1..20. Each event has a monotonic seq, task id, kind, text and time. Repeated launch ID/spec or reply text returns the saved status. Conflicting launch spec/reply rejects. Acceptance is written before HTTP reply. Owner and client use atomic file replacement, not a transactional crash-safe database or power-loss guarantee.

Demo covers discarded acceptance response plus stable-ID retry, detached continuation to a question, saved question/reply, proxy outage during independent work, and incremental catchup with pages of one event. It discards a received acceptance response; it does NOT yet cut TCP after server acceptance but before delivery. The runner also stops the server and asserts completed transcript can still be read from the host disk.

On restart, owner marks in-flight work unknown rather than claiming recovery. Cursor ahead of owner is rejected. No runtime epoch/reset reconciliation implemented. History is unbounded on disk and rewritten in full; event pages are count-bounded, not proof of bounded total storage or a slow-client socket queue. The wire bench separately models byte/time batch limits.

## Measurements

See results.json and [findings](../../remote-workspaces/network-lab.md). Three sequential tasks per condition; report medians, not tail-latency claims. Time is host-observed from launch to acceptance, first progress and visible done. The scripted task takes about 460ms unimpeded.

Injected latency is applied EACH direction: 100ms means about 200ms minimum request RTT; 300ms means about 600ms. Toxiproxy bandwidth rate is KiB/s, not B/s. The current tiny-message case uses rate=1. A separate 16KiB transfer at rate=8 verifies throttling is taking effect. Earlier rate=1024 results were mislabeled as 1024 B/s and are superseded.

Application byte counts include UTF-8 JSON bodies and request URL paths only. They omit HTTP headers, TCP framing/retransmission, proxy admin and /head benchmark setup. With tiny requests, omitted HTTP overhead can matter a lot. Baseline polls every ~25ms; request count is a warning against using this polling scheme in production. No compression is enabled in the transfer probe.

Limits: unauthenticated loopback HTTP, whole-file storage, fixed ports, no real task queue/LLM, no Mac/SSH/auth/capability transfer or fleet-scale proof. Future work should test event-driven subscriptions, actual network-loss retry, large transcript catchup and real Mac tools before making product promises.
