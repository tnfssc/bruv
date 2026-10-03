# T3 nightly orchestrator v2 — isolated integration

## Owner and source

- Worktree: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_0058dca7`.
- Branch: `bruv/adopt-t3-nightly-orchestrator-v2-0058dca7`.
- Published official nightly: [v0.0.46-nightly.20261003.2623](https://github.com/pingdotgg/t3code/releases/tag/v0.0.46-nightly.20261003.2623), published 2026-10-03T07:43:48Z.
- Immutable revision: `fed41fa88bb27cb4325cb208d571393850bc63c2`; previous main: `8bc40b4e07bb7b4b0f71876d59520360c9bf958c`.
- Resolved Git tag, GitHub release target, and npm nightly dist-tag independently on 2026-10-03. npm has no gitHead; attribution is the actual Git tag/release. Source metadata names the exact release tag, not floating main/nightly.
- Source checkout: `.cache/nightly-v2/source`. Source `.cache/nightly-v2/env.sh` for Bun 1.4.2, Node 24.21.0 and pnpm launcher; upstream packageManager selects pnpm 11.10.0. Logs, commands, release/npm JSON and proofs are under this durable cache directory.

## Rationale and patch

Read values, T3 ownership/repin/nightly assessment, and release wisdom. Upstream delta: 231 files, +11467/-7357. Official orchestrator v2 stays the only shipped engine. New upstream work includes wake start-time preservation, steering/model-selection semantics, provider ingestion and reconnect/auth behavior; no parallel implementation added.

Carried all 77 existing canonical patch paths. Four reject contexts: Pi settings comment, Pi Early Access badge removal, ProviderSessionManager test fixture options, and two cosmetic Orchestrator line wraps. Bruv remains enabled by default, branded Bruv with its own RPC executable/environment; upstream badge removal is retained. Kept current upstream fixture options/dependencies. Removed only rejected cosmetic line-wrap changes. Generated the injected-workspace lock with the filtered pnpm closure, without dependency/catalog overrides; its patch payload is unchanged.

Required Bruv native roles/profile/depth/capability ownership, durable cancellation/replay, unread completion handling, local shell notifications, saved questions, Host/Origin policy and Bun/native packaging remain intact. Source/schema conformance passes; optional upstream workStartedAt/model-selection fields stay upstream-owned.

Broader Claude tests exposed a real contract mismatch: the read-only MCP allowlist lacks bruv_task_list and bruv_task_observe although their canonical toolkit annotations are read-only. Added only these two (one new canonical patch path, 78 total); launch/cancel remain destructive, not read-only. No test expectation weakened. Upstream exact-list annotation cross-check failed before the change and passes afterward.

## Validation

Fresh source install/export/verify and full `bun run build` passed, including both source typechecks, upstream browser/server bundles, shipped closure deploy, portable assets, static chunk/payload gates, archive receipt and standalone executable. Root check/lint/format passed. Regenerated notices cover 128 root production packages; SOURCE.txt/archive provenance are generated artifacts, not hand-maintained copies.

Focused checks passed before the two-entry Claude fix: 71 Pi/provider/ws tests; 129 delegation/task/auth/session/completion/settlement tests; 177 composer/routes/auth-shell tests; 185 client reconnect/contracts tests; 386 nightly model/composer/timeline tests; 158 compiled root integration tests; 2 real emitted chunk gates. Broader server run initially had 286 passed and one Claude allowlist failure, retained in `logs/nightly-server.txt`. After the two-entry fix, the same suites plus runtimeLayer timing/steering coverage pass: 341 tests / 7 files (`logs/final-server.txt`).

Native acceptance passed nested children, parent handoff, single completion, subtree cancellation/sibling isolation, same-key restart/reconnect without duplicate child and owned PID teardown. Relocated packaged smoke passed isolated state, unusable external PATH, startup/security/cleanup.

Initial binary SHA256 `ecd7782c9a467c16390c3e0884133953d1861dbc406b25549594385d500e53f2`; initial patch `a0a85b01a3099a7e969cf20bf91f37db5ba2e0f3bca872a542893fcac231af6c`. Browser and migration proof below used that initial candidate; the only later product delta is the two-entry Claude allowlist fix. Final canonical source/dependency provenance and a second fresh normal build passed after that fix. Final executable SHA256 `583a539cc5b32760e7dcbc150a72561ecdb96d37247ff04f54ca8c104c63abdb`; patch SHA256 `f43e15a5add13e850c26a6f6a5d309c139fa56213800d399fb624459bc82f6e2`; archive SHA256 `d19b423678efc00763d93662bb736eb8b63ff733d487e10fbb076455dc21d965`. `dist/bruv-web/SOURCE.txt` matches these source/patch identities. Final manifest: `.cache/nightly-v2/final-build.json`. Final exact-binary reruns PASS: native production replay/restart/cancellation (`final-native/proof.json`), relocated packaged smoke (`final-packaged-proof.json`), both emitted chunk guards (`logs/final-chunks.txt`), Chromium initial/reload (`acceptance/final-browser-boot.json`), and actual browser native completion/Stop/route refresh (`acceptance/final-browser-native/proof.json`). Both final screenshots were inspected: live child shows Execute and Stop, refreshed stopped child shows Run interrupted and retained transcript. All browser-proof owned PIDs were absent afterward. No paid provider needed; native/browser tests use the maintained loopback model fixture.

Browser/migration worker report: `.cache/nightly-v2/acceptance/browser-migration-report.md`. PASS real Chromium initial/reload app boot, zero recorded errors. PASS actual native child completion waking parent once and browser Stop, exact stopped-child route/transcript retained after refresh. PASS unchanged maintained historical production migration 54→56→separate-process restart with all 13 seeded events, graph/provider/settings/usage/cost fields and $0.42 retained. PASS supplementary previous-main upgrade/restart then nightly reopen/fresh-process restart with unchanged fixtures and canonical source/dependency checks. This is synthetic production-seeded main history, not a real-user database. Original baseline checkouts were verified read-only; owned reflink copies/runners/PIDs were cleaned. One relative-path mistake in a supplemental verification script is retained alongside the corrected passing invocation; maintained guards/assertions unchanged.

## Release boundary

No release/push/install/shared develop mutation; package version and proposal #23 CLI UI untouched. Parent owns cherry-pick, combined candidate validation and full release/platform gates. No full root/upstream/release/platform suite was run here. Paid providers, live Pi select/custom dialogs, real SSH/capability/offline approval, non-Linux/Android execution, exact-route browser recovery after an actual backend PID restart, and real HEIC/Shiki browser rendering remain outside this task's proof. Browser reload/Stop and native same-key process restart were checked; do not conflate them with web-PID restart. Parent must decide/run remaining combined-release acceptance, not treat source/chunk tests as feature or platform proof.

Values unchanged: upstream ownership, real-path proof and honest bounded validation already cover this work. This note supplies source, decisions, proof and pickup paths.
