# T3 idle shutdown: app HTTP MCP lease lifetime

Task owner: task_b15b30b5. Runtime only. No shared UI/setup/history/CLI-doc edits. Independent worktree based on the tested v0.16.1 tag, not the parent's older v0.16.0 source. [Proof](proof/runtime-teardown/README.md).

## Observed cause

The clean task_a303e830 trial's shipped connector hash matches the recorded v0.16.1 Linux release asset; its source is cb32e158227dad6272af9ccf6fad2731f46ec62d. The original parent/worktree was 7404ee32 and product 0.16.0. We aligned this owned worktree before diagnosis; runtime/MCP/CLI sources are identical between those bases, but release Pi/history adaptation and the tracked grammar patch differ. No global installed binary was replaced.

A diagnostic-only rebuild of that tag reproduced a real Pi answer via the loopback provider and exit 1 after closing unchanged official T3 2644. Expanding the aggregate and then the redacted MCP teardown branch found:

Connector teardown failed → McpOperationError (teardown-failed) → HTTP transport terminateSession() → TypeError, code ConnectionRefused, on the T3 /mcp endpoint.

T3 HTTP was already down. This was not a provider/auth/version, Pi abort, task-manager, Live or history error. Merely starting MCP close earlier in runtime.close() also reproduced exit 1. Those diagnostic edits and the early-close experiment were removed, not shipped.

## Lifecycle fix

Only trusted app-owned **HTTP** MCP connections become active-run leases. Discovery closes its protocol session before native transport admission. Pi before_agent_start drains previous native completion/release work, then reacquires the lease for the next real owning run. Actual app tool calls also ensure the lease exists; permission and active-owner guards still run first. Reconnect initializes the same admitted server, retaining the launch's selected/discovered tools; concurrent acquisition shares one promise.

A real native result is withheld until the app HTTP session DELETE and local SDK client.close() both finish. Thus result/idle means no idle app HTTP resource is being retained for a later host shutdown. Process close still runs the ordinary lifetime abort, Pi abort/shutdown/dispose, root foreground/task ownership shutdown, Live shutdown, history flush and all remaining MCP cleanup. Park/close share each connection's one close promise, so no second DELETE targets an already released session.

This does **not** skip DELETE, treat ConnectionRefused/HTTP failure as success, cancel T3 child tasks, transfer their ownership, or catch-and-ignore the runtime aggregate. Failed remote release remains teardown-failed; local client closure is still attempted. External HTTP and all stdio MCP keep their existing persistent lifetime. The app-owned HTTP toolkit here is request/reply; no server-subscription continuity is claimed.

## Proof and bounds

- Real stateful SDK HTTP peer + actual Pi runtime/tool: baseline regression fails with one retained session after initialization; fixed seam proves discovery release, two real echo tool turns with distinct HTTP sessions, release before result/idle, Stop cancellation and next-run reuse, then host HTTP shutdown before idempotent runtime.close().
- Tests retain fatal DELETE failure and unavailable external-peer failure; concurrent reacquisition uses one lease. Existing permission, ambiguous-call/no-retry, stdio exit, app ownership, native task binding, saved questions, Live teardown and preflight cancellation suites remain covered.
- Focused preservation run: 96 outer tests pass, 8 opt-in skips, zero failures across 17 files, including the isolated SDK suites' inner assertions. Typecheck and formatting pass. Lint exits 0 with warnings/info; no broad lint cleanup.
- Final compiled source is pinned by hashes. Real unchanged 2644 browser/provider proof covers the original simple answer and two turns with the real read-only orchestrator_capabilities MCP tool. Connector teardown is checked separately from the UI send/result.
- No desktop/macOS/device/paid-provider acceptance, history/fork acceptance or full release gate is claimed. Setup/history and misleading unsupported/updater presentation remain the other owner's scope. An active run losing its host with an unreleased HTTP session can still fail remote teardown honestly; we do not claim confirmed remote deletion after a network/server loss.

## Setup caveat

An offline frozen-lockfile dependency restore reused the existing global Bun package cache. Cache root and .tmp directory mtimes changed at 09:34:28.990Z; no new package-cache entry was observed. This was a deviation from the requested no-global-writes bound; cache directory metadata was touched. No installed binary, global config or credentials were changed. No shared cache cleanup was attempted. Future setup must pin BUN_INSTALL_CACHE_DIR inside the worktree before package-manager commands.

Wisdom updated with this incident and reproducible bounded proof. Values unchanged: honest shipped-path proof, clear resource ownership and leaving shared/user state safe already cover the lesson.

## Failed release is a transport failure, not idle (v0.16.3 blocker)

Independent review reproduced rejected SDK peer DELETE: zero results, two idle frames, one retained remote session. Remembering an emit error is not enough: stop later output, retain the first failure for flush, and do not manufacture a second model result for a delivery failure.

Autonomous task wakes have no native onUser waiter. The fatal frontend-output callback closes the owning transport; its run loop reports failure and takes ordinary shutdown. No idle, retry DELETE, swallowed shutdown error, or timer. Pi still owns scheduling, steering, Stop and history. Raw Pi custom-message triggers bypass prompt preflight, so the autonomous regression acquires its lease through a real MCP tool call.

Reused reviewer regression now observes zero result/idle frames and one unconfirmed remote session. Real peer/transport regressions cover model input, no-model command, and active autonomous task wake: connector exits 1 with input still open, reports shutdown failure, and failed close is idempotent. Successful park/reacquire and Stop assertions remain. Bun 1.4.2: 56 focused outer passes, seven opt-in SDK-history skips; 25 direct runtime passes; typecheck/format pass, lint exits 0 with warnings/info. Offline fixture auth only; no packaged-provider/UI acceptance or release claim.

Values unchanged: honest lifecycle state, one owner, simplest observed fix.
