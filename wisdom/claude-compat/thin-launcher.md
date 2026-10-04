# One compiled Bruv, thin connector launcher

Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_32125da3
Branch: bruv/replace-duplicate-connector-binary-with--32125da3
Base: a563272b. No incident note was used as product input.

## Ownership and integration

This branch owns root src/cli.ts, build scripts, packaging/install/update and their tests/docs.
It does not edit connector cli.ts, launch.ts, runtime, preflight or defaults/version logic.
The separate parent task must supply connector --bruv-version (bruv-claude-compat <product>)
and --version = 2.1.280 (Bruv compatibility; bruv <product>). Normal --version stays bare product.
Machine equality is connector --bruv-version == "bruv-claude-compat " + normal --version.
The existing exported runConnector is sufficient; root lazily enters it before normal bootstrap.
Normal children execute the normal binary, without claude-compat; the wrapper exports the
absolute normal executable through the existing BRUV_CLAUDE_COMPAT_BRUV_PATH binding.

Workers (independent durable worktrees, based on a563272b):
- Installer/update: ../bruv-5442693331ce-task_32125da3-5442693331ce-task_11511e22,
  branch bruv/thin-launcher-installer-and-updater-migr-11511e22.
- Release/docs: ../bruv-5442693331ce-task_32125da3-5442693331ce-task_6fe4bf4b,
  branch bruv/thin-launcher-release-packaging-6fe4bf4b.
- SDK smoke/review: ../bruv-5442693331ce-task_32125da3-5442693331ce-task_224b2e7b,
  branch bruv/thin-launcher-compiled-sdk-smoke-224b2e7b.

## Design

One Bun compile embeds both entry paths. A native Unix shell script execs its physical
sibling bruv claude-compat with unchanged argv and IO. No Bun/Node installation, forwarding
process, duplicated runtime, or new state. A symlink/hardlink alone cannot select the connector:
actual compiled symlink --help still enters normal CLI (regression test added).

Canonical and release-suffixed names work; relative/absolute symlink chains and spaces resolve
to the physical sibling. Explicit absolute override is supported, quoted, executable-checked and
self-link rejected. Normal PATH bruv is never used. Symlink resolution uses system readlink.
Linux/macOS launcher shebang /bin/sh; Android /system/bin/sh. All syntax is system-shell code.
Release assets remain four platform pairs plus checksums/notices (20 names); second asset is text.
Standalone build:claude-compat refreshes the sibling normal binary before writing its launcher.
Output regular-file/link checks prevent accidentally overwriting normal binaries through links.

## 0.16.3 migration

The old updater compares exact strings, NOT a loose semver parser. It stages canonical files
in a private .bruv-update-* directory and demands bruv-claude-compat <product> from --version.
The wrapper has a narrow, documented bridge for exactly that staged --version probe: derive
and label the real product version from staged sibling bruv --version. This is not a fabricated
Claude version. After the old updater renames the pair, the same script forwards --version to
the connector's SDK-facing version. New machine checks use --bruv-version. Normal invocation,
other arguments and explicit --bruv-version never take this bridge. No updater permission or
checksum gate is bypassed. A user should not configure an SDK install inside .bruv-update-*.

## Evidence

[Proof directory](proof/thin-launcher) contains default build and standalone-in-spaced-path logs,
and successful cross-builds for bun-linux-x64-baseline, bun-linux-arm64, bun-darwin-arm64,
bun-android-arm64. Linux normal is 92,349,920 bytes; launcher 1,672 bytes (Android 1,679).
Actual compiled connector tests passed all three: stream/schema/EOF/SIGTERM, genuine normal
child via execute and explicit profile, and invalid-setup refusal. New wrapper tests cover
quoting/empty argv/metacharacters, EOF/stdout/stderr/exit, same PID/SIGTERM, symlink resolution,
overrides, target interpreters and staged version transition. Actual compiled root tests prove
ordinary help/version/bootstrap and lazy connector help with no normal runtime state.

Cross-build is not native macOS/Android execution. This Linux host has /bin/sh -> bash; shell
syntax checks cannot prove device runtime behavior. Native macOS audio helper and full
unchanged-T3 browser release gate remain platform/integration checks; do not advertise those
as performed here. Separate version/default task is not included in this solution branch. It was combined
in the isolated integration worktree below for end-to-end proof. No global install, user binary replacement,
T3 mutation, release or push performed.

## Integration review

Integrated worker commits: release f69c2caf as 0b6a7d67, updater 893b9f48 as c7d0034e,
SDK proof b255b26e as 76602f76. The review's staged-installer naming blocker is resolved:
installer uses canonical names in a private directory and explicitly binds staged normal.
Integration caught and corrected an overbroad flag migration: normal probes MUST remain
--version, not --bruv-version. Test normal fixtures now reject that unsupported flag.
Sibling version commit 3eafc84b returns a labeled product value, not bare semver; all new
machine checks now expect exactly bruv-claude-compat <product>. No connector edits made.

## Direct compiled subcommand binding

The root dispatcher knows it is already the normal executable. For compiled calls only
it fills an absent BRUV_CLAUDE_COMPAT_BRUV_PATH with process.execPath before entering
runConnector; explicit overrides and source-mode connector defaults are untouched.
This matters for bruv-linux-x64 claude-compat without a canonical sibling. An actual
SDK reproduction failed with the old root (missing sibling bruv), then passed execute/
shell, Stop and EOF after this binding. The SDK test shim only prepended the subcommand;
it did not set the normal-binary environment binding. Final rebuilt combined binary
passes all 12 CLI/compiled connector tests (193 assertions), standalone smoke and
typecheck; log: proof/thin-launcher/direct-subcommand.txt. No connector source edit
was needed, including for this release-name case.

## Combined end-to-end proof

Integration worktree: /home/tnfssc/.bruv/worktrees/bruv-thin-integration-32125da3
Branch: bruv/thin-launcher-integration-32125da3. Contains this branch plus sibling
3eafc84b (cherry-picked as 687d8b75); later root/gate fix 3c6294fd applied as 7c098075.
Do not cherry-pick that combined branch into parent: integrate the two owning branches.
This keeps the connector-owned files out of this solution's commits.

- Combined compiled CLI/connector/default/launcher/install/updater tests: 113 pass,
  613 assertions. Includes actual temp local install and real normal-child execution.
- Final packaging/release/update/rollback/launcher suite: 138 pass, 906 assertions, and tsc --noEmit passes.
- Combined standalone smoke passes with no Bun/Node on child PATH.
- Unmodified SDK 0.3.276 default spawn: actual execute/shell returns through fake
  loopback provider; Stop emits error_during_execution and exits 0; active EOF exits
  0 without signal, 13–14ms in this run. No real credential/provider request.
- All four combined cross-builds at 687d8b75 succeed (before the platform-independent
  final root binding); final Linux binary was rebuilt and retested at 7c098075. Android ELF requests /system/bin/linker64,
  Android API 28. All four actual launcher checksums/shebangs/sibling exec probes pass.
- Current and byte-frozen 0.16.3 compiled updaters both run against the actual combined
  Linux release binary and shell launcher in disposable installation directories.
  Both reject corrupted checksums without replacing either file, roll back a forced
  second rename failure, and install byte-identical candidates. Installed connector
  returns SDK compatibility identity; product checks use the labeled --bruv-version.
  The harness injects a lower currentVersion and local official-shaped fetch so it
  forces replacement without real GitHub access or replacing its running executable.

See proof/thin-launcher/combined-runtime.txt, combined-migration.txt and packaging-gates.txt.
Native Android/macOS runtime and macOS embedded helper execution are not claimed. Existing
full native T3 gates are retained, not replaced by these packaging/SDK checks.

Values reviewed before/after design: unchanged. Existing simple ownership, honest proof and
complete-path validation values cover this feature; no new general principle is needed.
