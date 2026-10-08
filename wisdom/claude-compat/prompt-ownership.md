# Native prompt ownership at Pi consumption — 2026-10-04

Fixes the proven P1 in [focused integrated review](focused-integrated-review.md), using its durable reviewer reproduction rather than a new research sweep.

## Correction

The pinned Pi 1.0.0 public high-level prompt/steer/followUp options do not expose the constructed user message. Bruv's existing hash-checked Pi-host adaptation now adds **onUserMessageCreated** to those same paths. It observes the actual user object after input handlers/template expansion, including queued messages. It neither consumes input nor starts/schedules another turn.

Runtime retains the inbound native UUID against that object (WeakMap), and preserves it in the derived native journal. Only Pi's real **message_start(role=user)** marks it consumed. Frontend derives supported user_message_uuid/user_message_uuids on early stream frames, assistant snapshots and settled results. A run that actually consumed human input has human origin; a pure consumed task wake has supported **task-notification** origin (the intermediate auto-continuation projection was not a pinned SDK origin; see the post-integration correction below). UUID-less priority=now input (observed from actual T3) still counts as consumed human input, without inventing a client UUID. Existing high-level session.steer/prompt(followUp) remain authoritative; no abort/restart steering or second queue/scheduler.

## Focused proof

- Committed race: real Pi + execute + TaskManager shell completion, autonomous model gate, HUMAN_NEW gated in the actual emitInput preflight. Initial/human UUIDs remain distinct; automatic result carries no human UUID. The unmodified official adapter predicates now recognize it as foreign after the initial early echo establishes echo mode.
- Predicates are pinned verbatim from official T3 **fed41fa88bb27cb4325cb208d571393850bc63c2** in tests/claude-compat/native-adapter-prompt-ownership.ts.txt. BRUV_T3_CLAUDE_ADAPTER_SOURCE also compares/runs the exact local official source seam (used here).
- Actual queued now/next consumption: identical source prose transformed by an extension, no premature UUID echo, correct consumption-order UUID aggregation. Spy verifies genuine high-level steering does not call abort. Actual UUID-less native steer shape covered.
- Native journal regression retains the exact two inbound UUIDs for repeated prose, while real tool results/assistant frames remain source-entry-bound.
- Bun **1.4.2**, typecheck, focused runtime/task-binding/transport and hash/idempotency/partial-host checks. Full pi-host suite initially lacked this worktree's normal dist/bruv; no old binary was substituted to claim that suite passed. Native browser uses the required real **/home/tnfssc/Code/bruv/dist/bruv**.

## Actual native browser evidence

Official unchanged T3 **v0.0.46-nightly.20261003.2623**, SHA256 **2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795**, pinned SDK **0.3.276** declarations; real compiled connector, default native browser path, unique ports/state, deterministic loopback model with explicit not-Claude identity, no real credentials/devices/providers, no T3 patch, no release/bundle removal.

The original main default harness was rerun against the corrected connector. Its visibility-only acknowledgement gate remains intermittent. A worktree replay reached its old visibility PASS, but its actual screenshot still places CANCELLATION_COMPLETED_REAL above the cancellation request. That is **not accepted UI proof**. See [redacted browser/wire/item evidence](proof/prompt-ownership/observed/assessment.json) and the retained cancellation-expanded DOM text.

Passive WebSocket capture was installed before browser navigation and flushed **before cleanup**. The actual T3 projections retain distinct cancellation acknowledgement/completion message IDs and distinct nodes, both linked to the cancellation user's same run. Their actual ordinals are **7000003 -> 7000004**, and their timestamps are ordered **03:04:05.159Z -> 03:04:05.184Z** in the retained run. The DOM nevertheless renders the completion near the first response. Thus frame UUID collision or incorrect native result attribution is not an established remaining cause of this chronology defect; no unsupported connector field or forged output was added to hide it.

The driver now retains both acknowledgement assertions **and** requires request -> acknowledgement -> completion DOM order. Legitimate killed-job completion is neither suppressed nor rewritten. Wire/item projections expose hashed identities, origins, order and narrowly allowlisted fixture markers, not private payloads. The actual gated worker is byte-copied into short scoped state so a long worktree path cannot truncate its scenario argument out of Bruv's bounded command preview; model responses are unchanged.

Subsequent first-run replays also observed a setup selector blocker (Local folder option timeout, zero model calls); this is separately reported, not blamed on runtime ownership or repaired by changing unrelated human-dialog code. Final strict replay status is recorded in the handoff/proof artifacts.

Values unchanged: existing one-owner, accepted-vs-consumed, truthful-evidence and no-second-scheduler values already cover this correction. Lesson added here: even distinct correctly linked native items plus marker visibility do not prove rendered chronology.

Exact main-default replay after native journal UUID retention: [result](proof/prompt-ownership/main-default/result.json) remains **failed at CANCEL_CONFIRMED_REAL visibility**, with one genuine cancellation completion wake. The actual compiled connector and normal main binary are hashed in invocation.json; original acknowledgement gate was not weakened.

Final 46-test focused run: **45 pass / 1 fail** (all four ownership regressions pass). The unchanged actual SDK two-shell/worker binder assertion once received timestamped worker stdout rather than canonical journal assistant text; an earlier focused run passed all 45 tests. See [test outcomes](proof/prompt-ownership/test-outcomes.json). No unrelated task-binding code or assertion was altered to conceal this observed failure.

## Final strict rendered PASS (not the old visibility-only pass)

The final compiled connector passed the strengthened default native browser replay, including genuine steering, Stop/reload, retained cancellation acknowledgement, **request -> acknowledgement -> legitimate completion DOM chronology**, reopening and continued use. [Strict result](proof/prompt-ownership/strict/result.json), exact hashed wire/T3 item projections, artifact hashes and text evidence are retained; historical screenshots were retired (see [artifact retirement](../quality/protocol-artifact-retirement.md)). The ready task-cancelled text positions are 1062 -> 1207 -> 1239, not the premature cancellation-expanded snapshot taken before the async fold finished expanding. One actual cancellation completion wake; no output rewrite or suppressed killed-job notification.

The unmodified main-path harness failure and setup-selector timeouts above remain historical observed blockers; one strict PASS is not a claim that every old UI/setup race is eliminated. No independent repeat strict PASS was attempted. The worker-summary assertion passed its unchanged isolated rerun (1 test / 8 assertions); the earlier suite failure remains recorded rather than erased.

## Post-integration lifecycle correction — P1 still open

[Exact owner/decoded SDK/shared-event proof and handoff](proof/same-root-lifecycle/README.md). Supported consumed task provenance, per-turn init, and actual running/settled-idle are now projected. 177 focused tests and typecheck pass, but the rebuilt connector still fails strict same-root Stop-hidden: correct next human reply/result and actual idle are decoded while run 4 persists running. UUID ownership, true steering, the TaskManager owner and busy assertions remain intact. Not an accepted P1 fix. Values unchanged for the reasons in the handoff.
