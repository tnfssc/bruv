# Production packaging preparation — 2026-10-03

Parent integration is conditional on full unchanged-T3 native parity acceptance.
No publication, push, global install, parent unbundle or upstream mutation was
performed. This branch edits packaging/setup/CLI documentation only; it does not
edit src/claude-compat, native task/Live/source hooks or server task ownership.

## Artifact/build contract

- package.json exposes normal bruv and bruv-claude-compat. Default build prepares
  Pi assets then compiles both with scripts/build-pair.ts. The independent connector
  build remains available; a normal CLI checksum was unchanged by that build.
- Final normal build has no buildWeb/prepareWebPayload/archive dependency and
  rejects the obsolete reuse-web/reuse-packed-web flags. Embedded web startup
  extraction/settings-seeding/fallback is removed. Historical integration build
  tools/archive tests/proofs remain unmodified as provenance.
- Release manifest: both binaries for linux-x64, linux-arm64, darwin-arm64 and
  android-arm64, each with .sha256. Shared LICENSE, THIRD_PARTY_NOTICES.md,
  generated THIRD_PARTY_LICENSES.txt and SOURCE.txt. Native macOS helper embedding
  is forwarded to BOTH compilers. Normal updater now owns the sibling pair; see [paired update follow-up](paired-update.md).
- Local install stages and version-checks BOTH binaries before replacing either;
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
