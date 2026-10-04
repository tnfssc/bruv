# One compiled Bruv, thin connector launcher

Worktree: /home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_32125da3
Branch: bruv/replace-duplicate-connector-binary-with--32125da3
Base: a563272b. No incident note was used as product input.

## Ownership and integration

This branch owns root src/cli.ts, build scripts, packaging/install/update and their tests/docs.
It does not edit connector cli.ts, launch.ts, runtime, preflight or defaults/version logic.
The separate parent task must supply connector --bruv-version (bare real product version)
and --version = 2.1.280 (Bruv compatibility; bruv <product>). Normal --version stays bare product.
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

## Evidence in progress

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
as performed here. Separate version/default task is not in this branch, so final product-version
machine checks must be rerun after parent integration. No global install, user binary replacement,
T3 mutation, release or push performed.

Values reviewed before/after design: unchanged. Existing simple ownership, honest proof and
complete-path validation values cover this feature; no new general principle is needed.
