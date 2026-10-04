# Recovered provider retry — 2026-10-04

## Bug and boundary

Reported native thread 690fcb73-bb00-4908-8622-181a9ee5c813 had a socket
error at 17:00:31, recovered tool use at 17:00:58, and final stop at
17:07:53. Durable context_edit omitted the failed attempt, but the connector
kept its in-memory error and published error_during_execution.

The frontend shared one failure slot between assistant errors and terminal
connector failures. A successful message did not clear it. Pi's pinned
AgentSessionEvent declares auto_retry_end.success; agent-session.js emits
success for any stopReason other than error, including aborted.

Keep provider errors separate from terminal failures. Clear only the provider
slot on authoritative auto_retry_end.success. Aborted messages, interruption,
and runtime fail stay terminal and take precedence. Both turn-local slots reset
at begin; retry agent_start within an active run does not reset them. Delivery
failure keeps its existing independent latch and failed flush. A successful
message alone, retry exhaustion, or context rewrite is not recovery authority.
Results and error() use the same effective failure. No new retry or idle rule.

This is not the [provider cleanup timeout](provider-end-cleanup-timeout.md).
Successful model recovery cannot forgive a later lease-release failure.

## Proof and limits

- Offline event replay before the fix: 5 pass, 3 fail (recovered result,
  interruption precedence, runtime-failure precedence). After: 8 pass.
- Regression coverage includes recovered tool use then final stop, exhausted
  retry, absent recovery confirmation, Pi's aborted-success case, interruption,
  terminal runtime fail, next-run reset, and failed delivery after retry success.
- Focused retry, command-lifecycle, and prompt-ownership suites: 11 pass,
  41 assertions; prompt-ownership runs its SDK fixtures in a separate process.
- Typecheck, scoped format, and diff check pass. Scoped lint exits 0 with the
  existing frontend assignment warning and string-template advice.
- Fixtures make no provider requests. No live native replay, full suite,
  install, existing active-session change, PR, or release acceptance claimed.
- Runner mistake: execute process.execPath resolved installed bruv, not Bun.
  The first attempt launched a new Codex session (four model requests, recorded
  estimated cost $0.091182; not billing proof). Verification was rerun with bun
  explicitly. The no-provider-call constraint was not met.

Values unchanged: one owner, honest state, and clearing at the right boundary
already cover this. The local lesson is that upstream retry success can include
abort; only the recoverable error belongs to that recovery boundary.
