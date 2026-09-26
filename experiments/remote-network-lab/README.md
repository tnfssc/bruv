# Remote network lab (experimental, simulated)

Docker Bun remote task owner + Toxiproxy + host Bun client (Linux standing in for Mac). No LLM, SSH, macOS, provider, authentication, real capabilities or production code. No home or Docker socket mounted. Owner state lives in its own Docker volume; transcript on host disk. Ports loopback-only: 18783 owner, 18784 impaired client, 18785 proxy admin. No credentials.

## Reproduce

Requires Docker Compose and Bun 1.2.23. Images pinned by digest. If Bun unavailable on host, extract binary from same pinned image:

    n=$(docker create oven/bun:1.2.23); docker cp "$n":/usr/local/bin/bun /tmp/die-network-lab-bun; docker rm "$n"
    BUN=/tmp/die-network-lab-bun
    D='docker compose -f experiments/remote-network-lab/compose.yaml -p die-network-lab-86a7ae68'
    $D up -d
    $BUN experiments/remote-network-lab/setup.ts
    $BUN test experiments/remote-network-lab/client.test.ts
    $BUN experiments/remote-network-lab/demo.ts > /tmp/network-lab-results.json
    LAB_REPLICA=/tmp/network-lab-transcript.json $BUN experiments/remote-network-lab/client.ts launch my-task needs-mac
    sleep 1
    LAB_REPLICA=/tmp/network-lab-transcript.json $BUN experiments/remote-network-lab/client.ts sync
    LAB_REPLICA=/tmp/network-lab-transcript.json $BUN experiments/remote-network-lab/client.ts reply my-task fixture
    sleep 1
    LAB_REPLICA=/tmp/network-lab-transcript.json $BUN experiments/remote-network-lab/client.ts sync
    $D stop owner
    LAB_REPLICA=/tmp/network-lab-transcript.json $BUN experiments/remote-network-lab/client.ts offline
    $D down -v # removes this project's containers, network and owner volume

Shell snippets use POSIX shell; set BUN and D appropriately in fish. Port collision? Change compose published ports and client/admin URLs together. Demo requires owner up; it removes temporary replicas and resets toxics but retains owner history. Setup is idempotent. Do not down -v if retaining outcomes. Do not expose unauthenticated endpoints beyond loopback.

## Protocol and assertions

JSON v1: POST /launch {v,id,spec}, spec plain or needs-mac; POST /reply {v,id,text}; GET /events?cursor=N&limit=1..20 returns {v,events,next,more}. Each event has v, monotonic seq, id, kind, text, at. /head yields latest cursor for benchmarking without old history; normal new replicas start at 0. Caller-stable ID retries with same spec return replayed:true; changed spec conflicts. Acceptance is persisted before HTTP reply; reply is deduplicated. Owner persists tasks and append-only events by atomic rename. Host validates contiguous sequence then atomically replaces replica cursor+events. Lost acceptance response is retried, not relaunched. Offline status derives running/waiting/unknown/done from disk. Plain tasks continue after client disappearance. Needs-mac waits for a response: stand-in for on-demand file/skill/capability/CLI request, not actual transfer. Restart marks in-flight tasks unknown, never fabricated complete. No automatic restart/resume or transactional exactly-once guarantee.

Demo asserts detachment, discarded acceptance response, dedup/conflict, durable question/reply, outage/catchup and page limit 1. Unit test checks offline disk read with unreachable fetch and rejects noncontiguous event pages. Page size max 20; append-only history and replica storage not bounded. Primitive polling is not an agent scheduling design.

## Measurement

See results.json and ../../wisdom/remote-workspaces/network-lab.md. Three sequential plain tasks/condition. Each reports host-observed time from launch start to acceptance, first visible progress and completion visibility in milliseconds. Serialized application payload bytes: UTF-8 JSON request body + URL path and JSON response body; counts through completion. HTTP headers, framing, retransmissions, TCP bytes NOT counted. /head setup and proxy admin excluded. GET page 10; poll every ~25ms. Injected 100 or 300ms latency EACH direction means request RTT minimum ~200 or 600ms plus processing. Bandwidth 1024 bytes/s each direction toxic barely affected small messages (buffer/burst). Outage disables proxy while owner stays up. Samples depend on scheduling/timer cadence, not p95. Mac+one server only; thousands of agents, auth, transport security, storage scaling, real Mac offline behavior, real file transfer and provider agents untested.
