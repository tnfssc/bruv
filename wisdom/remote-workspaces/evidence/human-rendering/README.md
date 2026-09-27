# Compiled human remote acceptance

2026-09-27, Linux compiled CLI with disposable Docker SSH owner and explicit fake provider. The production polling timer ran normally. No real user remote state or provider used. This is actual tmux terminal output, not parsed RPC rendering. Native macOS execution was not available in this Linux workspace; parent owns Mac/release validation.

Compiled CLI SHA256: fcb8f6adc5f7124dd919695dbb3bdfa953889f894b7ca962da7025de8323bd49 (application source through 104152d).

- Typecheck: bun run check passed.
- Focused tests: 87 pass, 2 opt-in skips, 1539 assertions (remote suite plus compact footer).
- Compiled PTY: DIE_REMOTE_PTY_E2E=1 bun test tests/remote-e2e.test.ts — passed in 87.25s. Captures here prove named compact active status, stable polls without appended JSON chat, readable final assistant/status/sync, requested transcript content, offline honesty, cancellation, narrow navigation, and quiet open picker.
- Full normal CLI RPC/Docker/SSH test passed separately in /tmp/remote-final-e2e.log before the final footer/autocomplete-only refinements. Its human transcript assertion no longer parses human chat as JSON; machine assertions remain structured.

Run with existing dependencies and bun scripts/build.ts --reuse-web (existing web assets), then DIE_REMOTE_PTY_ARTIFACTS=<absolute-fixture-evidence-dir> DIE_REMOTE_PTY_E2E=1 bun test tests/remote-e2e.test.ts. Full RPC fixture: DIE_REMOTE_E2E=1 bun test tests/remote-e2e.test.ts.

Transcript capture uses a tall terminal to inspect its complete requested event page, then returns to normal size for offline controls. Conversation status and active-poll proof use the normal 120x35 terminal; choice navigation is also exercised at 50x20. Transcript event/tool content may itself be structured text and is intentionally retained; raw poll/status envelopes are forbidden in ordinary chat.
