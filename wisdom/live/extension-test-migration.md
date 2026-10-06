# Shared-editor extension test migration

Only `tests/live-extension.test.ts` changed, plus this requested handoff. No product changes or commit.

- Fixture uses real TuiMainScreen raw routing, release filtering, focus changes, and CompactEditor.attachPushToTalk. A scoped getActiveCompactEditor spy supplies the existing editor; only drawing/device/provider boundaries are simulated. Cleanup restores the getter and stops each fixture.
- Replaced panel assertions with muted-by-default (including omitted config mode), actual repeat-triggered holds, draft/cursor preservation, capture epochs, stale/untagged rejection, immediate release, cancellation/repeat lockout, legacy inactivity timeout, dialog Space ownership, terminal focus loss, and stop-without-commit coverage. Startup must not call custom UI; detach restores typing and keyboard protocol.
- Compact status asserts Voice / Speaking / Listening wording and no PCM waveform churn, while retaining native drain, interruption flush, and timer cleanup checks. Transcript assertions now distinguish sanitized active drafts from completed shared-history input; no behavior assertion was dropped merely to pass.

Validation:

`env PATH=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin:/usr/local/bin:/usr/bin:/bin SHELL=/bin/sh bun test tests/live-extension.test.ts`

73 pass, 0 fail, 424 assertions. TypeScript `tsc --noEmit`, owned-file Biome check, and owned-file `git diff --check` also pass. Shell startup emits an existing untrusted mise.toml warning; explicit Bun commands still run as requested. No trust changes, devices, credentials, or paid provider calls.

Parent retains terminal acceptance and product ownership. No remaining extension bug found by this focused migration.
