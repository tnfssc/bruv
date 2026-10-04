# bruv CLI product rename (2026-10-01)

## Ownership and handoff

- Worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_74b29f92
- Branch: rename/bruv; base: 5485b09460814a441601fd63e9013d73f320f297.
- Initial implementation handoff: parent owned review and PR publication. That
  session pushed, merged, released and installed nothing, and changed neither the
  GitHub repository nor real user configuration. Later publication and the human
  repository rename are recorded below.
- User-confirmed product name: **bruv CLI**; executable/command: **bruv**.
  See [name decision](bruv-name.md); this is not trademark clearance.
- Integrated core commit: 713833b (worker 13bf0ad); packaging: 0b7c524
  (worker fce3d77); T3: 648b450 (worker b539dff); reviewed boundary fix: 2e51264.
- Worker worktrees, branches and focused evidence: [core](bruv-core.md),
  [packaging](bruv-packaging.md), [T3](bruv-t3.md). Their initial integration blockers
  are resolved here; their evidence remains a record of their individual commits.

## Scope and fresh namespaces

Renamed app-owned commands, package/bin metadata, CLI/web/provider labels, prompts,
internal identifiers, environment controls, events/MCP tools, service/socket names,
archives, installers, update assets, release workflows, native helper identities,
fixtures/tests and maintained entry documentation. Dependency versions and upstream
source revision are unchanged; root bun.lock changes only the workspace name.

Defaults now use:

- ~/.bruv/agent for CLI configuration, credentials and sessions;
- ~/.bruv/runtime/<version> for materialized embedded assets;
- ~/.bruv/web for embedded web state;
- ~/.bruv/{remote,remote-owner,worktrees} for the corresponding owned state;
- ~/.bruv/live.env, live-settings.json, subagents.json and cache-settings.json;
- .bruv/SYSTEM.md and .bruv/APPEND_SYSTEM.md for project prompt files;
- XDG_CACHE_HOME/bruv/web-runtime or ~/.cache/bruv/web-runtime for extracted payloads;
- BRUV_* controls, T3_V2_BRUV_BINARY and T3_WORKTREE_BRUV_BINARY.

This is a fresh namespace, not a compatibility layer. Existing ~/.die data is
**untouched**: no deletion, migration, automatic read fallback, executable alias or
old environment alias. Installing bruv does not remove/rename an existing die binary.
The old die updater expects old asset names and is not a bruv migration route.
Root release tests and scripts/verify-update.ts now exercise the current updater;
the historical v0.7.1 extraction and CI tag fetch were removed rather than falsified.

At the initial implementation/checks on 2026-10-01, the repository was still
https://github.com/tnfssc/die. Clone, issue, API and release-download URLs retained
that then-valid slug; release assets were renamed to
bruv-{linux-x64,linux-arm64,darwin-arm64,android-arm64}. The human subsequently
renamed the repository to **tnfssc/bruv**; see the follow-up below. README still
notes that install commands require the first bruv release; source builds work
before publication.

## Canonical T3 and adaptation provenance

Canonical input: integrations/t3/upstream/bruv.patch; unchanged upstream pin
b488c57f3f9f1688e31c53daee99e29dd1d0baa2 at pingdotgg/t3code.
The worker edited applied source, exported actual full-index Git diffs using the new
integrations/t3/build/regenerate-patch.ts tool, verified reverse application/pin and
repeat-export determinism. No stale blob-hash rewriting or revision update.

Review found an ordinary English verb accidentally changed in an upstream test
comment ("the token must die"). Restored the actual prepared source and regenerated
with that same tool; a regression rejects the accidental phrase. Final patch SHA256:
dd2aa6d8d804d3c0381d21ca15d3435b52af3a750f456116c129c1d977140d19.
Build-generated SOURCE.txt, archive digest and payload receipt attest the corrected
inputs. Archive magic is BRUVWEB1; deliberate tests reject the old signature.

Pi host patch hashes were recomputed from pristine pinned source; drift checks remain
strict. An existing locally adapted die dependency tree failed prepare:assets as
expected. Exact frozen reinstall with --force --backend=copyfile and worktree-local
.cache/bruv-bun-install restored pristine inputs; CONTRIBUTING documents this.
No legacy adaptation fallback was added.

## Integrated validation

Linux x64, Bun 1.4.2, Node 24.21.0, pnpm launcher 11.27.1 (upstream selects 11.10.0),
tmux 3.6a. Used absolute installed tool paths, per-process SHELL=/bin/bash and
MISE_TRUSTED_CONFIG_PATHS for this worktree, not persisted user configuration.
Logs and proof live in ignored artifacts/ in this worktree.

- Frozen dependency install passed; no dependency upgrades.
- bun run format:check passed; bun run lint passed with 724 warnings / 1090 infos
  (existing repository diagnostics, not suppressed); bun run check passed.
- bun run ci exercised a fresh pinned-source web/backend build, source verification,
  server/web typechecks, chunk validation, deployment/archive generation, standalone
  CLI compilation and the compiled offline OpenAI transport check successfully.
- CI upstream validation: 650 tests passed across 29 files: backend 281, model 158,
  contracts 26, projection 9, cache 138, terminal recovery 38. Terminal-client
  typecheck passed too. Logs: artifacts/ci/*.
- Initial root run: 1637 pass / 20 skip / 1 fail. The standalone web test exhausted
  shared /tmp (16 GiB tmpfs, only 296 MiB free), not a product assertion failure.
  No shared /tmp contents were removed. With TMPDIR pointing to an owned directory
  under artifacts/validation-tmp, full root rerun passed **1638 / 20 skip / 0 fail**,
  32549 assertions across 228 files (artifacts/bruv-tests.log).
- Standalone smoke passed with --reuse-build (artifacts/bruv-smoke.log).
- Packaged browser boot and reload passed against the standalone binary with no
  browser errors, isolated HOME/state, and no real provider credentials. Proof:
  artifacts/bruv-browser-boot.json, including binary SHA256 and rendered text.
- After the comment-only canonical correction, source-regeneration/branding checks
  passed 3 tests / 19 assertions; final format, typecheck and diff checks passed.
- Worker focused results: core 191 tests; packaging 9 unchanged tests plus 72 private
  renamed-contract fixture tests; T3 focused/upstream/build results in its note.
  These are supplemental, not a substitute for the integrated suite above.

Final corrected-source validation completed:

- Fresh bun run build passed; SOURCE.txt records the corrected patch SHA256 above.
- Verified packed-payload cross compilation passed for bun-linux-x64-baseline,
  bun-linux-arm64 and bun-android-arm64, writing exactly named dist/release/bruv-*
  assets. file identifies x86-64 Linux, aarch64 Linux and Android aarch64 ELF
  executables respectively; all three generated .sha256 files verify. Cross-build
  success is not a claim of executing arm64/Android software.
- Current compiled updater gate passed against dist/release/bruv-linux-x64: corrupt
  checksum preserved the executable, valid replacement matched SHA256 and ran
  --version 0.15.20. Log: artifacts/bruv-updater.log.
- Final identity/CLI/Pi-host/archive/source checks: **27 pass / 0 fail**, 183 assertions
  across 6 files (artifacts/bruv-final-focused.log). Includes nonmigration of existing
  ~/.die data, exact release repository/asset identity, standalone embedded web CLI,
  and canonical patch export checks. Final standalone smoke passed again.
- Final packaged browser initial load/reload passed against the staged baseline
  Linux asset, no browser errors. Proof: artifacts/bruv-browser-boot-final.json.
  Binary SHA256: bb15bd3aa576a7e08c361dbcbc2ea24d90f96c3048da4f527ac636e23c791e4d.
- Complete CI phases have passed across the original run and explicit resumed
  commands; do not describe the original bun run ci exit as zero. Its ENOSPC failure
  and subsequent full root rerun are documented above. The final canonical change
  after the full suite was an upstream test-comment restoration plus its assertion,
  not a runtime behavior change.

Handoff state: implementation and local practical validation complete; parent can
review this branch and publish the requested PR. No PR, push or release was made
by this implementation session.

The first CI attempt also caught a too-narrow TypeScript generic in the new identity
assertion; fixed before the successful check/root run. Packed reuse correctly refused
changed invocation environment (CI's disposable TMPDIR versus the later validation
TMPDIR); subsequent fresh production and cross-builds use the same stable environment.
The updater gate requires an exactly named staged raw asset, not dist/bruv; final
verification uses dist/release/bruv-linux-x64 with its generated .sha256 sidecar.
An initial staged attempt correctly refused the missing sidecar, which was then
generated and verified. No gates were weakened to bypass these.

## Residual identifiers and limits

The initial read-only integrated review on 2026-10-01 found no active old-name aliases, automatic .die fallback,
broken tnfssc/bruv URLs, or producer/consumer naming mismatch. Residual die references:

- Then-current tnfssc/die repository/API/release URLs (updated in the follow-up
  below), plus the real dependency-PR fixture slug (preserved).
- LICENSE retains "die project contributors": legal attribution, not current branding.
- Upstream Effect.die/orDie, Layer.orDie, Cause.die/isDieReason, Stream.die and defect
  tag Die; ordinary English (including the corrected verb and "bodies"); opaque
  dependency integrity strings. Upstream APIs and shell failure helpers are not brands.
- Negative fixtures intentionally name the old patch, archive signature, environment
  variables and state directory to prove rejection/nonmigration; source-export fixture
  starts with a DieService.ts to verify real filename changes.
- Historical release notes, research, archived experiments, evidence paths and prior
  worktree/branch names. Clear boundaries are in wisdom/README.md, wisdom/experiments/t3/README.md,
  PRODUCT.md and the root historical task-placement handoffs.

Upstream T3/Pi vendor identities are preserved, including T3 Code splash/title and Pi
provider onboarding/update copy. Browser proof shows Bruv provider/default labels;
it also exposes existing upstream hints mentioning pi and ~/.pi/agent. These are not
legacy die aliases or a claim that bruv migrates Pi state. A broader vendor-UI redesign
was not smuggled into this rename.

No hosted CI/release run, real macOS/native audio or Android/arm64 execution, paid
provider, Docker/SSH acceptance or device test is claimed. The suite's 20 opt-in skips
remain deliberate. At this initial checkpoint, publishing bruv assets and separately renaming the
repository remained parent/human follow-ups, not actions taken by the implementation
session. The subsequent human repository rename is recorded below.

## Wisdom and values

Entry docs and maintained user guides are updated; historical evidence remains.
Values unchanged: existing ownership, truthful evidence and coherent delivery
principles cover this rename. No new general rule is needed.

## Parent review and publication

Parent review found no concrete core/packaging regressions; 114 focused tests
passed. Product title is bruv CLI; command remains bruv.

Before PR publication, merged current origin/develop (bada7e5, PR #18 native-fast
alias fix) without conflicts. Post-merge native-fast and identity tests: 22 pass,
0 fail. Post-merge bun run check passed. The larger suite and compiled artifacts
above were checked before this small upstream merge; hosted CI checks the PR head.

Parent pushed rename/bruv and opened [PR #19](https://github.com/tnfssc/die/pull/19)
against develop. It was open and mergeable at publication; hosted checks were
still running. The original checkout stays on develop and clean. Do not merge or
publish a release as part of this task.

## Confirmed repository rename follow-up (2026-10-01)

After PR publication, the human renamed GitHub **tnfssc/die → tnfssc/bruv**.
Parent verified `gh repo view` returns canonical `tnfssc/bruv`; the current PR is
[PR #19](https://github.com/tnfssc/bruv/pull/19). The publication link and earlier
validation above remain dated evidence, not a claim that the repository is still
awaiting rename.

Updated active README installation/repository links and wisdom index, the contributing fork clone
example, updater API and exact release-download allowlist, compiled updater gate,
and product-repository test fixtures/expectations to `tnfssc/bruv`. The independent
`tnfssc/die-dependency-pr-fixture-20260930` identity remains real and unchanged.
Historical release/PR/action evidence, original branch/worktree paths, third-party
identities and legal attribution are preserved.

Reviewed `.github/workflows`: no active hardcoded old product slug remains.
Checkout/API/status/PR/release/source provenance use GitHub repository context or
`GITHUB_REPOSITORY`, which now resolves to the canonical slug. No workflow edit
is needed. This follow-up makes no user configuration/install changes, remote
repository rename, push, PR or release publication.

Follow-up worktree: /home/tnfssc/.die/worktrees/die-a86675007a5e-task_ac1fe302;
branch `rename/bruv-repo-links`, based on `8741a5c` from `rename/bruv`.

Local follow-up validation:

- Frozen-lockfile dependencies installed only in this worktree, using copyfile.
- `bun run check` passed; focused source/updater/release/dependency/CI-baseline and
  identity tests: **60 pass / 0 fail**, 244 assertions across 6 files.
  The exact-URL regression rejects the old product repository slug, even if
  GitHub would redirect it. The private compiled self-replacement fixture was
  rebuilt from current updater source by the tests.
- `bun run prepare:assets` and `bun scripts/build.ts --reuse-web` passed. This
  rebuilt the current CLI/updater, repacking a worktree-local copy of the unchanged
  bruv web runtime from the initial rename worktree; it was **not** a fresh T3
  source/web build. Chunk-startup validation passed, and the repacked archive
  SHA256 remained `666de4314c2ca9c977a555c99811200eca85e67dafcd80287018a787d6dd0d1e`.
- Staged the rebuilt binary as `dist/release/bruv-linux-x64` with a checksum
  sidecar. `scripts/verify-update.ts` passed against that asset: bad checksum
  preserved the private executable; valid canonical URLs replaced it with
  matching SHA256, and the replacement ran `--version` as `0.15.20`.
  Rebuilt CLI SHA256: `8e55de69bd2decfbbc5813a7fda50ff0a2da89134ff0eee174d7b5998184098c`.
- Changed TypeScript files passed Biome format checks; `git diff --check` passed.

The first optional CI-baseline test run lacked Git on the child PATH; rerunning
with explicit Bun/Node/system tool paths passed without product changes. The
first compiled gate hit `/tmp` ENOSPC during replacement; rerunning with this
worktree's `.cache/bruv-repo-gate` as TMPDIR passed. No guard was weakened.
Successful logs are in `artifacts/bruv-repo-rename/{install,focused-tests,
typecheck,format,rebuild,compiled-updater}.log` in the follow-up worktree.
No full suite, fresh web/browser/native/cross-platform run or hosted CI/release
is claimed for this URL-only follow-up. Parent owns cherry-pick and PR push.

Rename/name/index wisdom updated; values unchanged because existing truthful
evidence, ownership and focused-validation guidance already covers this work.
