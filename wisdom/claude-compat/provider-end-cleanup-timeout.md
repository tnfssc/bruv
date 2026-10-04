# Provider error after the answer — 2026-10-04

User asked for a direct investigation. No delegation. No runtime fix or install.

## What we saw

Screenshot says Provider error / Provider turn failed. The affected threads are
Add a Logo (0a0bfa2c-d0be-44b8-8edb-f5ac2763cac5) and Clean Up Worktrees Older
Than an Hour (5478732a-7a09-481f-8a7f-a6d3fa2ff9bd), run ordinal 2.

- Logo emits its final assistant answer at 13:58:10.545Z. Its provider wire log
  has no following result or idle frame for that run.
- Cleanup saves its final assistant message at 13:58:17.118Z. At
  13:58:22.135Z its native job log records shutdown cancellation. That is
  about five seconds later. Wire delivery of its answer is delayed until
  13:58:38.242Z.
- T3 logs both claude-query-stream-failed warnings at 13:58:38.298Z.
  Both error records have class transport_error, generic message, no code.
- Server traces show two MCP DELETE requests at 13:58:38.247Z and
  13:58:38.300Z. Both return 204 in under a millisecond. They were processed
  late, not rejected. The same service also logged a 7485ms event-loop stall
  at 13:57:23.069Z (17:57:23.069 local time in the boot log).
- The service cgroup has no recorded OOM kill. This does not rule out every
  outside process kill, but there is no OOM evidence here.

## Strong lead, not a captured exception

src/claude-compat/runtime.ts waits for mcp.parkAppOwned() before sending result.
src/claude-compat/mcp.ts caps DELETE at min(5000, requestTimeout), even when
T3 configures a much longer timeout. Release failure prevents result/idle and
closes the connector. Shutdown then cancels its owned jobs.

The five-second shutdown timing and late server DELETE handling fit that
cleanup deadline. The model finished; the closing transport failed. The exact
original connector stderr was not retained by the T3 path we inspected, and
boot-service.log prints nested failures as [Object]. Do not claim the original
exception was recovered. Do not blame the model, credentials, or worktree
cleanup as the proven source of the server delay.

## Checks and evidence locations

Installed bruv binary was last written Oct 4 at 17:47 local time. T3 service
runs ~/.t3/runtime/versions/0.0.46-nightly.20261003.2623/t3. Repo checkout is
/home/tnfssc/.t3/worktrees/bruv/t3code-1ca0aef3.

Read local userdata/logs/provider/events.<thread-id>.log, boot-service.log,
and server.trace.ndjson rotations. Runtime v2 events are in statev2.sqlite's
orchestration_events table. The similarly named orchestration_v2_events table
is empty; it is not this runtime's event journal.

A direct installed-binary /status probe, with a fresh session ID and the
current thread's existing MCP config held only in memory, returned success
result, idle, exit 0, and no stderr. No model call. The first two probe inputs
were rejected for malformed/mismatched session IDs; neither exercised a turn.
No credentials copied into files, no T3 settings or installed files changed.

## Next step

Capture connector stderr and a delayed-host DELETE reproduction before choosing
a change. Review the five-second cleanup deadline against the real host.
Do not swallow release failure or claim idle when the remote lease is unknown.
Fix the short-deadline/host-delay interaction, and keep the real exception
visible. A normal /status pass does not prove a model turn with jobs under
server load is fixed. No fix, paid-provider replay, or full suite claimed.

Values unchanged. Honest lifecycle state, real-path proof, and resource
ownership already cover this incident. This is a local finding, not a new value.

## Fix after the user asked to fix it

The earlier no-fix/no-install status above records the investigation turn.
This follow-up removes the hidden five-second DELETE cap in mcp.ts. Cleanup
now honors the server's configured request timeout, or the existing 30-second
default. No retry, swallowed release error, fake result, or fake idle was added.
A host stall can take longer to settle; a real deadline/release failure still
fails the connector. We did not change the T3 server's long configured timeout.

The real SDK HTTP fixture can now delay deletion and set its timeout. The new
runtime regression finishes a fixture model turn, waits six seconds for DELETE,
and checks that the lease is gone before success result/idle. Baseline failed
after 5151ms with teardown-failed. Fixed run passed after 6162ms. No paid model.

Checks:
- bun test tests/claude-compat-runtime.test.ts tests/claude-compat/mcp.test.ts:
  pass. The runtime file runs its assertions in its own SDK child process.
- Direct isolated runtime selection: delayed cleanup and all four failed-release
  cases pass (5 tests, 53 assertions). Real failures still emit no result/idle.
- bun run check: pass. Scoped Biome format: pass. Scoped lint: exit 0 with five
  existing style warnings. git diff --check: pass. No full repo suite claimed.
- bun run build: pass. Compiled model-free /status probe uses fixture auth and
  a six-second delayed discovery DELETE: success result, one idle, zero remote
  sessions, exit 0, empty stderr. The first probe with an empty fixture home
  correctly refused missing auth before making a DELETE; not a cleanup failure.

Local package probe: .cache/cleanup-timeout-probe.ts. Run with bun, not the
execute import bundler (that path hit an ajv directory-resolution error).
It accepts a binary path. It uses an isolated temporary home, fake fixture auth,
and no real credentials or model calls; the home and host are closed afterward.

Built binary SHA-256: 6dece829782b133bed418bfee0969552659bef3fa322b3ef33bce3547c3ab21b.
Previous installed binary: 7c8e963ef2682615340e81bc76ee4a16d79f7ae5b8622117cc74a1d5565ce768.
Both report 0.16.4. Local dependencies were copied into this worktree before
asset preparation, not modified through a shared node_modules link. No mise
trust settings were changed.

Install uses the normal scripts/install-local.sh with BRUV_SKIP_BUILD=1.
Rollback copies live in this worktree's .cache/provider-end-cleanup-rollback/.
No T3 restart or active-session cancellation: existing provider processes keep
the old executable until relaunched. A new T3 thread uses the installed fix.
The original failed turns stay failed; no historical state was rewritten.

Values unchanged. Existing real-path proof and honest resource ownership rules
cover the fix. The new local lesson is that cleanup must not silently use a
shorter deadline than the host contract.

Installed pair verified: the installed normal binary hash matches the build.
The delayed-host probe against /home/tnfssc/.local/bin/bruv passes with success
result, one idle, zero remote sessions, one DELETE, exit 0, and empty stderr.
Source edits and this note remain uncommitted on t3code/provider-turn-error.
