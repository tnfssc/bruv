# Integrated acceptance checkpoint — 2026-10-03

## Actual checks

- Five Node endpoint/negative-protocol tests pass.
- Real normal Bruv RPC fixture smoke passes: execute, managed background shell,
  early return, actual job completion wake; five local model requests, zero
  endpoint errors. This is **not** a native connector/T3 pass.
- Original synthetic fixture refusal/readiness unit regression passes. No new
  synthetic UI proof is claimed.
- Actual newly built bruv-claude-compat was launched by official external T3
  v0.0.46-nightly.20261003.2623. The native initialization control request reached
  the real process; it exited 1 with:
  **[bruv-claude-compat] --settings is not yet bound in the Bruv connector**.
- Official T3 binary SHA-256 before/after is identical:
  2cc42990ee8ad2ff30bbd43cdcf67686c9ca5aaff5e3ed36b5be40962cc53795.
- Rendered provider readiness remains Needs attention / Unsupported. The actual
  customModels row shows bruv-acceptance/local-deterministic-v1 with the honest
  local deterministic (not Claude) label. No model turn ran in T3.
- Temporary scoped state removed; no real credentials, purchases, devices,
  production edits, T3 patches, fake account fields or version impersonation.

## Committed evidence

[Observed evidence](proof/integrated-acceptance/observed/): actual rendered
custom model/readiness frames, sanitized protocol launch/initialize/error
projection, official binary integrity, tested connector/normal binary hashes,
zero model calls and cleanup. runtime-smoke-result.json is clearly separate
from the failed integrated result.

Harness: [scripts/claude-native-acceptance](../../scripts/claude-native-acceptance/README.md).
It parameterizes the original native-ui-fixture/replay.mjs rather than replacing
T3 or emitting fixture native events.

## Next gate (not yet passed)

Parent binds --settings, --setting-sources, actual probe permissions and native
MCP/session semantics; rerun the precise command in the harness README. The
implemented but unobserved UI driver then checks real execute + shell task
lifecycle, steer during tool, early-return/completion wake, generation Stop,
explicit job stop/inspection, reload/reopen and continued same-session use.
It must fail if actual native lifecycle or wake output is missing.

Permission and saved-question UI actions are deliberately not fabricated. Their
model requests are reusable, but enabling those cases currently fails with a
clear binding gap. Add actual admission, saved answer/resolve, denial and rendered
human controls when parent binds them. Shell acceptance does not prove normal
subagent/profile inheritance; SDK fork/home alignment and broader parity stay
parent-owned. No endpoint/RPC pass upgrades this native integration failure.

Values unchanged: this applies existing truthful proof, actual human controls,
one-owner lifecycle and safe-data principles; no new general rule was needed.
