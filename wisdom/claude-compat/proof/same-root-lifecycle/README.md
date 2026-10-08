# Native same-root lifecycle — post-integration P1 remains OPEN

> Follow-up (2026-10-04): the exact blocker is now proved as an upstream Effect Queue empty-check/waiter-registration lost wakeup, not SDK result metadata. See [focused diagnosis and minimal upstream patch](../result-boundary/README.md). Corrective throwaway T3 passes the strict root and command idle gates; the last unchanged official T3 still fails. This historical FAIL remains valid; do not claim product fixed.

2026-10-04. Focused protocol correction and diagnostic handoff, **not an accepted idle fix**.

## Actual pinned contracts

[SDK declarations](sdk-contract.txt) are 0.3.276. Task-event provenance is task-notification; auto-continuation is not an SDKMessageOrigin member. Unknown non-human input is unclassified. Attribute task wakes only on actual Pi consumption of task-complete/task-attention custom messages. Human consumption retains priority and actual offered UUIDs. Job lifecycle observation alone does not prove consumption.

The SDK defines init as metadata emitted each turn and session_state_changed idle as authoritative turn-over after the result. [Direct shipped adapter bytes](shipped-adapter-excerpts.txt) identify init as turn start and preserve the prompt UUID/origin classifier. Connector init/running now follows the actual Pi run start; result/idle follows actual agent_settled (or handled command completion). Auxiliary requests stay non-streaming. No fake model prompts, timer drains, result replays, forced backend idle, root replacement or synthetic human UUIDs. Runtime steering and the single TaskManager owner are untouched.

## Final strict result: FAIL

[Assessment](assessment.json), [result](result.json), [DOM](failure.txt), [same-root checkpoint](same-root-return-evidence.json), [final decoded SDK + shared application events](final-provider-evidence.json).

- Original root and actual query owner; no replacement between input and result.
- Offered next prompt id-75 is echoed by ROOT_AFTER_CHILD_REAL assistant/result, origin human, one model turn. SDK decodes the result at per-thread sequence 74, then actual idle at 75, native session id-7.
- Shared event sequence 136/137 leaves provider turn 4 running. 138/139/140 records completed reply node/message/turn item. No completed provider-turn update follows. Run 4 and its provider turn persist running with null completed_at.
- Browser has the real next reply but Working/Thinking and Stop remain. The unchanged Stop-hidden gate fails. Cancellation/Stop roots are intentionally not admitted afterwards.
- Remaining discontinuity is between decoded SDK input and adapter/provider terminalization. Exact cause inside that boundary is **not established**. Do not claim these lifecycle corrections fixed the P1 or blame rendering alone.

An earlier origin-only diagnostic replay passed all three roots once; other replays failed at admission or next-reply idle. That intermittent pass is not final connector acceptance. The final artifact here failed its strict UI gate.

## Regression and replay

Supported Bun 1.4.2 explicit. [177 tests pass / zero failures](focused-tests.txt), [typecheck passes](typecheck.txt). Actual Pi regressions cover task provenance, human priority, unknown custom provenance, per-generation init, no idle before settlement and unchanged genuine steering. Pinned SDK filesystem tests enabled. Diagnostic tests preserve owner/sequence/shared-event status and exclude private prompts/auth.

The entrypoint now forwards explicitly supplied TMPDIR through its sanitized replay and connector/T3 environments; setting it only outside previously did not reach Chromium or T3. Final replay uses /var/tmp throughout. Final capture does not depend on a live page. No T3 code, cli.ts, installed binary, global settings, release/bundle paths or credentials changed.

Replay with fresh proof output:

    TMPDIR=/var/tmp /home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun scripts/build-claude-compat.ts --outfile=.cache/task-wake-final-connector
    TMPDIR=/var/tmp BRUV_CONNECTOR_EXECUTABLE=$PWD/.cache/task-wake-final-connector PROOF_OUTPUT=$PWD/.cache/new-unique-proof /usr/bin/node scripts/claude-native-acceptance/run-subagent.mjs

[Invocation](invocation.json) pins connector and real normal worker hashes. Worker is /home/tnfssc/Code/bruv/dist/bruv. Unmodified T3 v0.0.46-nightly.20261003.2623 SHA256 2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795. Original parent failure is retained in parent-before-*.

Next investigation: trace actual adapter result dispatch/finalizeActiveTurn against the complete owner/SDK/shared-event sequence. Keep the strict actual-next-reply **and idle** gate; a completed reply item is not a completed run.

Wisdom corrects the formerly claimed supported auto-continuation origin and records stronger boundary evidence. Values unchanged: existing one-owner, actual-consumption, truthful-evidence/UI and no-second-scheduler rules already require keeping this P1 open.

Historical failure screenshots were retired; the result, DOM text and protocol evidence remain. See [protocol artifact retirement](../../../quality/protocol-artifact-retirement.md).
