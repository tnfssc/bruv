# v0.16.2

## Codex-aligned fast mode

- Fast mode forwards the selected model unchanged on official OpenAI and Codex endpoints. Removing the stale model-name allowlist unblocks aliases such as `gpt-6.1-sol` without guessing future catalog support.
- Both supported surfaces request `service_tier: "priority"`, matching official Codex Fast semantics. Provider availability errors remain visible; there is no hidden model swap or retry.
- The footer reports the selected Fast on/off setting instead of reclassifying it from response-tier observations. Existing response callbacks still receive raw events.
- Premium-cost consent, exact session/branch/model authorization and endpoint/auth checks remain required. `/fast off` explicitly selects the default tier; untouched models are not overridden.

## Limits

This does not promise provider latency, premium availability or live account credits. Native task-backend inheritance remains separate follow-up work. The long-thread and external T3 [v0.16.1 limitations](https://github.com/tnfssc/bruv/releases/tag/v0.16.1) still apply.
