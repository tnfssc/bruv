# Official development branch: canonical source migration

## Decision and provenance

The user chose official `t3code/codex-turn-mapping` now, not a stable-release
fallback. Canonical `integrations/t3/upstream/source.json` pins
`66a91077f9abf6e171aad0ceab2519d7272f3ff3`; its parent includes official Pi 1.0
support (#14688, `de95adc33`) on top of official Pi support (#7211). HEAD is
Stop/background-work ownership fix #14636. This is a development-branch adoption.

The old pin `b488c57f3f9f1688e31c53daee99e29dd1d0baa2` was itself a V2
commit, not established stable ancestry. The assigned clone is shallow:
`merge-base --is-ancestor` returned 1 and `merge-base` found no common result.
No descendant/stable ancestry was assumed. The migration is an explicit source
replacement, not a mechanical rebase.

Durable source: `/home/tnfssc/.bruv/worktrees/t3-upstream-first-4eb8a4a8`.
HEAD stays at the official pin with the reviewed source changes in its working
tree/index. `bruv-previous-canonical` preserves the old patched source as a local
reference branch. Existing main caches were not edited. Dependency trees were
copied as diagnostic references, and workspace imports repointed to the actual
new source. No provider credentials, user state, installed Bruv binary, release,
push, or version bump was used. Lockfile-only validation installed no packages.

## Ownership reduction

`integrations/t3/upstream/bruv.patch` is exported only by
`integrations/t3/build/regenerate-patch.ts` from the actual source; its disposable
index verification passed. No textual patch/hash surgery.

Baseline: **1,948,956 bytes; 302 files; 15,595 insertions; 19,582 deletions**.
The final exported delta is **342,749 bytes; 71 files; 5,840 insertions; 245 deletions**.
This is **82.4% fewer patch bytes** and **76.5% fewer changed files**. Even excluding
the old lockfile churn, old insertions were 10,417; the remaining 5,840 are **43.9%
fewer**.
Most retained additions are native/auth/process acceptance tests, not adapters.

Removed Bruv ownership:

- Custom Pi own-token/cost aggregation, `NativeUsageAccounting`, subtree usage
  projection queries/contracts and browser usage-cost adapters. Official provider
  usage/projections/history now own that behavior; the old bespoke report is
  deliberately not a compatibility promise.
- Broad compiler/schema rewrites across unrelated upstream services/providers.
  Official compiler settings and typecheck gates stay in place.
- Custom Pi RPC queues/process hard-stop/session-manager resource implementation.
  Official Pi 1.0 transport, process owner, session lifecycle and Stop logic remain.
- Forked provider/transport behavior. PiDriver/PiProvider retain only the
  executable setup, mode descriptor and branded version-domain boundary; the
  actual transport and orchestration remain the official Pi 1.0 implementation.
- Browser HEIC/WASM and Shiki asset adapters: official browser implementations
  and dependencies now own these features.
- Duplicate Bun catalog/overrides/patch declarations and injected pnpm lockfile
  graph. The official root manifest and pnpm lockfile are byte-for-byte unchanged.

Retained because they are Bruv product/security boundaries, not provider forks:

- `provider/BruvWebPi.ts` plus narrow provider setup/current-adapter seams: the
  installer-owned executable, validated mode descriptors, shell-only lifecycle
  records and pending-work ownership. Pi's minimum version remains 1.0.0 for
  ordinary Pi executables. Exactly the operator-designated Bruv path is recognized
  as a different version domain (Bruv release version is not Pi package version),
  rather than numerically comparing v0.15.x with Pi 1.0. Generic/mismatched Pi
  paths still get the official floor and health checks.
- `mcp/BruvTaskService.ts`, `BruvDelegationPolicy.ts`, least-privilege capability
  issuance in `McpSessionRegistry`/`ProviderSessionManager`: server-derived
  profile/depth and live durable ancestry, no generic orchestration-scope fallback.
- Durable native cancellation before interruption, subtree ownership, thread-stable
  request identity across provider reconnections, read-only task observation.
- Structured workspace records and a small `ThreadLaunchService.prepare` hook
  into official workspace preparation, with retained-worktree cancellation policy.
- Owned local-shell completion/attention notifications with atomic Stop fencing.
  Notification discriminants follow the new official `command` schema.
- Loopback/no-auth browser boundary and Host/Origin/Fetch-Site checks.
- Bun PTY/process/subscriber packaging, lazy optional fff-node loading and typed
  Android search failure; portable native-asset and local self-reference checks.

## Build contract

`integrations/t3/build/build.ts` now uses pnpm workspace-copy `deploy --legacy`
explicitly rather than a second injected lock/catalog. This is an official pnpm
packaging mode, **not** a T3 runtime fallback. Portable optional-dependency
verification remains mandatory; this deployment mode is not yet packaged proof.
The workspace excludes desktop/mobile/infra, retaining shipped browser/server,
shared packages and scripts. Supported native architectures are preserved.

Prepared builds honor `BRUV_T3_SOURCE`, reject a wrong HEAD and verify the actual
checkout against the canonical patch before typechecking. A new regression test
proves the override and wrong-pin rejection. No source/build/cache/receipt,
typecheck, emitted-chunk, native-asset, or packaged-startup gate was waived. The brand/version identity
  seam is retained explicitly, not a fallback to an older Pi protocol.

## Evidence

- Root `bun run check`: pass (`t3-upstream-first-root-check.log`).
- Final combined root source/pack/cache/Android/branding/routing gates: **87 passed,
  0 failed** (`t3-upstream-first-root-final.log`). Producer-tool paths are explicit;
  missing pnpm on PATH is not treated as a passing gate.
- Root source/pack/cache/Android/branding gates separately: **40 passed, 0 failed**
  (`t3-upstream-first-root-gates-final.log`). Delta-only assertions no longer
  demand lockfile entries or unrelated upstream API calls in a reduced patch;
  real deployed-asset verification and branding prohibitions remain.
- Root native routing, local notification, production bridge and shell event
  safety: **47 passed, 0 failed** (`t3-upstream-first-root-routing.log`). Initial
  shell output failures were untrusted mise hook noise; trusting only this owned
  worktree configuration removed it, without modifying assertions.
- Actual-source retained suites: **115 tests passed across 11 files**; three
  native suites cannot collect because official OpenCode 2 packages are absent
  (`t3-upstream-first-focused2.log`). Passing suites include official Pi adapter
  tests plus Bruv mode/shell ownership, auth, policy, MCP injection/registry,
  native-task schema, host-process, Bun PTY and subscriber behavior.
- Additional actual-source provider setup/session tests: **43 passed, 0 failed**
  (`t3-upstream-first-identity-authority-final.log`), including terminal/disposed/
  forged ancestry denied both generic and Bruv delegation, and branded executable
  setup. Together with the retained suites, **158 source tests pass**. The newly
  retained durable no-active-run cancellation regression is also blocked at
  collection by missing OpenCode 2; its assertions were not removed.
- Root/actual-source native task contract conformance: launch/observe/cancel/list,
  workspace preparation states and excess-field rejection all pass.
- Official lockfile with scoped workspace: frozen/offline/lockfile-only validation
  **passes**, using pnpm 11.10.0 (`t3-upstream-first-frozen.log`).
- Owned source formatting and exporter source verification: pass. Final guarded
  source typecheck has **0 diagnostics in edited files**, but exits 1 with 250
  diagnostics in OpenCode 2 and missing proper-lockfile type-dependent files.
  This is explicitly not a clean full application typecheck.

All logs above live under `/home/tnfssc/.bruv/worktrees/`, are review artifacts
rather than maintained inputs, and can be recreated from the commands in tool
history. The source checkout has only pinned source changes, not log files.

## Precise blockers / next acceptance

The copied diagnostic dependency reference is **not** an installed dependency
tree for the new official lockfile. Full server typecheck/guarded build exits 1:
`@opencode/client/effect`, `@opencode/schema/mcp`, and
`@opencode/protocol/groups/event` are missing; the new proper-lockfile type
declaration package is missing too. Offline lock regeneration originally stopped
on missing `@opencode/client@2.0.18` metadata. Keeping the official lock avoids
regeneration, not the need to prepare its new dependencies.

Browser typecheck/build is also blocked: newly required `three@0.180.0` and its
types are unavailable in the reference. The production browser transformed
6,220 modules but exited 1 on the real `phoneViewer.ts` import. Its partial output
is not an accepted build or startup proof. The guarded build attempt is logged in `t3-upstream-first-guarded-build-final2.log`.
See `t3-upstream-first-web-tc.log` and
`t3-upstream-first-web-build.log`.

Next owner must prepare the exact pinned dependencies in the assigned checkout,
then rerun the guarded build, native suites including delegated-completion delivery (real replay/
credential/subtree cancellation), migration/restart/history gates, portable deploy,
packaged CLI relocation/process/security checks and real browser initial load/
reload. No packaged server/browser was produced here, so real packaged startup
and full remote/questions acceptance are **not claimed**. No release should use
this checkpoint before those gates pass. The coordinator owns root Pi-seam
integration and the broader remote/questions/provider acceptance. The migration
preview template no longer imports retired `NativeUsageAccounting`: it asserts
all official provider-turn usage fields, a single root/no child-thread graph,
exact history/settings and restart equality, and explicit schema 54 -> 56 (the
pinned migration manifest ends at 56). Its syntax parses, but runtime acceptance
remains unrun. The existing a9b49a7 fixture is historical, not a claim to be the
last released b488c57 baseline; last-release upgrade still needs its own gate.

## Values

Values unchanged: values 7 (fewer owned parts), 9 (deliberate upstream adoption)
and 10 (proof with handoff) already cover this decision. Feature-specific build
recipes and precise incomplete acceptance belong here, not new global values.
