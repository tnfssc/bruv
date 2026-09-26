# First remote UX experiment findings

## Where to run things

Use Mac as interactive coordinator and local transcript reader. Linux owns accepted task agents and questions. User now suggests requiring die already installed and authenticated on Linux. That removes bootstrap/credential copying from the first product slice. A remote default task profile can choose provider/model/settings; launch should echo resolved config rather than silently inherit Mac defaults. This profile choice is a proposal, not implemented.

## Runnable pieces

- [Network lab](../../experiments/remote-network-lab/README.md): bash experiments/remote-network-lab/run.sh. Docker, Toxiproxy, scripted task owner, durable host transcript, questions, disconnect/catchup. Parent reran with Bun 1.4.2; results and limits in [network notes](network-lab.md).
- [Wire benchmark](../../experiments/remote-wire-bench/README.md): bun experiments/remote-wire-bench/bench.ts 42. Deterministic 1/100/1000 task fixtures, both 10 and 1000 active at total 1000. No sockets/model calls. See [wire notes](wire-bench.md).
- [Actual-agent probe](../../experiments/remote-agent-probe/README.md): bash experiments/remote-agent-probe/run.sh with a built die binary. Actual packaged RPC agent, fake model, two execute calls in Linux Docker while no host requests arrive for four seconds. See [agent notes](remote-agent-probe.md) for binary provenance and final run status.

These pieces are separate. We have NOT joined real die agent events into the durable network lab protocol. No production remote API, model selection, or real Mac capability service added.

## What the numbers say

- At 100ms EACH way, accepting a tiny task takes about 202ms. First visible progress takes about 404ms. At 300ms EACH way those become 602ms and 1204ms. Extra serial round trips hurt UX more than saving a few field-name bytes.
- Baseline 25ms polling sent 21 requests for a 460ms scripted task. Do not multiply that design by thousands of agents. Compare one shared event stream or bounded long poll, active subscriptions and paced catchup next.
- At 1 KiB/s, tiny-task visible completion rose from 465ms to 1620ms. HTTP overhead is not in current byte accounting. A separate 16KiB body took 2072ms at 8 KiB/s; units matter.
- For 1000 active synthetic tasks with 32 events each, repeated full-history delivery was 258.6 MB; full event deltas INCLUDING tool output were 23.0 MB. This is equal-content payload accounting, not measured TCP throughput. Avoid history replay first.
- Lazy output events plus batching were 5.05 MB, gzip 1.06 MB, but omit about 17.9 MB of output content and fetch overhead. They are not a complete offline transcript. User wants offline reading, so make what is cached explicit; do not count omission as compression.
- Batching introduced up to 40ms synthetic delay. It reduces logical frame count, not necessarily by the same factor at TCP packet level. Flush acceptance/questions/results promptly in a future UX test rather than blindly batching every event.
- Status deltas help when few tasks change. When every task changes each tick, deltas in this fixture were slightly larger than polling. Sparse traffic assumptions need to stay visible.

## Review corrections

Fixed an empty proxy DELETE response parser, wrong bandwidth units, missing test await, cursor-ahead detection and object-prototype task IDs. Added readiness and cleanup runner, request deadlines, container resource caps, readable formatting and strict TS checks. Relabeled discarded reply as discarded, not truly lost in transit. Kept a real no-client-request interval in actual-agent probe. Found old prebuilt die version; do not equate matching worktree HEAD with binary provenance.

## Next useful experiment

Build one thin vertical slice, not a mesh scheduler: remote version/profile handshake -> actual die task -> persisted event cursor -> local cached transcript. Preinstalled/authenticated remote die is the prerequisite. Then add one allowlisted on-demand Mac capability with visible waiting when Mac is gone.

Test real mid-flight acceptance/reply loss, larger transcript catchup, server epoch reset, cancellation during disconnect, and slow-consumer byte bounds. Use a real Mac/Linux SSH pair before claiming that UX. LLM auth refresh and task profiles need their own checks. Thousands of live agent processes/hosts, secure bootstrap, production retention, audio forwarding and cross-server reachability remain unproven.

Values reviewed across all three probes. No new value added. Existing values already require whole-experience proof, truthful evidence, one owner, bounded use and recoverable IDs. These measured tradeoffs and local fixes belong here, not as new broad rules.

## Second round

The actual agent is now joined to persisted events and a local offline transcript in [task POC](../../experiments/remote-task-poc/README.md). Fake provider, real die tools, explicit remote profile, per-run bearer, launch dedup, fsynced bounded event log and completed-owner restart epoch check. Still no question/reply or on-demand Mac capability in this actual-agent path. It runs on Linux containers, not a real Mac/server SSH pair.

[Stream probe](../../experiments/remote-stream-probe/README.md) compares polling, compact hints plus fetch, and direct data-bearing long-poll. Parent reran 19 cases. One-task baseline needed 18, 10 and 6 GETs respectively. Hints can add an entire RTT before events are visible. Direct delivery is the simpler candidate to explore. Timings include cold handshake; warm delivery remains to measure separately. Four unit tests prove cursor, retention and full-page byte boundaries at this layer, not socket/RSS bounds. Application queue has explicit gap and separately bounded in-memory history.

Next: persist real task questions and replies, then one allowlisted Mac fixture-read capability. Also test a genuinely interrupted running task and mid-flight transport loss. Those matter more than adding more simulated machines now. Keep runtime preinstalled/authenticated for this phase; no credential migration needed.

## Third round

[Failure probe](../../experiments/remote-failure-probe/README.md) now cuts the actual launch response before any bytes reach the client. Parent observed ECONNRESET, zero downstream response bytes, stable-ID retry with one acceptance. SIGKILL during real execute yields persisted unknown after restart without replay. An incomplete replica line fails visibly; no automatic repair claimed. Integrated failure and task runners pass together.

The task POC now models a persisted question and one explicitly configured local file-read capability. Remote does independent work, waits without local peer, and consumes explicit reply/file contents in a real execute transcript after a new RPC prompt. Denial is terminal even without answering the other question; late new replies cannot resume it. These are lab dependency endpoints, NOT native /questions approval support. Fixed typed payload and record-construction issues in review. See task-poc.md.

Real /questions command discovery: existing SDK test passes targeted answer via session.prompt and saves reply metadata for a new turn. The main extension permits parent depth0/non-T3-native sessions; no blanket RPC-mode ban was found. Test real packaged RPC next rather than inventing a second production question service. Also test actual SSH with generated disposable keys, not only HTTP loopback. Both are in flight per experiment-plan.md. Values unchanged; evidence, reuse, terminal ownership and recovery rules already fit.

## Cross-round value review

A repeated bug pattern emerged while joining the probes: a late question reply, capability result or agent_end event could reopen a capped/denied task. Folded this into existing value3 (one clear owner): late events must not reopen an ended task; a new start needs an explicit owner decision. It applies at task lifecycle boundaries, not to every completed conversation turn. A waiting question may legitimately schedule a new turn while its task remains open. No new value added.
