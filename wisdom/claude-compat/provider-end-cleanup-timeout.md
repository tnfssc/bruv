# Provider completion cleanup — 2026-10-04

## Done

User asked for a direct fix, PR, merge, release, and T3 worktree setup.
No delegation. PR [#30](https://github.com/tnfssc/bruv/pull/30) merged at
2026-10-04T14:41:33Z. Merge SHA:
1d7ff1d6a9ef1697c33f76970c052ec58938682f.

[v0.16.5](https://github.com/tnfssc/bruv/releases/tag/v0.16.5) published at
2026-10-04T14:50:09Z. Not a draft or prerelease. All 20 assets are uploaded.
Release source/tag SHA: be86f2257a9033a35366d7914bdb0c431f364036.
[Release run 37210202271](https://github.com/tnfssc/bruv/actions/runs/37210202271)
passed the native/browser, platform, updater, and publication gates. Tag ancestry
includes the PR merge; tagged code contains the timeout fix and t3.json.

Downloaded the published Linux x64 CLI/launcher pair. Both checksum files
validate. Both report product 0.16.5. SOURCE.txt matches the tag SHA. CLI digest:
50667b522c440ba8e92e00310718449a02f7df279e8f0b6f62aec5a1fb355b4c.
Downloads and metadata are in this feature worktree's
.cache/provider-turn-v0.16.5-release/ and
.cache/provider-turn-v0.16.5-release-metadata.json.

## Bug and fix

Logo thread 0a0bfa2c-d0be-44b8-8edb-f5ac2763cac5 emitted its final answer at
13:58:10.545Z, but no closing result/idle. Cleanup thread
5478732a-7a09-481f-8a7f-a6d3fa2ff9bd saved its final answer at 13:58:17.118Z
and entered shutdown at 13:58:22.135Z. T3 marked both transport_error at
13:58:38.298Z. Its two MCP DELETE requests only reached handling at
13:58:38.247Z and .300Z; both returned 204 in under a millisecond.

The host also logged an event-loop stall. The exact original connector exception
was not recovered: T3's boot log prints nested failures as [Object] and its
failure record is generic. Do not blame the model, auth, or worktree removal
as the proven cause of the host delay. No cgroup OOM kill was recorded.

runtime.ts parks app-owned MCP leases before publishing result/idle.
mcp.ts had a hidden min(5000, requestTimeout) deadline for DELETE. A late host
response could therefore kill a successfully answered turn and its owned jobs.
Cleanup now honors the configured request timeout, like the other requests;
the default remains 30 seconds. No retry, swallowed error, or false idle added.
We did not change T3's long configured timeout. A true deadline/release failure
still fails; a stalled host can take longer to settle.

## Proof

- New real SDK HTTP/runtime regression delays DELETE six seconds with a
  fifteen-second configured timeout. Baseline fails after 5151ms with
  teardown-failed. Fixed run passes after 6162ms, then emits success/idle with
  no retained remote lease. Fixture model only; no paid API.
- Focused MCP/runtime suites and typecheck pass. Direct delayed-cleanup plus
  four failed-release cases: 5 pass, 53 assertions. Genuine failures still emit
  no result/idle. Scoped format passes; lint exits 0 with old style warnings.
- Built and installed model-free /status probes with delayed discovery DELETE
  pass: success, one idle, zero remote sessions, empty stderr, exit 0.
  Probe script is .cache/cleanup-timeout-probe.ts; run it with Bun. It uses an
  isolated temporary home and fake fixture auth, not user credentials.
- Latest PR head 186fecae0f1f55606a35faade1c429669cda7c90 has green Linux,
  macOS, and policy checks in CI run 37210007993. First PR CI was also green.
- Local full gate first had twelve shell-output failures from inherited fish
  mise startup warnings. Clean-shell rerun: 2009 pass, 30 skip, one installer
  failure from inherited BRUV_CLAUDE_COMPAT_BRUV_PATH. Clearing provider
  overrides fixes that fixture (4 pass); paired smoke passes. No test assertion
  was relaxed. Hosted CI is the clean full-gate proof, not this polluted run.

Local logs: .cache/provider-turn-release-{ci,tests-sh,installer,smoke}.log.
Original runtime evidence: ~/.t3/userdata/logs/provider/events.<thread-id>.log,
boot-service.log, and server.trace.ndjson rotations. Runtime v2 events are in
statev2.sqlite's orchestration_events, not the empty orchestration_v2_events.

## Setup and remaining bounds

[Worktree setup](../t3/bruv-worktree-setup.md) uses locked Bun install and asset
preparation. A real fresh worktree ran the configured command, focused tests,
and typecheck. The public T3 schema validates. Proof checkout is detached at
ed6d6d99: /home/tnfssc/.bruv/worktrees/bruv-setup-check-ed6d6d99.

The local installed fix still reports 0.16.4; it was installed before release
version preparation. Published 0.16.5 is verified but not installed over the
active sessions. Run bruv update after stopping provider sessions to adopt it.
Existing provider processes keep their old executable until relaunched. No T3
restart, active-session cancellation, credential copy, or mise trust change.
Original failed turns stay failed. No paid-provider replay or Android device
acceptance claimed.

Feature checkout: /home/tnfssc/.t3/worktrees/bruv/t3code-1ca0aef3,
branch t3code/provider-turn-error. Local rollback copies:
.cache/provider-end-cleanup-rollback/. Nothing remains to merge or publish.

Values unchanged after release review. Honest lifecycle state, real-path proof,
and resource ownership already cover this. The local lesson is to honor the
host contract during cleanup, not invent a shorter hidden deadline.

Docs-only publication record checkout:
/home/tnfssc/.bruv/worktrees/bruv-v0.16.5-publication, branch
docs/v0.16.5-publication. This record is after the release and does not alter
the verified tag, binaries, or release source SHA.
