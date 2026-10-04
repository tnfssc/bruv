# Native T3 / alternate Claude executable UI proof

Follow-up to spike0c89514a. Research fixture only, not the production engine.

## Finding

The unmodified official T3 nightly accepts this independently authored, locally ready Claude-protocol executable without an Anthropic account. A successful SDK initialization probe with no account object is mapped by native T3 to **Authenticated**. That label projects this configured executable’s readiness; it is **not verified Anthropic authentication**. The instance is named **Bruv Claude-protocol research fixture**. No email, org, subscription, token source, external credential, licensed service, or provider inference is asserted or fabricated.

The proof exercises native prompt rendering, steering during a controlled active operation, synthetic subagent/monitor progress display, real Stop, and persisted conversation after actual browser reload. Native **Queue message → Steer** produces a user frame with **priority: now**, not just an SDK interrupt test. Stop produces an **interrupt** control request and **Run interrupted by user** UI state. Task cards explicitly say **not Bruv execution**.

## Read-only source check

External upstream: `/home/tnfssc/Code/bruv/.cache/acp-t3-upstream-experience`.

- `source-nightly/apps/server/src/provider/Layers/ClaudeProvider.ts`: version probe, SDK initialize, optional get_usage; successful capabilities yield ready/authenticated even without account fields. No genuine account is required by this alternate local executable seam.
- `source-nightly/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`: task_started/task_progress/task_notification projection.
- `source-nightly/apps/web/src/components/settings/ProviderInstanceCard.tsx`: **Select Claude** and form input IDs (Display name/Binary path lack associated accessible labels in this build).
- `source-nightly/apps/web/src/components/chat/QueuedRunsControl.tsx`: queued-run **Steer** control.

No production code, T3 source, build output, installed binary or release was edited. Replay asserts external executable SHA-256 unchanged before/after.

## Exact replay commands

From the worktree/repository root:

```sh
/usr/bin/node wisdom/claude-compat/proof/native-ui-fixture/test-fixture.mjs
/usr/bin/node wisdom/claude-compat/proof/native-ui-fixture/replay.mjs
```

Reuses the existing official platform/t3 and Playwright; no download/install/build. Overrides: `T3_UPSTREAM`, `BROWSER_PATH`, `FIXTURE_PORT` (18783), `PROOF_OUTPUT` (fresh .cache/claude-native-ui-replay-proof-TIMESTAMP directory; explicit override must not already exist). A fresh `.cache/claude-native-ui-replay` runtime is removed in finally. Do not launch concurrent replays with that runtime name. Pairing tokens, browser cookies, auth DB, raw wire/system/MCP instructions and private server output remain runtime-only and are deleted. Retained wire projection contains only direction/type/subtype/control/priority/status, never payloads or argv.

Pickup: scripts here and **observed/** sanitized snapshots, wire projection and result. Boundary tests assert default auth/initialize refusal outside explicit `SPIKE_PROTOCOL_ONLY=1` and absent account fields inside fixture mode.

## Limits and observed corrections

- Synthetic deterministic text/events only. No Bruv jobs, real subagent work, external inference, quality, production integration or broad compatibility claim.
- Honest fixture version **0.0.1** retains T3’s unsupported-version warning (>=2.1.280 suggested) and update notice. Both are nonblocking here; no official Claude version was impersonated to suppress them.
- Actual page.reload is followed by reopening the tested thread. Persisted messages/steer/interrupted state are checked; automatic detail-selection restoration is not claimed.
- T3’s default model catalog/display is not a fixture capability claim. get_usage reports limits unavailable, no subscription/account metadata.
- Harness discoveries/corrections: first-run onboarding, missing label association, refresh naming/timing, hidden sr-only title interception, and default queue-vs-steer controls.
- Fixture correction: terminalize a superseded synthetic task or T3 correctly remains waiting on it. Native code was not changed.
- Initial non-Git project produced native checkpoint warnings. Clean replay initializes a nested isolated Git repo before startup, avoiding the parent checkout.
