# Delegated speech safety

## Owner boundary

GPT Live supplies the raw request plus a provisional delegation snapshot to
`src/live/main-owner.ts`. The owner now uses `terminalTranscriptText` for the
canonical request before `session.prompt`. Its hidden
`gpt-live-delegation-snapshot` still serializes the unchanged source snapshot;
`details.requestText` instead identifies the safe canonical request.

No extra raw `live-transcript` copy is appended. Existing passive fragment records
and the source snapshot remain the audit. Delegation IDs still compare the raw
request and retry the same operation, so sanitation does not weaken idempotency.
Snapshot uncertainty, timing and admission authority are unchanged.

A request without speech provenance is the typed queue path, so its user text is
not sanitized by this change. The regression also checks both paired typed input
and ordinary `session.prompt` preserve identical input bytes.

## Integration blocker for parent

The new owner regression exposes another release blocker outside this worker's
owned files: `src/live/passive-history.ts` reconstructs associated user prose
from raw snapshot fragments. Thus safe canonical owner text is currently replaced
with OSC52 bytes in model context and projected replay. The owner cannot fix this
by changing the snapshot without destroying the required raw source audit.

Parent should apply `terminalTranscriptText` to reconstructed speech at the
passive-history connector (including the historical snapshot recovery path),
retaining the provisional-context fact and raw audit unchanged. Rerun the owner
regression after that integration fix; do not drop its model/replay assertions or
change the audit into a sanitized source.

## Offline validation

Used Bun 1.4.2 explicitly, with its bin directory followed by
`/usr/local/bin:/usr/bin:/bin` and `SHELL=/bin/sh`. Dependency install and
`prepare:assets` succeeded without credential/trust changes. No provider or
device calls were made; assistant streams are local offline fixtures.

- `bun run check`: passed after narrowing the regression's user-message types.
- Focused owner/delegation/request/passive-history suite: **48 passed, 1 failed**.
  The sole failure is the new OSC52 regression at the actual selected-model
  user-content assertion. Before that assertion, canonical prompt, reopened
  session user text, hidden exact source audit, deduplication, and unchanged typed
  input assertions all pass.

Command (prefix all invocations with the explicit PATH/SHELL above):

`/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun test tests/live-main-integration.test.ts tests/gpt-live-delegation.test.ts tests/gpt-live-request.test.ts tests/live-passive-history.test.ts`


## Parent integration

Integrated as 1c8b834c. Parent sanitized both current snapshot reconstruction and legacy speech recovery in passive-history.ts. Raw audit remains unchanged; the canonical request, selected-model context and replay stay safe. The worker regression now passes with the model-context assertion intact. The focused 124-test suite passed, and a separate legacy projection regression was added before the full gate rerun.
