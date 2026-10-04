# Command admission metadata does not close native idle settlement

**Blocked, not PASS.** Parent baseline d13ac61d. No runtime/model/autonomous
settlement changes; task_8c7b2393 owns that seam. No T3 source edits, release,
packaging, providers, credentials or devices. Bun 1.4.2 and TMPDIR=/var/tmp.

## Exact inspected native contract

Pinned unchanged official T3 v0.0.46-nightly.20261003.2623, SHA-256
2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795.
Read its embedded SDK 0.3.276 and matching source-nightly
apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts:

- claudeAcknowledgedPromptUuid reads type=command_lifecycle, command_uuid.
  Lifecycle states acknowledge dispatch/fate; completed does not finalize a run.
- claudeEchoedPromptUuids accepts user_message_uuids / user_message_uuid.
- handleSdkMessage releases held root output when its prompt UUID is echoed.
- handleSdkMessageFrame drops zero-turn **task-notification** results for normal
  prompts, not correlated **human** results. Foreign zero-turn results are also
  dropped before release. A human success is supposed to reach finalizeActiveTurn.
- SDK Query.readMessages/readSdkMessages forwards lifecycle/results; no zero-turn
  workload filter exists there.

The scoped change publishes started on received /bruv admission, then completed
(or cancelled after real interrupt) **after** the genuine result. Resume keeps
its command UUID until real Pi agent_settled; commandHandled does not fabricate
an early model result. Ordinary/autonomous epochs get no command metadata. Zero
model turns/tokens/cost remain zero; tool flags and capabilities are unchanged.

## Real negative evidence and next seam

Strict first-command /bruv status fails both original frontend and lifecycle
candidate. Removing the model-style received user echo also fails (experimental
artifact only; source retained the received echo). The unchanged T3 native logger
decodes the actual human success, source UUID, zero turns and completed frame;
its canonical root run and provider turn still remain running. The final correlated
question proof shows expectedPromptHash=c57742641560baab on the running native
provider turn, exactly matching the command sourceHash and terminal echo; this
is **not** a foreign zero-turn result. No Stop/reopen
was used to force completion in any strict test.

The full saved-question attempt passes real execute allow/deny, deliberate Stop
and no side effect, real reload recovery, pending identity, and actual saved answer
with resume-needed delivery. It then fails the idle gate after /bruv questions
open emits its genuine zero-turn success/completed pair. Explicit resume is **not
reached**, so it is not claimed proven. Previous parent observed proof remains
historical evidence with its explicitly documented Stop workaround.

Remaining shared seam: native UUID-correlated zero-model result routing through
ClaudeAdapterV2.handleSdkMessage -> handleSdkMessageFrame -> finalizeActiveTurn /
turn.terminal projection, not command admission or provider workload accounting.
Metadata alone is insufficient. Coordinate with the parent's general settlement
worker before broad frontend/runtime changes or another composed PASS claim.

## Checks

- 15 focused lifecycle + human consent/ledger unit tests PASS.
- 4 focused real-runtime command/interrupt/question regressions PASS.
- bun run check PASS; actual connector built locally.
- Broader runtime run: 33 PASS, one existing background-shell PID readiness test
  fails (also fails isolated; no changes made to that unrelated test).
- Initial two UI attempts failed native bootstrap hydration (disabled New thread).
  Harness now waits for actual enabled native ready/empty-state action; these
  failures are retained, not reclassified as command-idle evidence.

Every attempt directory retains result/invocation/cleanup and rendered failure
where available, with hashed wire/ledger identities. No raw scoped T3 state or
native log payload is committed. Cancelled approval-card behavior remains the
separately documented upstream gap; it is not changed here.
