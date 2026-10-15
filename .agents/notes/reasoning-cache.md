# Thinking level changes and the Codex prompt cache (`src/reasoning.ts`)

2026-10-16. On `openai-codex-responses`, Pi puts the thinking level in the top-level
`reasoning.effort`. Changing it mid-session (Shift+Tab, `/model`) changes the request prefix, so
the whole conversation misses the prompt cache. A third-party Pi extension solved this by keeping
the top-level effort fixed and adding `{ type: "configuration_update", reasoning: { effort } }`
input items where the level changed. We read its code as a reference only and did not run it.

## What bruv does

- Only for `api === "openai-codex-responses"` and model ids `gpt-6-*` or `gpt-6.N-*`, and only
  when the payload's `model` is the session model. Skipped when the request has
  `truncation: "auto"` or a non-empty `context_management` (the reference says updates must not be
  used with those). Skipped when any effort in play is not `low`..`max` (for example `off`, which
  maps to `none` on gpt-6-sol); the reference accepts only those five values.
- Nothing new is saved. Pi already writes a `thinking_level_change` entry on every change (and one
  at session start), with a timestamp. Each request walks `ctx.sessionManager.getBranch()` and
  works out the effort each saved assistant reply was made with. The first reply of the current
  run sets the pinned effort; a later reply with a different effort gets an update item placed
  just before its first input item; if the current request's effort differs from the last one
  shown, an update goes at the end of the input.
- Mid-stream changes: Pi saves the change entry before the reply that was streaming, but the
  provider already read the old level. A change counts for a reply only if its entry time is not
  after the reply's `timestamp` (set when the request started). Otherwise it waits for the next
  reply or the current request.
- Positions: Pi turns each assistant reply into reasoning, message and function_call items whose
  ids come from the saved reply (`thinkingSignature` JSON id, `textSignature` id, tool call id
  before `|`). We map those ids to their first index in `payload.input` and insert there. This does
  not depend on how many items user, tool result or summary messages produce. A reply with no items
  in the input (failed or dropped) gets no marker; the next found reply carries its own effort.
- Several changes before one request become one update. Changing back to the shown effort adds none.
- Run restarts: a compaction entry, or a `model_change`/assistant reply from a different
  provider/model. The first request after a restart is sent unchanged; its effort is the new pin.
  After a compaction the prefix changes anyway, so starting fresh costs nothing and drops stale
  updates for kept messages. The reference changelog says the same for its compaction.
- Registered before `registerCodexCompaction`, so the payload it saves for native compaction
  already has the pinned effort and updates.
- Pi's WebSocket continuation (`openai-codex-responses.js`, `getCachedWebSocketInputDelta`)
  needs every field except `input` to match the last request and the old input to be a prefix.
  Pinning the effort and inserting at the end keeps both true, so delta requests keep working.

## Verified locally

- `tests/reasoning.test.ts`: a real Pi session with real `thinking_level_change` entries. Each
  request keeps the first effort, starts with everything the previous one sent, and puts updates
  at the expected indexes, including a change made while a reply streamed and two changes before
  one request. Opening the saved session file again builds the same request. Compaction restart,
  model switch, `truncation: "auto"`, a GPT-5 Codex model and a non-Codex API are covered.
- During development the same test passed with Pi's own `convertResponsesMessages` building the
  input. Biome forbids deep Pi imports, so the test now uses a small converter with the same item
  shapes.

## Not verified (needs a live Codex account)

- That the Codex backend accepts `configuration_update` items on GPT-6 models and applies the
  effort from that point, and that cached tokens actually stay high after a change.
- Whether `configuration_update` is accepted after an encrypted `compaction` item, and in the
  request bruv sends for native compaction (the reference says it survives native compaction).
- Whether the backend accepts `none` in an update; we avoid it by skipping those runs.
- Branch walking runs on every GPT-6 Codex request (Pi rebuilds context the same way). If long
  sessions show it in profiles, keep a running result keyed by leaf id.
