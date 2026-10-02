# Main v2 repin: isolated, not released

## Revisions and location

- Previous: `66a91077f9abf6e171aad0ceab2519d7272f3ff3`.
- Assessment merge: `de343914273eceb852a1d1d739cd1d38df7796ee`.
- Official main resolved **once** with `git ls-remote https://github.com/pingdotgg/t3code.git refs/heads/main`: `8bc40b4e07bb7b4b0f71876d59520360c9bf958c`.
- Metadata branch is `main`; fetch/build/runtime use the immutable revision.
- Worktree: `/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_aceee262`; branch: `bruv/repin-t3-integration-to-upstream-main-aceee262`.
- Source: `<worktree>/.cache/main-v2/source` (detached exact SHA, independent Git objects). Disk-backed temp/cache/logs and `env.sh` are beside it; no /tmp source.
- Read [values](../values.md), [ownership](upstream-first-canonical-source.md), [follow-up](upstream-first-follow-up.md), integration README, and assessment from `/home/tnfssc/Code/bruv/wisdom/t3/nightly-orchestrator-v2-pi-assessment.md`.

## Delta review

Main adds four commits after assessment: mobile 2.0.0 metadata, Claude MCP names/icons, version-specific OpenCode compatibility, idle-shell polling. Against previous pin: 87 changed paths (+3452/-974), including official mobile/Expo updates, GitHub polling, composer undo grouping and sidebar settings. Logs: `logs/from-assessment.txt`, `from-current-stat.txt`, `overlap-review.diff`.

Six overlaps: provider compatibility test, ws, composer Tiptap, settings, lock, workspace. Only the compatibility test needed rejected-hunk relocation. **All 77 patch paths remain; added/removed product and test payload lines are identical outside the generated lock.** No task/question/SSH/security/cancel/Pi/packaging seam removed; no root version/release-test/release-doc edit.

Generated lock against main: +118/-12. Besides injected file-workspace snapshots/peer context, pnpm regenerated the mobile file dependency peer suffix and rebound tinyglobby from existing picomatch 4.0.4 to upstream-present 4.0.7 (removing unused fdir peer snapshot). No catalog/package/patch declaration overrides or hand-edited hashes. Net canonical patch text: +55/-24, largely regenerated IDs/context.

## Commands and proof

Source `env.sh` before commands: Bun 1.4.2, Node 24.21.0; upstream packageManager selects pnpm 11.10.0.

- Carry patch: `git apply --reject --exclude=pnpm-lock.yaml`; relocate one compatibility test hunk in real source.
- Generate lock: `pnpm --filter 't3...' --filter '@t3tools/web...' --filter '@t3tools/scripts...' --filter . install --lockfile-only --ignore-scripts --no-frozen-lockfile`. Unfiltered initial attempt hit registry curl error and was canceled; filtered generation passed without weakening policies.
- Export: `bun integrations/t3/build/regenerate-patch.ts "$BRUV_T3_SOURCE"`.
- PASS `prepareWebSource()` frozen shipped closure; resolution skipped, supply-chain checks passed. PASS `verifyWebSource` and installed-lock metadata/package/snapshot/server-closure provenance via `assertMigrationDependencies`.
- PASS server/web `node_modules/.bin/tsc --noEmit` (Effect suggestions only), root `bun run check`, and `T3_V2_CANDIDATE="$BRUV_T3_SOURCE" bun integrations/t3/gates/contract-conformance.ts`.
- PASS upstream Pi adapter/provider/identity/compatibility, Bruv delegation/task policy, durable cancellation/completion and Host/Origin tests: 110 tests / 9 suites; startup identity/Pi commands/completion reads/migration-cancellation: 19 / 4. Invocation logs: `server-focused.txt`, `server-identity.txt`.
- PASS web composer/undo/drafts/routes/thread actions/auth-shell: 184 / 6 (`web-focused.txt`).
- PASS compiled root Pi-host, product/session identity, question ownership/bridge, scoped placement/routing, stream cancellation, source provenance and launcher lifecycle: 74 / 12 (`root-compiled-focused.txt`). Earlier precompile runs lacked dist/bruv; a concurrent routing order assertion flaked once, isolated/final reruns passed. No test edits.
- PASS fresh `bun run build`: both typechecks/bundles, static-cycle guard, injected deploy, local self-reference, portable ffi assets, archive/receipt, compiled CLI. PASS relocated `packaged-smoke.ts` using exact SHA and generated local provenance manifest (loopback startup/security/cleanup, unusable PATH/private state).
- Binary SHA256: `bba792d4633b6d2e96ee10329fe07bf7494ef076f626560c2e2ac388d458b5e1`; patch SHA256: `c2aa1bac4b9b6d484d3532fba52c1a7dd16b1f79445087e0978afc449e2b989d`. Proofs/artifacts remain untracked here.

## Not full migration acceptance: parent follow-up

**Historical gate failure (replaced):** `T3_WEB_DIST="$BRUV_T3_SOURCE/apps/web/dist" node --test integrations/t3/upstream/chunks*.test.mjs` passes static-cycle startup but fails five older chunk-layout assertions (worker/WASM bound, JSON grammars, HEIC adapter, lazy sidebar and composer/timeline). Read-only comparison against packaged previous pin with matching previous patch digest reproduces all five (`chunks-current-baseline.txt`). Not silently waived or fixed by reviving retired compiler/browser adapters. Superseded by [maintained chunk gates](main-v2-chunk-gates.md): custom split/byte-cap assertions were retired and payload laziness replaced with actual upstream manifest/emitted-file checks. Both existing bundles pass; parent still owns one fresh normal producer after integration for the changed gate receipt. This is not browser codec/tokenization proof.

Still required for this pin: seeded history/usage/historical-cost upgrade then fresh-process restart (`migration-acceptance.ts` with independently verified prepared production checkout); real browser initial load and exact-route reload/restart (startup/browser harnesses); native child/Stop/reconnect replay without duplicate launch/swallowed completion (`native-acceptance.ts`); Pi dialogs independently from saved-question ownership. Preservation/worktree acceptance and complete release/platform suite remain unrun. Use this binary hash and exact source HEAD with documented harness flags, never another worktree's release binary.

Real SSH owner/capability/untracked-approval/offline cancellation, paid providers and non-Linux/Android execution still need opted-in acceptance. No push, release, install or full migration claim. Values unchanged: upstream ownership and honest bounded proof already cover this repin.
