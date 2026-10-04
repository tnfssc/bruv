# Single-runtime connector: independent actual-file proof (2026-10-04)

Reviewed the root/build change committed during review as main-worktree commit
`53d6af4e` (compile one Bruv, enter connector before ordinary CLI bootstrap,
ship a tiny system-shell exec launcher). No main-worktree edits, global install,
release, push, T3, or real-provider requests.

## Actual artifact proof

From the isolated review worktree:

```sh
MAIN=/home/tnfssc/.bruv/worktrees/bruv-5442693331ce-task_32125da3
BUN=/home/tnfssc/.local/share/mise/installs/bun/1.4.2/bin/bun
SDK=/home/tnfssc/Code/bruv/.cache/claude-compat-boundary/package/sdk.mjs
BRUV_CLAUDE_SDK_PATH="$SDK" BRUV_CLAUDE_COMPAT_TEST_BINARY="$MAIN/dist/bruv-claude-compat" \
  "$BUN" scripts/claude-native-acceptance/wrapper-sdk-smoke.mjs
/bin/sh -n "$MAIN/dist/bruv-claude-compat"
"$BUN" test "$MAIN/tests/claude-compat-launcher.test.ts" "$MAIN/tests/production-packaging.test.ts"
```

The reusable smoke imports the **unmodified** SDK 0.3.276. Its shell case uses
SDK's own default local spawn, the actual 1,097-byte built wrapper, and the actual
92,349,920-byte compiled sibling. The only provider is a loopback fake OpenAI
endpoint. Actual execute calls actual shell; the fake provider requires the shell
output before answering. Two model requests; successful SDK result and clean end.

Stop and EOF use SDK's public spawn observation hook, forwarding command, args,
environment and signal unchanged to node:child_process.spawn. This allows exit
code/signal and raw frames to be checked; no SDK source patch or connector mock.
SDK interrupt resolves and emits error_during_execution; exit 0 with no signal,
15–20 ms across final runs. Closing the SDK query during a held provider request closes stdin; actual
compiled owner exits 0 with no signal in 12–21 ms across final runs, before the SDK's forced-kill grace.
No successful result from the held turn. SDK version reporting is deliberately
not asserted: the built connector still says bruv-claude-compat 0.16.3, a separate
version-reporting task.

Focused source tests: **12 pass, 0 fail, 80 assertions** (8 launcher + 4 packaging).
These cover quoting, symlinks, release suffix, override, PID/exec, generator output
and output-link protection. Already-passed compiled normal-child tests were not
repeated; the new SDK smoke independently proves compiled execute/shell.

Hashes of the actual files tested:

- dist/bruv: 6e13a4f158bf2c2ebfaa344558d9c5ede797635ea83b24809a0c32ba5fbddb75
- dist/bruv-claude-compat: 3f40ce95b5b23c50e29d2a85d03cf18d91596ac73efac19c13f00006266491f2
- sdk.mjs: b1607967e0dfb39a0db45f143d3b57c7a85f2f6eaa77d6bee7d8184a9830a9f3

## Found blocker: local installer staging names

Main scripts/install-local.sh probes .bruv-install-$$ and
.bruv-claude-compat-install-$$ before rename. The launcher cannot discover that
staged normal sibling. Temp-only reproduction (NOT an installation):

```sh
dir=$(mktemp -d /tmp/bruv-wrapper-stage-review.XXXXXX)
cp "$MAIN/dist/bruv-claude-compat" "$dir/.bruv-claude-compat-install-123"
ln -s "$MAIN/dist/bruv" "$dir/.bruv-install-123"
"$dir/.bruv-claude-compat-install-123" --version
# exit 1: normal Bruv executable not found: .../bruv.bruv-claude-compat-install-123
rm -rf "$dir"
```

Repair installer-owned staged probing by explicitly passing the staged normal
path. Coordinate the expected version/probe with the separate SDK version change;
do not infer product semver from the SDK compatibility version. Current source's
special .bruv-update-* version accommodation does not cover installer filenames.

## Review and limits

The build now compiles the ordinary CLI exactly once and emits the sibling script;
target/native-helper options are forwarded. Source safeguards reject unsafe output
links before compilation. Connector routing precedes normal CLI asset extraction
and bootstrap; ordinary child invocations do not take the connector subcommand.

Linux/macOS generators use /bin/sh; Android uses /system/bin/sh. Syntax is portable
to their expected system shells. Symlink resolution additionally assumes their
ordinary readlink utility (no GNU-only flags), and source's inode comparison uses
-ef, supported by expected bash/mksh shells. **Only Linux was actually run**;
this host's /bin/sh resolves to bash. Source tests of Darwin/Android only validate
generated shebangs and Linux shell parsing; they are not macOS/Android runtime
proof or native-helper/audio acceptance. The source acquired a staged-updater
compatibility branch during review; tested dist wrapper predates that branch.
Rebuild/re-run after subsequent source/version changes.

Bash command launches emitted mise untrusted-config warnings, but explicit Bun
commands ran successfully. No trust/config changes made. Read wisdom/values.md;
values unchanged: this is feature-local proof, no new general lesson.
