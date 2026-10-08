# Explicit compatibility identity and defaults (2026-10-04)

This is a bounded local proof, not a provider/MCP/auth/full-parity claim.
The user explicitly requested a compatibility version and ordinary Bruv defaults.

## Observed

- Compiled connector --version: `2.1.280 (Bruv compatibility; bruv 0.16.3)`.
- Compiled --bruv-version: exact `bruv-claude-compat 0.16.3`.
- Existing compiled normal Bruv --version: `0.16.3` (unchanged source/main CLI).
- Actual Agent SDK **0.3.276** initializes the compiled connector without any
  inference call. Empty account, exact fixture model, Bruv product metadata and
  locally unverified access remain honest. System init reports protocol 2.1.280
  separately from bruv.version. Local loopback chat then succeeds.
- Unchanged official T3 **v0.0.46-nightly.20261004.2644**, SHA-256
  `53fbd1c78ab3a01ea91913f65dc17b9d7824f00a81564e06992a73e183054e48`,
  parses 2.1.280, no **Unsupported version** warning, and renders a genuine native
  answer for custom `fixture/fixture-model` through the actual Pi runtime.
- The UI probe runs with **neither BRUV override**, normal helper as a real sibling,
  ordinary auth home under the fixture HOME, explicit provider SDK homePath and
  **no server-level CLAUDE_CONFIG_DIR**. It performs no real auth mutation, global
  configuration, install/update, provider/MCP/device login or paid request.
- T3 still renders its own **Authenticated** label for local readiness, built-in
  Sonnet 5.5's 2.1.284 advisory, and latest-Claude update notification. These are
  not Bruv account/provider claims. **Never let its updater overwrite the wrapper.**
  We do not fake model names or claim every banner disappeared.

[Settings text](observed/settings.txt) · [chat text](observed/chat.txt) ·
[result/artifact identity](observed/result.json). Text replaces only owned temp
paths; no tokens/logs/auth files are retained. Private server logs and owned
runtime are removed by the probe. Browser/T3 executable are not modified.

## Reproduce

Use an isolated verified official 2644 cache containing platform/t3 and
runtime/node_modules/playwright, a real normal worker, and local Chromium.
Run these in this checkout; no global install is needed:

~~~sh
bun install --frozen-lockfile
bun scripts/build-claude-compat.ts --outfile=.cache/bruv-claude-compat
bun test tests/claude-compat-defaults.test.ts tests/claude-compat-launch.test.ts \
  tests/claude-compat-preflight.test.ts tests/t3/web-launcher.test.ts \
  tests/claude-compat-runtime.test.ts
BRUV_CLAUDE_COMPAT_TEST_BINARY="$PWD/.cache/bruv-claude-compat" \
BRUV_CLAUDE_COMPAT_TEST_BRUV=/absolute/normal/bruv \
BRUV_CLAUDE_COMPAT_TEST_SDK=/absolute/agent-sdk-0.3.276/package/sdk.mjs \
  bun test tests/claude-compat-compiled.test.ts
T3_UPSTREAM=/absolute/verified-2644-cache \
BRUV_CONNECTOR_EXECUTABLE="$PWD/.cache/bruv-claude-compat" \
BRUV_RUNTIME_BINARY=/absolute/normal/bruv \
BROWSER_PATH=/absolute/chromium/chrome \
PROOF_OUTPUT="$PWD/.cache/version-defaults-fresh" \
  node wisdom/claude-compat/proof/version-defaults/realT3.mjs
bun run check
~~~

The realT3 profile uses the actual connector's declared 2.1.280 compatibility
identity, not a synthetic version tap or fake protocol events. Inference replies
come from a labeled loopback OpenAI-compatible model through real Pi.

## Exact checks and resolved failures

- Focused source suite: **22 pass, 0 fail, 132 assertions**; its isolated runtime
  child additionally runs **25 runtime checks** successfully.
- Compiled suite with actual SDK: **3 pass, 0 fail, 153 assertions**. Includes
  no-inference init, default auth-home reuse, unchanged fixture auth, stream,
  structured auxiliary output, genuine normal-child dispatch, failures before
  history/MCP/tool allocation, and default-Claude/symlink isolation.
- Final combined run: **25 pass, 0 fail, 285 assertions across 6 files**.
- `bun run check`: passed (TypeScript + prepared assets).
- First test attempt lacked worktree dependencies/assets; installed locally with
  frozen lockfile and prepared assets. No tracked dependency change.
- First fish-shell PATH assignment broke shell-child runtime fixture; rerun with
  explicit bash PATH passed. No runtime behavior weakened.
- First compiled attempt exposed a removed-but-still-used product metadata import;
  restored it. Two legacy assertions assumed the old version and an absent
  ordinary agent directory/auth file. Updated them for the requested shared
  default, checking fixture auth content stays empty instead.
- Packaging/update migration remains the packaging owner's work. Old 0.16.3's
  exact whole-string --version check cannot accept this compatibility output;
  new tooling must use --bruv-version. This proof does not certify legacy update,
  the future thin launcher, cross-platform release, native fork, paid access or
  full T3 parity. No push/release/global install was performed.

Historical browser screenshots were retired; the text captures and compatibility conclusions remain. See [protocol artifact retirement](../../../quality/protocol-artifact-retirement.md).
