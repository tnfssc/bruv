# Official T3 upstream-first migration — reviewed candidate

## Outcome and ownership

Implementation is complete in the isolated worktree; parent review/integration remains.
No push, release, product installation or version bump. Version stays 0.15.24.

- Bruv worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_4eb8a4a8
- Branch: bruv/resume-t3-upstream-adoption-and-patch-re-4eb8a4a8
- Base: 92f1f2bc543ef148a5d254c20c95e6ba8b9aa4be
- Actual upstream source: /home/tnfssc/.bruv/worktrees/t3-upstream-first-4eb8a4a8
- Source branch: bruv-upstream-first; HEAD remains the official pin, with canonical changes in its index/working tree. Do not commit over that HEAD before regenerating the patch.
- Prepared prior-production fixture checkout: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_4eb8a4a8-5442693331ce-task_7725ecce/.cache/migration-acceptance/production

## Exact upstream and ancestry

User explicitly chose official development branch t3code/codex-turn-mapping, not stable.
Fetch on 2026-10-02 resolved **66a91077f9abf6e171aad0ceab2519d7272f3ff3** (#14636).
Its parent de95adc336e68d8ce645fc09bf0f8eeb39444338 is Pi 1.0 support (#14688);
Pi introduction is f2919fd8b (#7211).

Old pin b488c57f3f9f1688e31c53daee99e29dd1d0baa2 is a v2 commit, “fix(v2): remove
obsolete composer breakpoint animation”, not a stable-release pin. The original clone
was shallow there: local merge-base failure alone was not evidence. GitHub compare
returned diverged, 1110 ahead / 606 behind, merge base
5781b5240bd5d2e21c651f6b228975ac40cbd67b. This is a divergent source migration.

## Measured maintained patch

| Measure | Before | After |
| --- | ---: | ---: |
| Bytes | 1,948,956 | 365,318 |
| Patched files | 302 | 74 |
| Added lines | 15,595 | 6,096 |
| Removed lines | 19,582 | 268 |
| Added lines excluding lockfile | 10,417 | 5,981 |

**81.3% fewer patch bytes, 75.5% fewer files, 42.6% fewer added source/test lines
excluding lockfiles on both sides.** The final mechanically generated lock delta is
115 additions / 5 deletions. This is not merely a lockfile reduction.
Every canonical export used regenerate-patch.ts on actual pinned source; final source
verification and packaged SOURCE.txt agree. No patch/hash text surgery.

Removed ownership: custom Pi RPC/resource implementation, bespoke own/subtree usage
accounting and browser cost adapters, broad compiler/schema/provider rewrites,
HEIC/Shiki asset adapters, duplicate dependency definitions, and the old custom
bin.ts/binCli.ts invocation/teardown API. Official providers/orchestration/Pi 1.0 now
own those implementations. Root launches the ordinary upstream CLI through supported
Bun preload, clearing interpreter mode before main and child execution.

Retained narrow product/safety boundaries:
- Bruv executable identity, model mode descriptor, and local-shell lifecycle/pending-work records.
- BruvTaskService, profile/depth authority, scoped credentials, durable replay/cancellation,
  non-consuming async launch, parent completion ownership and local notifications.
- Loopback/same-origin no-auth behavior, setup/draft intent and environment isolation.
- Bun PTY/subscriber behavior, lazy unsupported-platform native search and portable assets.
- Five optional finite per-turn cost fields solely to retain already-stored provider cost;
  no bespoke aggregation or subtree display restored.
- Modern injected pnpm deploy. Full official workspace/catalog/patch declarations stay
  upstream-owned; installation selects shipped server/browser closures plus root tools.

Root Pi audit found **no equivalent safe upstream replacement**, so root host reduction
is zero, not counted in the T3 savings. Builtin filtering, fail-closed fast dispatch,
bounded history/scan cleanup, native compaction checks and first-paint seams remain.
See ../dependencies/pi-1.0-root-host-upstream-audit.md (89 focused passing tests and
specific public-API evidence).

## Final artifact identity

- Patch SHA-256: 7afe02917338fa91040b61943c8fa40d17358636e08b2aee680b5e416366080e
- Built dist/bruv SHA-256: 4ff0f163ede1ebd006605ce5f541bfa9b2ca44eeede0642361d117f206b6ff83
- Built web archive SHA-256: 42850cc31c408a962c80103ea7287fecfbc120a9093db7709f81d974a064fa08
- Runtime/actual startup: Bun 1.4.2, Linux x64. Pinned package manager: pnpm 11.10.0.

## Proof

Evidence files below are under the Bruv worktree’s .cache/upstream-first-proof/.

- Guarded final build passed: frozen scoped dependency install, server AND browser
  typechecks, production bundles, static emitted chunk-cycle gate, modern deployment,
  portable optional-asset verification, archive/source receipt and compiled executable.
  Log: build-final.log. Compiler suggestions from unchanged upstream remain visible;
  no compiler severity or required gate was lowered.
- Root check passed: root-final-check.log.
- Full root suite: **1702 pass, 20 explicit opt-in skips, 0 fail**, 231 files, 32,903
  assertions: root-suite-final.log. This ran before the final provider advisory/text-only
  correction; root runtime implementation did not change afterward. Final compiled
  runtime/migration-guard focused rerun: **11 pass**, including standalone help with no
  Node/Bun/sidecar on PATH and preload argv/main/environment/async teardown.
- Exact-source safety/provider suites: **164 pass across 16 files** (focused-final.log).
  Final provider-identity rerun: **5 pass** (provider-final.log).
- Final compiled native acceptance: native-final/proof.json and native-final.log, bound
  to the final binary hash above. Actual Bruv/Pi + real scoped HTTP MCP + loopback model:
  live observe, nested child, single completion, parent handoff, subtree cancellation
  with sibling unaffected, unique credentials, same-key restart with zero duplicate
  children, zero foreground result ACKs, four provider processes all reaped.
- Shipped b488c57 production state -> new source -> restart passed: migration-final.log.
  All 13 events, migration ledger 53–56, history, graph/job/ACK state, provider identity,
  settings checksum, token counters and all five cost fields retained. Fresh/upgrade
  fixtures use private data; no user database was touched. Contract conformance passed:
  contract-final.log (launch/observe/cancel/list/workspaces/excess-field rejection).
- Final compiled browser cold navigation AND reload passed: browser-boot.json;
  zero browser errors, splash removed, real app visible. Screenshot
  browser-boot.json.png was inspected: correct Bruv no-credentials hint, model/mode
  controls, no false Pi update offer. Provider credentials were deliberately absent.
  Trace requests canceled on reload are logged separately, not browser errors.
- Final canonical verifyWebSource and git diff --check passed.

## Concrete failures resolved, not waived

The worker’s copied diagnostic dependencies were insufficient; a real frozen install
succeeded. Native mock fixture snapshot/layer APIs were updated to official services.
The history gate caught cost fields silently stripped by the new schema; they are now
preserved. Independent review reproduced terminal async launch/replay consuming ACKs;
the restored non-consuming behavior has a red/green test. Legacy deploy failed on
unused official mobile patches and re-resolution, so it was discarded rather than
allowing unused patches. Modern injection needs only the small generated lock delta.

Packaged startup caught the removed runCli export assumption; standard Bun preload now
runs the unmodified upstream entry, rather than restoring a CLI fork. Native acceptance
caught ProviderReplayHarness ignoring its supplied real MCP registry and issuing mock
port-80 credentials; registry injection is corrected, timeout/assertions unchanged.
Visible browser proof caught Pi update advice for the separate Bruv version domain;
only embedded Bruv suppresses that advice, ordinary Pi checks stay upstream-owned.

Gate dependency validation now supports pnpm’s pruned installed graph while requiring
exact metadata/importer pins, every installed package/snapshot to match source, and a
complete server closure including workspace links, aliases, dev/optional dependencies.
It does not install or copy a lockfile to satisfy a guard. Four regression tests cover
provenance and required-closure failures. See upstream-first-migration-acceptance.md.

Two setup-only failures were corrected without changing assertions: Chromium’s Unix
socket path exceeded its limit under the long worktree TMPDIR (use private short
/home/tnfssc/.bruv/t3-probe-4eb8), and an existing root test’s broad cache/ substring
assertion collided with TMPDIR inside .cache (full-suite TMPDIR was instead
/home/tnfssc/.bruv/worktrees/t3-upstream-first-test-tmp-4eb8a4a8).

## Commits and worker handoff

Implementation/root commits: 8d69a38 (ownership), d667a65 (root audit), 8b708bd
(shipped-state gate), ba44dc7 (official usage fixture), 15ebf24 (source adoption),
30dd3b2 (history/delivery/deploy/bootstrap), 57970d4 (native diagnostic), dae7208
(final source registry/identity and startup regression). Parent should integrate the
full branch range from base 92f1f2b, not just the large patch commit.

Worker worktrees are beneath /home/tnfssc/.bruv/worktrees/, named
bruv-5442693331ce-task_4eb8a4a8-5442693331ce-task_<id>:
- 1819db87: bruv/reduce-root-pi-host-seams-using-official-1819db87
- dd734f12: bruv/adopt-official-t3-pi-and-orchestration-s-dd734f12
- 7725ecce: bruv/update-history-migration-acceptance-for--7725ecce
- b52e4a74: bruv/review-upstream-first-migration-safety-b-b52e4a74 (read-only review)
- f7bfa7ab: bruv/fix-native-integration-timeout-on-exact--f7bfa7ab

## Gaps and values

No live paid/external model API, real SSH/Docker owner, hardware/audio, or non-Linux
startup run was performed. Those explicit opt-in tests remain skipped, not passed.
Native real-process acceptance uses a deterministic loopback model. Portable assets
were checked, but that is not cross-platform execution proof. No release/install work
was requested or performed. The target is still an intentionally chosen development
branch, not stable; future repins need a new source/gate review.

Wisdom updated with adoption, audit, migration and native-proof notes. Values unchanged:
existing 1/2 require shipped proof and honest gaps, 3/4/6 preserve ownership/history,
and 7/9 already call for fewer owned dependency parts without weakened gates.

## Parent integration

Integrated the full worker range on develop through a567f92. Parent reviewed
the final source pin, build and preload launch changes, native acceptance JSON,
and the actual browser screenshot. Runtime/build/source inputs match the worker
commit 6463518 exactly. Two test files needed only Biome line wrapping; fixed
without changing assertions. Main-checkout preparation/typecheck and format pass.

Main checkout initially had no dist/bruv, so two compiled launcher checks failed
with ENOENT. Reused the reviewed worker executable as a local dist test artifact
(no product install), then reran all selected checks: 32 pass, 107 assertions
across source guards, migration provenance, branding, Android packaging, launcher,
and standalone runtime/preload teardown. git diff --check passes. Worker fresh
build/native/browser/history proof above is reused, not claimed as a second build.

No push, release, version bump or installed executable change. The requested
branch adoption and reduction are integrated locally. Future publication still
needs normal hosted release gates, including non-Linux binaries. Unrelated
untracked footer-gap wisdom/evidence observed in the main checkout was left alone.
Values unchanged: the existing upstream-adoption and fewer-owned-parts values
cover this migration; no new general rule is needed.

## Focused further reduction

See [further-patch-reduction.md](further-patch-reduction.md) for the fixed-pin
follow-up from d195d78: small dead-state/upstream-helper cleanup, fresh-checkout
build dependency fix, final source/build/native/browser proof and exact limits.
