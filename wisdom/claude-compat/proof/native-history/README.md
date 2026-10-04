
# Actual native history acceptance

2026-10-04; source baseline 156e2450. **PASS** (not a marker-only verdict).
See [history note](../../native-history.md) and
[reusable harness](../../../../scripts/claude-native-acceptance/README.md).

Published proof is curated from the final actual run, not the earlier preserved
FAILED run. Nine genuine loopback model requests; result and cleanup both passed.
Official T3's SHA-256/version and actual connector/paired-runtime checksums are in
observed/result.json and invocation.json. See build-checks.json for Bun/compiler
and focused checks. No runtime/history.ts changes or upstream binary edits.

Evidence to inspect:
- actions.json: ten completed native UI actions.
- root-before-fork/fork-before-continue/final-disk.json: exactly one root side
  effect throughout; one root native exchange before/after fork, two total after
  fresh child inspection; original raw hash unchanged; fresh canonical identities,
  complete imported SDK provenance and source mappings.
- model-projection.json + model-checks.json: actual role/tool-call/result IDs and
  parsed completed root job/pending question output; empty child authority output;
  imported paired exchange reaches the initial child request. Bruv legitimately
  compacts earlier context during inspection; later requests use that real summary.
- final-disk.json: raw abandoned child future remains stored; active parent chain
  branches from the selected checkpoint and excludes it on rollback/reopen.
- history-wire-projection.json: real connector input/output/lifecycle, native IDs,
  tool_use/tool_result references and streamed events. No fabricated native frames.
- root-checkpoint/fork-created/child-continued/old-branch-unchanged/before-rollback/
  rollback-action/rollback-continued/reopened PNG+text pairs: manually reviewed
  checkpoint, fork divider, unchanged original, rolled-back draft and reopened
  child, all with explicit local deterministic model identity.

Scoped filesystem paths are replaced with <SCOPED>/<RUNTIME> in text projections.
No credential descriptors, tokens, raw auth/config, real provider responses or
system prompts are published. Chat screenshots contain only isolated test work;
provider-settings screenshots were omitted because they display local host labels.
The visible unsupported-version/update warning is real T3 behavior; no Claude
identity spoof, install or update was used to hide it. It did not block these gates.
sha256-manifest.json binds the published evidence bytes.

Known failed iterations informed narrow fixture fixes: background summary rejection,
transitioning fork draft route, update-toast interception, crowded /tmp Chromium
ENOSPC, long TMPDIR Unix socket path and a post-run verifier incorrectly demanding
pre-compaction tool output on a later already-compacted request. None is counted
as a passing run or evidence of a history.ts defect. Parent's human/delegation/full
integration gates are outside this history result.
