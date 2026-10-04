# Production packaging preparation — 2026-10-03

## Current recommendation — official 2644 (2026-10-04)

Active setup and release CI now pin unchanged **v0.0.46-nightly.20261004.2644**,
source **737993303d36e10674c54b95e5bd3826682c99c7**. Use
[external setup](external-t3-setup.md) and the
[immutable official proof](proof/official-2644/README.md) for exact archive and
executable hashes. Old 2623 is not a supported pinned target; its upstream Effect
queue failure is historical evidence, not permission to patch T3. 2644 passes
bounded gates while the dependency race remains unfixed.

Release setup reuses the proof's checksum/source-metadata verified downloader in
fresh RUNNER_TEMP directories. The browser probe pins Playwright-core 1.63.0,
matching the validated local proof runtime. scripts/run-native-release-gate.mjs composes the
validated command-idle, same-root actual local-child/reply/idle, human permission
and saved-question, app delegation, and default steering/Stop/resume suites,
followed by command-idle again. Every suite uses the actual final binary and connector launcher
and must produce passing unchanged-official evidence. No runtime assets are
copied into product/build/install; CI downloads are test dependencies only.
The paired updater, native CLI version checks, Mac helper and licensing gates
remain required. Parent owns final build and full hosted CI.

Generated bruv web guidance uses this exact release/source, absolute paired paths,
loopback server and isolated SDK history. Auth sharing is explicit and no secrets
are copied; separate auth is still available. bruv update updates the sibling
pair; T3 updates independently and different releases need revalidation. Known
stale approval requires **Decline**; host upgrade advice is not a product-update contract;
Live is same-host opt-in, not browser audio transport. No fake Claude auth/version.

**The dated preparation/testing records below are historical, not the current
upstream recommendation or a new full-parity claim.**

Parent integration is conditional on full unchanged-T3 native parity acceptance.
No publication, push, global install, parent unbundle or upstream mutation was
performed. This branch edits packaging/setup/CLI documentation only; it does not
edit src/claude-compat, native task/Live/source hooks or server task ownership.

## Artifact/build contract

- package.json exposes normal bruv and bruv-claude-compat. Default build prepares
  Pi assets then compiles normal Bruv once and writes a tiny POSIX exec connector
  launcher with scripts/build-pair.ts. The launcher delegates to the sibling
  `bruv claude-compat`; it contains no second compiled runtime.
- Final normal build has no buildWeb/prepareWebPayload/archive dependency and
  rejects the obsolete reuse-web/reuse-packed-web flags. Embedded web startup
  extraction/settings-seeding/fallback is removed. Historical integration build
  tools/archive tests/proofs remain unmodified as provenance.
- Release manifest stays at 20 assets: one compiled binary plus its launcher for
  linux-x64, linux-arm64, darwin-arm64 and android-arm64, each with .sha256. Shared
  LICENSE, THIRD_PARTY_NOTICES.md, generated THIRD_PARTY_LICENSES.txt and SOURCE.txt.
  Native macOS helper embedding occurs once in normal Bruv. Normal updater owns
  the sibling pair; see [paired update follow-up](paired-update.md).
- Release-suffixed launchers resolve matching suffixed siblings; installed canonical
  names resolve `bruv`. Linux/macOS require `/bin/sh`; Android requires
  `/system/bin/sh`. A Bun 1.4.2 cross-compiled Android probe has ELF interpreter
  `/system/bin/linker64` and Android API 28 metadata: this is native Android, not
  glibc Linux/proot. The release workflow checks that actual Android interpreter.
- Connector `--version` reports `2.1.280 (Bruv compatibility; bruv <product>)`.
  Product packaging/update checks must use connector `--bruv-version`, matching
  normal `bruv --version`; protocol compatibility is not the product version.
  Only the older updater’s exact canonical `--version` staging probe in a private
  `.bruv-update-*` directory retains the truthful legacy product label.
- Local install stages and product-version-checks the binary and launcher before replacing either;
  missing connector, mismatch or failed helper self-test preserves installed files.
  Stop active sessions first; two renames are not a filesystem transaction.
- CI no longer prepares patched T3 source/pnpm/web archive/cache. Release native
  gate explicitly downloads a checksum-pinned official T3 test dependency and
  invokes the existing native acceptance runner against the actual final pair.
  Its dependency-setup step is separate so GITHUB_ENV reaches the next step.
  That runner is a subset gate, not a substitute for parent full parity acceptance.
- Automatic formatting excludes wisdom/claude-compat/proof/** to preserve
  historical evidence bytes. All actual source/tests remain format-checked;
  proof scripts still receive linting and are exercised by their acceptance runner.

## Defaults and setup

bruv web is guidance only: no download, subprocess or settings mutation. Existing
Bruv users explicitly reuse ~/.bruv/agent for auth/models/settings/agent resources.
Subagent profiles remain at ~/.bruv/subagents.json regardless of auth home.
Omitting the override uses separate ~/.bruv/claude-compat auth/settings/resources;
this is not a claim that all host state is isolated. Normal sessions remain owned
by ordinary Bruv with no migration/deletion.

Native SDK transcripts use a distinct ~/.bruv/claude-compat-sdk/projects.
CLAUDE_CONFIG_DIR must align in BOTH the T3 server/parent SDK process and the
separate Claude-slot provider instance. Do not change HOME or touch ~/.claude.
Use an absolute connector path and explicit absolute normal child binary path.
Select genuine exact provider/id for chat and auxiliary generation. No alias
remapping, secret copying, Anthropic identity/subscription or verified-access claim.
See external-t3-setup.md for full commands and paired Bruv/independent T3 update policy.

## Executed checks

Tools: Bun 1.4.2. Parent-prepared node_modules was read through a local symlink
for checks only; no dependency link is committed. Build outputs/test sandboxes
are local and uncommitted.

~~~sh
bun run check
bun run build
bash scripts/smoke.sh --reuse-build
bun run build:claude-compat --outfile=dist/standalone/bruv-claude-compat
sha256sum -c .cache/packaging-checks/bruv-before.sha256
bun install --lockfile-only --frozen-lockfile
bun run format:check
bun run lint
bun scripts/generate-third-party-notices.ts .cache/packaging-checks/THIRD_PARTY_LICENSES.txt
bun test tests/production-packaging.test.ts tests/install-local.test.ts \
  tests/release-workflows.test.ts tests/ci-runner.test.ts tests/product-identity.test.ts \
  tests/publish-release.test.ts tests/t3/web-launcher.test.ts \
  tests/t3/web-launcher-process.test.ts tests/t3/web-runtime.test.ts tests/cli.test.ts \
  tests/packed-web.test.ts tests/architecture.test.ts tests/live-macos-ci.test.ts
for target in linux-x64-baseline linux-arm64 darwin-arm64 android-arm64; do
  bun scripts/build-pair.ts --target=bun-$target --outfile=dist/packaging-smoke/bruv-$target
done
bash -n scripts/setup-native-release-gate.sh scripts/install-local.sh scripts/ci.sh scripts/smoke.sh
~~~

Typecheck, paired normal build, clean-home no-PATH smoke, independent build with
normal SHA preserved, frozen lock verification, repository format/lint and
notices generation pass. Lint retains advisory warnings/infos, no errors. Generated
notices include 211 production packages / 657018 bytes. Cross-compilation passes
for all four targets; actual Linux x64 baseline binaries return matched 0.15.28
versions. Cross Mac builds here did not have the Mac native-helper artifact.

Final focused suite: 96 tests / 603 assertions pass. No full-root/LLM test or
parity claim is made.

## Upstream verification and unresolved checks

Official pinned README and Claude provider docs inspected at
fed41fa88bb27cb4325cb208d571393850bc63c2. Official CLI archive downloaded into this
worktree only, SHA256 verified:
624c3aa1b7809282cd32223a37aaa1501d4b099db1364cdc0a33699e063644c3.
Its actual --version is t3 v0.0.46-nightly.20261003.2623; actual --help confirms
t3, --host, --base-dir, --no-browser, serve and update. Archive has a versioned
top directory; --strip-components=1 retains the genuine t3/client/native deps
layout. No patched archive is used or shipped.

scripts/setup-native-release-gate.sh passes locally in an isolated RUNNER_TEMP,
including official download/checksum/extraction and GITHUB_ENV paths. Node can
import its browser-module alias. The local alias used existing read-only
Playwright-core 1.63.0 and Chromium 1243; hosted Playwright-core 1.60.0 execution
is NOT proven here. No actual native browser/parity run was attempted here.

Remaining parent/hosted gates: integrated connector composition/settings binding,
full native SDK restart/resume/fork, exact model/auth/identity rendering,
MCP permissions and saved questions, true subagent/monitor ownership and steering,
Stop/idle completion/Live controls, actual Mac helper pairing/self-test and
Mac/Linux arm64/Android native execution. Do not publish or integrate this branch
merely because packaging/cross builds pass.

## Held-branch completion — 2026-10-04

Base remains packaging 2abc96c3 plus paired updater 34b9ff52. Parent integration
and external-T3 full native parity acceptance remain separate prerequisites.
No parent unbundle/cherry-pick, T3 source edit, global installation, publication,
release mutation or push was performed.

The prepared full-unit log (1865 pass / 27 skip / 6 fail) exposed obsolete
bundled-web workflow/checksum assertions and a single-binary smoke fixture.
Current tests instead require download-only Bun caches, locked root validation,
paired build/smoke reuse, both targets' checksums, all cross-build targets,
prepared-commit pinning, actual final-pair native acceptance, and publication
waiting for native/macOS/updater gates. Historical opt-in patched-web cache tests
remain as provenance, with executable tool fixtures rather than a production
pnpm installation requirement. Missing pnpm still fails the actual producer;
there is no toolchain fallback. Producer lookup now explicitly uses the current
PATH (Bun 1.4.2's default Bun.which lookup retains its startup PATH).

Standalone smoke requires BOTH executable binaries on clean-build and reuse
paths. Its fixture checks both version forms and external-web guidance, including
negative cases for incomplete/nonexecutable pairs, wrong connector version and
wrong web guidance. CI/release still reuse the build preceding their full tests;
smoke is not native parity acceptance.

Inspection also found a real release blocker missed by the earlier focused
checks: scripts/verify-update.ts still advertised only normal Bruv. Running that
old gate against the actual built pair failed its checksum-preservation check
before replacement. The gate now requires both canonical host assets/checksums,
compiles the current updater, advertises all four fake official assets, and updates
only a separate private temporary installation. Corrupting either download must
preserve BOTH installed files; successful update must match both candidate hashes
and distinct version forms, leave the running gate unchanged, and clean staging.
The real updater's macOS staged helper self-test remains in the path. Executable
regressions also reject a missing connector, either bad candidate checksum and a
checksummed connector version mismatch. No network update or real installation
replacement is performed by this gate.

Local checks use Bun 1.4.2 from the explicit mise installation bin directory,
SHELL=/bin/bash and a frozen worktree dependency install. The first parallel unit
attempt inherited SHELL=/bin/fish: untrusted mise startup text contaminated shell
job assertions, and one probe timed out under that run's load. No trust/global
shell configuration or unrelated product code was changed. Those affected files
pass with explicit bash; final full-root evidence is recorded below. A concurrent
extra focused run hit ENOSPC in the shared 16 GiB /tmp tmpfs, not the repository
filesystem. Its rerun used an owned short disk-backed TMPDIR under ~/.cache and
passed; only owned local candidate outputs were removed. No unrelated temp files
or product gates were altered to conceal that environment failure.

- Focused changed/affected files: 56 pass / 0 fail across 7 files. Final changed
  files rerun: 16 pass / 0 fail across 4 files (held-packaging-focused-final.log).
- Clean default paired build/smoke and explicit preceding-build reuse smoke pass.
- All four paired cross-builds pass; actual Linux x64 baseline candidates pass
  the repaired compiled updater gate. Cross macOS builds did not embed a Mac
  native-helper artifact and are not native macOS/arm64/Android execution proof.
- Repository format, lint (existing advisory warnings/infos, no errors), typecheck,
  shell syntax and diff whitespace checks pass.
- Final full-root suite: 1874 pass / 27 skip / 0 fail; 1901 tests across
  254 files (236.78s). Skips remain explicit native/live/external gates, not removed
  packaging checks. This supersedes the earlier focused-only evidence status.

Logs stay in this worktree's ignored artifacts/held-packaging-*.log. In particular
held-packaging-focused.log, held-packaging-clean-smoke.log,
held-packaging-reuse-smoke.log, held-packaging-cross-builds.log and
held-packaging-unit-final.log retain the executed evidence. These checks do not
replace parent full native acceptance or hosted final-artifact/macOS-helper gates.


## Cohesive official-2644 setup/CI follow-up — 2026-10-04

This follow-up keeps the historical proof bytes unchanged and makes the active
recommendation/CI use them. No version bump, push, release or global installation.
No connector runtime, T3 source/executable, task ownership or device behavior edits.

Validation in this isolated worktree:

- Frozen Bun 1.4.2 dependencies, prepared Pi assets and a temporary normal CLI
  build under .cache/web-guide (not a final release build). Actual clean-home,
  no-inherited-environment --version returned 0.15.28. Actual bruv web output
  contained the 2644 release/source links, absolute sibling connector, aligned
  isolated SDK/server home, paired updater, and no unpinned latest recommendation.
  No T3 subprocess or real Claude state was created by bruv web.
- scripts/setup-native-release-gate.sh ran in a fresh private RUNNER_TEMP with
  a read-only existing Playwright-core 1.63.0 runtime/Chromium 1243. Official release
  metadata/source, published archive digest and extracted executable digest all
  passed the immutable fetch contract. The actual CLI returned
  t3 v0.0.46-nightly.20261004.2644; actual --help and Node browser-alias import passed.
  The first probe's extra import command had a shell-quoting error after setup
  already passed; corrected direct /usr/bin/node import passed. No global install.
- Focused setup/workflow/install/smoke/native-command/human/Live/local-return suite:
  **96 pass, 0 fail, 792 assertions** (12 files).
- Separate paired updater/release-shape/actual compiled updater fixtures:
  **64 pass, 0 fail, 272 assertions** (3 files).
- Browser dependency-setup/workflow suite after pinning Playwright-core 1.63.0:
  **21 pass, 0 fail, 322 assertions** (2 files; overlaps workflow checks above).
- Initial combined run hit host-load timeouts (157 pass, 3 timeouts; observed load
  average 47). Reruns above passed. New orchestration fixtures now have a bounded
  30-second test deadline; no production gate assertion or updater test was weakened.
- Typecheck, focused formatting/lint, Bash syntax and preserved official proof
  verification pass. Existing advisory lint warnings/infos are retained.

The orchestration fixtures test suite order, exact paired path forwarding,
branch-flag isolation, fail-closed results, new proof roots and prelaunch pin
rejection; they are **not native acceptance evidence**. The validated native
scripts remain the actual execution contract. Parent owns final paired build,
full hosted CI, all composed native runs on final assets, Mac helper and remaining
full parity/device/provider acceptance. No fresh full six-suite native pass is
claimed by this setup-only follow-up.
