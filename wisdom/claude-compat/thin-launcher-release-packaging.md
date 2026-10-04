# Thin launcher release packaging — 2026-10-04

Scope: release workflow/gates, packaging tests and documentation only. Parent owns
build scripts/root dispatch; other workers own connector sources and updater/local
installer. No source/build/install/updater changes, release, push, global install,
or T3 mutation occurred in this task.

## Current contract

One compiled Bruv executable per target; the connector asset is a tiny POSIX exec
launcher for sibling `bruv claude-compat`. Keep all 20 manifest names, including
binary/launcher checksums and four shared licensing/source files. Product checks
use connector `--bruv-version` against normal `bruv --version`. The protocol identity
is separately asserted as `2.1.280 (Bruv compatibility; bruv <product>)`.

The new release gate checks shipped launcher bytes/checksums, executable mode,
platform shebang, and dispatch after copying the launcher unchanged into a path
with spaces. A temporary sibling verifies the leading claude-compat argument,
space/empty/glob arguments, exact exit status and unchanged process PID (exec).
Both suffixed release names and renamed canonical installation names must work
without PATH utilities. This is not native-platform or native-T3 acceptance.
Linux/Mac actual-pair version checks, strict composed native suites, updater,
Mac embedded helper, licensing and publication dependencies are preserved.

## Older-updater stage bridge

The parent’s build contract retains a narrow compatibility response only for an
exact canonical launcher --version invocation in a physical `.bruv-update-*`
directory. It returns truthful `bruv-claude-compat <product>` from the staged
sibling, preserving the already-released updater’s exact comparison. Installed
SDK-facing --version uses the new compatibility identity; new machine checks
use --bruv-version. This is not a semver-parser trick or a second connector.

## Android investigation

Bun 1.4.2 cross-compilation of a minimal module with `--target=bun-android-arm64`
reported `bun-linux-aarch64-android-v1.4.2`. Both file and readelf showed the ELF
interpreter `/system/bin/linker64`; file reported Android 28 / NDK r27c. This is
native Android, not a glibc/proot build. The workflow now checks the actual release
binary's interpreter before staging assets. Android launchers require
`/system/bin/sh`; Linux/macOS require `/bin/sh`. Android launcher dispatch is tested
with the host POSIX shell here, not claimed executed on Android hardware.

## Proof

Bun 1.4.2, existing local dependency tree via an uncommitted node_modules symlink:

~~~sh
bun test tests/release-launcher-gate.test.ts tests/smoke-script.test.ts \
  tests/production-packaging.test.ts tests/release-workflows.test.ts \
  tests/manual-release.test.ts tests/publish-release.test.ts \
  tests/native-release-gate.test.ts tests/release-browser-setup.test.ts
~~~

47 tests / 542 assertions passed. Shell syntax, workflow YAML parse, focused
Biome formatting and git diff --check passed. Initial run found missing local
dependencies and one old version-format assertion; these were fixed, not skipped.
The gate also passed against byte-for-byte copies of all four parent-generated
launchers from `dist/thin-release`, with independently generated checksums. The
actual parent cross-built Android product executable also passed file/readelf
inspection: `/system/bin/linker64`, Android 28. No final integrated application
build, hosted workflow, native T3/browser suite, Mac runtime or Android device
execution ran in this isolated packaging task.
Parent must run those existing gates with the final binary and actual generated
launchers after integrating sibling changes. Parent owns the first two build API
assertions in production-packaging.test.ts: its final pairedBuildCommands returns
one connector-build command that compiles normal Bruv once and writes the launcher,
while preserving target/name/helper forwarding. This packaging commit leaves those
two assertions unchanged to avoid overlap.

Updated active production packaging contract and marked dated launcher build
records superseded. Values unchanged: built-thing proof, truthful execution limits
and explicit ownership already cover this work; no new general rule is needed.
