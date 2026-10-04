# Bounded UI-only connector admission proof

This tests Bruv-owned admission, not T3 UI/parity or an upstream fixed release.
No paid provider access, credentials or ordinary user state are used. The fixture
creates throwaway HOME, Claude sentinel and an explicitly selected Bruv home.
The local HTTP server counts any model request; success/fail probes must send zero.

Reproduce after `bun run build` with the separately acquired, pinned
`@anthropic-ai/claude-agent-sdk@0.3.276` package:

~~~sh
# Use a supported Node executable; keep the parent environment credential-free.
env -i PATH="$PATH" HOME=/tmp GIT_CONFIG_GLOBAL=/dev/null \
  node wisdom/claude-compat/proof/ui-only-admission/sdk-preflight.mjs \
  /absolute/path/to/claude-agent-sdk/sdk.mjs \
  "$PWD/dist/bruv-claude-compat" "$PWD/dist/bruv"

BRUV_CLAUDE_SDK_PATH=/absolute/path/to/claude-agent-sdk/sdk.mjs \
BRUV_REQUIRE_CLAUDE_SDK=1 \
BRUV_CLAUDE_COMPAT_TEST_BINARY="$PWD/dist/bruv-claude-compat" \
BRUV_CLAUDE_COMPAT_TEST_BRUV="$PWD/dist/bruv" \
  bun test tests/claude-compat*.test.ts tests/claude-compat tests/t3/web-launcher.test.ts
~~~

These are **test process bindings**, not T3 startup instructions. Production
setup is normal T3 launch + provider-instance binary/homePath/env only.
See ../../ui-only-admission.md and ../../external-t3-setup.md.
