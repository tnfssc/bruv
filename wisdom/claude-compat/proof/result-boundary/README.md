# Exact idle blocker: upstream queue lost wakeup

**Official acceptance remains FAIL. No connector runtime or upstream production code was changed.**

Resumed task_7ca41761 on b1649b54 with its lifecycle and human-command changes already present. The copied throwaway instrument retained the side-effect-free `emit.construct` plus actual Queue offer; the earlier emit-function-wrapper traces are not evidence here. No untracked node_modules was copied.

## Cause, not metadata

T3 ships Effect **4.0.0-rc.115**. `Stream.fromQueue` pulls with `Queue.takeAll -> takeBetween`. `takeBetweenUnsafe` observes an empty queue, then returns a separate `awaitTake` callback effect. A cooperative yield can occur before that callback registers the taker. If the producer offers in this gap, it sees zero takers and schedules no release. `awaitTake` then registers a taker without rechecking the queued messages. The consumer sleeps with genuine terminal events already enqueued.

This is **not** a stuck scheduled timer: no wake was scheduled. It is also not a closed subscriber, foreign SDK result, adapter guard rejection, ingestion exception, or rendering-only failure.

### Actual failing boundary

- [Adapter trace](adapter-command-finalize.ndjson): the zero-model result is human-owned, echoes the expected consumed UUID, matches the live query, enters and leaves `finalizeActiveTurn`. Its awaited artifact/terminal offers finish. The buffered historical trace hashes the context echo-state too; `9599915bd8cd62b6` is the hash of `confirmed`.
- [Queue trace](diagnostic-command-queue/queue-sequence.ndjson): subscriber **5** ingests/tracks the reply item and the stop predicate returns **false**. It never closes. The manager awaits publication of completed provider-turn, provider-thread and terminal signals to that same subscriber.
- Before those last offers, its open queue has **2, 3, 4** pending messages, **zero takers**, `scheduled:false`, no dispatcher tasks and no running dispatcher. No subsequent receive/route occurs. The correct decoded zero-turn success and idle are retained in [assessment](assessment.json) and [provider evidence](diagnostic-command-queue/final-provider-evidence.json).
- [Shipped bytes](shipped-queue-excerpts.txt) identify the exact unchecked registration. T3 already patches this dependency, but its existing patch does not touch Queue or Scheduler.

## Smallest required upstream change

[upstream-effect-queue.patch](upstream-effect-queue.patch) adds only a progress recheck after `self.state.takers.add(resume)`: if messages or pending offers exist, invoke the queue's existing `scheduleReleaseTaker`. In Effect source the equivalent belongs in `src/Queue.ts`; for this T3 pin the supplied hunk can extend its existing dependency patch in `dist/Queue.js`.

It does not consume/drain messages itself, end a queue, invent a terminal event, force idle, wait on a timer, change prompts/origins/work counts, or add a second scheduler. No upstream patch was applied to production.

[Deterministic dependency regression](reproduce-queue-race.mjs) injects an offer at that exact Effect operation boundary. The original `takeAll` hangs with one message, one taker and no scheduled wake. The recheck returns the **identical offered signal**. [Result](queue-race-result.json). This isolated logical queue test is not SDK/native acceptance evidence; its deadline only detects the original blocked operation, and shutdown is test cleanup.

## Validation and limits

| Artifact | Result |
| --- | --- |
| Original official continuation | [FAIL](official-continuation-before/result.json): real continuation reply persists, next input remains blocked |
| Queue-state-only diagnostic | [FAIL](diagnostic-command-queue/result.json): correlated zero-model question-open result, live subscriber misses terminal signals |
| Waiter-recheck throwaway T3 | [Human PASS](diagnostic-human-recheck/result.json): actual command idle, saved answer resume and used-once callback |
| Same throwaway T3 | [Continuation PASS](diagnostic-continuation-recheck/result.json): actual next reply **and idle in original root**, actual normal worker, original strict gate |
| **Last replay: official unchanged T3** | [FAIL](official-final/result.json): first genuine `/bruv status` reply persists, Stop stays visible for 30 seconds; **zero model calls** |

The corrected diagnostic SHA is `7dc2db5a13d734c70685e3591999e378e3be09d97a25c286efb6e99ecb4e0d24`, never an acceptance/product artifact. Last official SHA stays `2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795` before and after. [Provenance](provenance.json). The unchanged official failure is the final status; **do not claim fixed or unblock packaging**.

[25 focused tests pass](focused-tests.txt); [typecheck passes](typecheck.txt), explicit Bun 1.4.2. A stale merged command test still expected unsupported `auto-continuation` for an epoch with no consumed input; only that assertion was aligned with the existing `unclassified` contract. No frontend/runtime protocol code changed.

The replay harness now reuses its already prepared initial native draft, actually selects the native project on subsequent New thread actions, handles observed already-complete onboarding, gives setup provider-card rerenders their own timeout, and guarantees server cleanup even if trace capture fails. None weakens the same-root reply+idle gate. Initial setup failures remain local diagnostic artifacts, not idle evidence. Cancelled approval-card Decline, unsupported-version/update banners, and unrendered child tool-result access remain separate known gaps.

## Replay (fresh proof directories)

```sh
export TMPDIR=/var/tmp
BUN=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun
UP=/home/tnfssc/Code/bruv/.cache/acp-t3-upstream-experience
P=wisdom/claude-compat/proof/result-boundary
"$BUN" scripts/build-claude-compat.ts --outfile=.cache/queue-proof-connector

# Smallest real reproduction, unchanged official T3. A failure stops at the first idle gate.
TRACE_SUITE=command T3_UPSTREAM="$UP" BRUV_CONNECTOR_EXECUTABLE="$PWD/.cache/queue-proof-connector" PROOF_OUTPUT="$PWD/.cache/queue-OFFICIAL-fresh" /usr/bin/node "$P/run-trace.mjs"

# Throwaway only: assets/browser modules are read-only symlinks; official binary is never overwritten.
DIAG="$PWD/.cache/T3-DIAGNOSIS-queue-fresh"
mkdir -p "$DIAG/platform"
for f in "$UP"/platform/*; do n=$(basename "$f"); [ "$n" = t3 ] || ln -s "$f" "$DIAG/platform/$n"; done
ln -s "$UP/runtime" "$DIAG/runtime"
/usr/bin/node "$P/instrument-artifact.mjs" "$UP/platform/t3" "$DIAG/platform/t3" --subscriptions-only
TRACE_SUITE=human ACCEPT_HUMAN_CONTROLS=1 T3_UPSTREAM="$DIAG" BRUV_CONNECTOR_EXECUTABLE="$PWD/.cache/queue-proof-connector" PROOF_OUTPUT="$PWD/.cache/queue-trace-fresh" /usr/bin/node "$P/run-trace.mjs"

# Corrective counterfactual only; run after the previous server has exited.
/usr/bin/node "$P/instrument-artifact.mjs" "$UP/platform/t3" "$DIAG/platform/t3" --subscriptions-only --recheck-waiter
TRACE_SUITE=human ACCEPT_HUMAN_CONTROLS=1 T3_UPSTREAM="$DIAG" BRUV_CONNECTOR_EXECUTABLE="$PWD/.cache/queue-proof-connector" PROOF_OUTPUT="$PWD/.cache/queue-human-recheck-fresh" /usr/bin/node "$P/run-trace.mjs"
TRACE_SUITE=subagent T3_UPSTREAM="$DIAG" BRUV_CONNECTOR_EXECUTABLE="$PWD/.cache/queue-proof-connector" PROOF_OUTPUT="$PWD/.cache/queue-root-recheck-fresh" /usr/bin/node "$P/run-trace.mjs"

# Always run official again LAST; only its unchanged hash can count as final acceptance.
TRACE_SUITE=command T3_UPSTREAM="$UP" BRUV_CONNECTOR_EXECUTABLE="$PWD/.cache/queue-proof-connector" PROOF_OUTPUT="$PWD/.cache/queue-OFFICIAL-last-fresh" /usr/bin/node "$P/run-trace.mjs"
```

For the isolated dependency regression:

```sh
mkdir -p .cache/effect-queue-repro
/usr/bin/curl -qfsSL https://registry.npmjs.org/effect/-/effect-4.0.0-rc.115.tgz -o .cache/effect-queue-repro/source.tgz
# Expected SHA256: 96ddab67e773a3a3153a08a6eec0c8f6b6927e15db29f3752f5f503c9158fc78
sha256sum .cache/effect-queue-repro/source.tgz
tar -xzf .cache/effect-queue-repro/source.tgz -C .cache/effect-queue-repro
"$BUN" "$P/reproduce-queue-race.mjs" .cache/effect-queue-repro/package
```

Actual compiled connector and loopback model only; no credentials, devices, paid inference, release, packaging, push, installed binary changes or upstream production changes. Private server logs are retained only in `.cache` throwaway outputs and must never be copied into committed proof. Values unchanged: existing actual-consumption, one-owner, truthful UI/evidence and no-second-scheduler rules already require keeping this upstream blocker open.
