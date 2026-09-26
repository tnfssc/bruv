# Remote UX experiment round

## Scope

User approved discovery and proof-of-concept code on 2026-09-26. First target is MacBook interactive coordinator plus one Linux server running independent tasks. Dream is many agents on many hosts; test protocol overhead at scale without claiming simulated agents prove real fleet capacity.

Keep production untouched in this round. No real provider credentials or paid calls. Docker daemon 29.6.2 and Docker Compose v5.0.1 are available here. Host is Linux, not a Mac. Toxiproxy CLI not found locally; network worker will use its container. Prior research remains in this directory, including latest user corrections in offline-first-direction.md.

## Work owners

Base commit: a173cd28b80d2ea328d7abc03b5587b86d471e61. Independent durable worktrees:

- task_86a7ae68: end-to-end Docker + Toxiproxy disconnect/catchup UX lab. Path /home/tnfssc/.die/worktrees/die-a86675007a5e-task_86a7ae68, branch die/remote-disconnect-ux-lab-86a7ae68. Owns experiments/remote-network-lab and network-lab.md.
- task_da069f45: standalone compact event/batching/compression and 1/100/1000 simulated agent benchmark. Path /home/tnfssc/.die/worktrees/die-a86675007a5e-task_da069f45, branch die/compact-agent-wire-experiments-da069f45. Owns experiments/remote-wire-bench and wire-bench.md.
- task_3f1110f2: real die RPC loop with fake deterministic provider in Docker. Path /home/tnfssc/.die/worktrees/die-a86675007a5e-task_3f1110f2, branch die/real-agent-loop-remote-placement-probe-3f1110f2. Owns experiments/remote-agent-probe and remote-agent-probe.md.

Parent reviews results, runs integrated commands, and joins measured findings. Workers must commit and record limits. No overlapping code files. Current research notes are uncommitted parent files; worker prompts carry latest decisions because fresh worktrees do not contain them.

## UX checks

- Launch accepted versus locally pending is visible. Lost reply must not duplicate a task.
- Client detach does not stop accepted independent work. Mac-only needs block only dependent work.
- Questions and outcomes survive presentation disconnect. Reply retry reconciles by identity.
- Reconnect asks for missing events, not whole history or rerun prompt.
- Server offline still leaves a readable local transcript with last synced position. Large missing artifacts say unavailable, not empty.
- Slow consumers do not create unbounded in-memory queues. Backpressure must not silently lose canonical history.
- Server restart is separate from client disconnect; unknown work must be labeled unknown.

## Measurements

Record observed launch acknowledgment, first visible progress, completion visibility and reconnect catchup. Separate task runtime from network/display delay. Include sample counts, payload sizes, p50/p95 only where sample count supports interpretation. Start baseline, injected latency and bandwidth cap, outage/lost-reply. Count serialized application bytes separately from actual TCP/SSH overhead. Test batch latency versus size, output growth, metadata fanout and subscription scope.

No universal latency/scale target chosen yet. Do not optimize a tiny packet at the cost of extra round trips or sluggish first feedback. Prefer fewer unnecessary events/history repeats before inventing binary encoding. Tests with 1000 synthetic agents are protocol load only, not proof of 1000 LLM processes or computers.

## Next handoff

Wait for workers; inspect their commits and run probes. Integrate only experiments and their wisdom. Record measured findings and next missing acceptance test. Real Mac/Linux SSH, provider auth refresh, secure bootstrap and local capability permissions still need later proof.

Values checked; unchanged. Existing end-to-end proof, one owner, bounded queues and safe recovery values apply. New measurements belong with experiments until a repeated broader lesson emerges.

## First wire review

Original wire worker committed a02f3e7. Not integrated yet: readable formatting and fair equal-content comparisons needed. Its 1000-agent case streams only 10 active transcripts, and compact mode omits retained tool blobs. Parent did not accept the 4.12 MB versus 49.3 KB headline as an equal-content offline transcript comparison.
Follow-up task_7bef381e owns review fixes at /home/tnfssc/.die/worktrees/die-a86675007a5e-task_7bef381e, branch die/wire-benchmark-review-fixes-7bef381e, base a02f3e7. Add full transcript delta comparison, preserve all-task status coverage separately, include 1000 active transcripts, format code and strengthen tests. Await commit then integrate both wire commits if checks pass.

## Integration and review status

Integrated agent probe f0301fd -> 2b9be31; network lab 1dfb5e1 -> d6c87e9; wire original a02f3e7 -> 4ad759b and fair-comparison review ea0c345 -> 53fee7e. Parent formatted, fixed and reran labs. Read-only reviewer task_709117b3 caught misleading discarded-response label and stale units; parent renamed result and replaced old measurements. No true dropped acceptance reply or memory-bound proof claimed.

Network lab parent run passed all invariants, server-down transcript read, 8 joined unit tests and strict standalone TS. Its runner owns cleanup. Real-agent probe passed using prebuilt die; artifact version inspection then showed 0.15.1 while repository package is 0.15.3. Do NOT call that artifact a verified same-source-revision build. Parent launched bun run build (task_84f5a0d4) to rerun against current source; log /tmp/die-remote-experiment-build.log. Until that result arrives, provenance remains an explicit limitation.

Newest user proposal: require die preinstalled/authenticated remotely; choose remote model/setup next. Saved in offline-first-direction.md. No installation or credential migration implementation needed for initial remote proof.

## Round complete

Full build hit missing pnpm. Existing --reuse-web build path rebuilt current CLI successfully (0.15.3); web archive reused, not validated. Current-source actual-agent probe passed: detach 315ms, second model turn 3486ms, completion observed 4323ms during/rejoining a four-second no-client-request window. See agent notes for artifact hash. Network runner and wire benchmark reran; eight unit tests, strict standalone TS, shell syntax and diff checks passed. No production code edited, no full production suite run. Read experiment-findings.md for synthesis and next thin vertical slice. Experiment resources cleaned up; durable worktrees kept for handoff. Values unchanged for reasons in findings.
