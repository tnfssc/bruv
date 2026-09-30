# Hosted native fixture phases (2026-09-30)

## Failure and boundary

Hosted run **36780027410** failed at upstream NativeDieIntegration.production.test.ts:633: one marker-bearing parent request expected, two observed (log: /home/tnfssc/.die/ci-full-cache-cold-failure.log). The fixture intentionally emits the same execute identity/code twice. Its execute-result marker persists in replay **and** terminal request history; it is not a request-phase identity.

Changed only the fixture in canonical integrations/t3/upstream/die.patch. No product behavior, root tests/CI, or timeout changes.

## Deterministic script

- Record explicit initial/replay/terminal requests and responses. Require that exact sequence (one per phase), two identical execute-code responses, two completed parent runs, and one projected execute output.
- Both execute responses still contain identical code/tool identity. Hand off only while the success child is pending. On replay the idempotently recovered child is completed, so proceed to the terminal request instead of handing off a second time and racing continuation scheduling.
- Hold the terminal response behind an explicit barrier. Before releasing it, assert only initial/replay responses exist and exactly one parent run is completed. Then wait for the terminal assistant message, both completed runs, terminal children, and consumed result transfer.
- Replay and terminal requests both contain the execute-result marker in a tool message; the initial request does not. Counting marker-bearing histories cannot replace phase assertions.
- Preserve exact success/nested request counts, two parent-owned children, one result transfer/output, unauthorized MCP rejection, scoped credentials, and PID/session-file teardown. Also assert one cancelled-child run, one nested child, nested cancellation, and identical successful cancel/cancel-again statuses. Existing cancellation request allowance is untouched, not widened.

## Focused proof

Isolated clone .cache/native-fixture-isolated at pinned upstream b488c57f3f9f1688e31c53daee99e29dd1d0baa2, canonical patch applied. Original fixture matched prepared reference source byte-for-byte. Reused prepared dependencies; never edited the other worker's source. Parent binary /home/tnfssc/.die/worktrees/die-a86675007a5e-task_23c5c02a/dist/die reports **0.15.14**, SHA-256 ea003aed59815bb85c77915de318eb3393e8c399eae61b7b8a713ab62d0cebaf.

From isolated apps/server, run with TMPDIR=/home/tnfssc/.die/tmp-pi-removal and T3_V2_DIE_BINARY pointing to that binary:

    ../../node_modules/.bin/vp test run src/orchestration-v2/NativeDieIntegration.production.test.ts

Final real integrated test passed **1/1** (12.71s total, 6.64s test); earlier passing run 12.64s. Terminal ordering is forced/delayed by the fixture barrier, not a sleep or larger timeout. Final log: /home/tnfssc/.die/tmp-pi-removal/native-fixture-final.log.

Negative control: temporarily restore the old marker-history count assertion in the isolated fixture. It deterministically fails expected 1/got 2 after terminal settlement; restored final source afterward. Log: /home/tnfssc/.die/tmp-pi-removal/native-fixture-old-filter-negative.log.

Initial barrier experiment with unconditional replay handoff timed out: second handoff can prevent a terminal request entirely. That fixture-only issue motivated conditional handoff; no runtime fix was justified.

Regenerated only this new-file diff using Git, then applied the **entire** canonical patch to a fresh upstream temporary index; extracted fixture equals tested source byte-for-byte. Full hosted pipeline is the parent's next gate, not run here.

Values unchanged: existing real-failure/real-path and simplest-solution guidance already covers this local fixture lesson.
