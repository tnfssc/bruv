# Effect control-flow diagnostics: pinned T3 (2026-09-27)

> Integrated into `integrations/t3/upstream/die.patch`. Incremental patch names below are historical review artifacts, not current build inputs. See [final installer handoff](install-local-warning-fixes-2026-09-27.md) for current evidence.

Source pin: `b488c57f3f9f1688e31c53daee99e29dd1d0baa2`. Apply `die.patch`, `effect.patch`, then `effect-control.patch` in that order. The new patch is an incremental worktree-versus-index diff; it does not alter the two existing patches. No diagnostic suppression or filtering was introduced. No publishing or tags.

The patched server compiler (`cd apps/server && ../../node_modules/.bin/tsc --noEmit --pretty false`) exits 0: **153 suggestions, all TS377098 (Schema.Number)**. **Zero remaining non-TS377098 diagnostics**; schema fields belong to the separate schema worker. The exact remaining inventory below was captured only after the control-flow changes and the final compiler run.

## What changed and why

- Selective error recovery now uses `catchIf` / `catchCauseIf`; cause-only interruption still propagates. Ignoring typed errors uses `ignore`, whereas intentionally ignoring defects uses `ignoreCause`. Validations create errors only on failure with `filterOrFail`.
- Synchronous parsing and cgroup lease operations use `Effect.try`, preserving retry, ENOENT / EBUSY, and typed termination-error branches. The HTTP cursor is decoded once, and unexpected parse failures still become internal errors. Timeout replacement races the same queue arm against the same duration and returns true only on timeout.
- The OpenCode subscription uses `Effect.abortSignal` tied to the session scope, rather than a separate manual finalizer. Prompt admission still needs *imperative* per-turn abort: interruption and command timeout cancel individual requests while a forked command may outlive the admission fiber. Closing the Effect fiber scope as the diagnostic recommends would prematurely abort the forked command. `makeAdmissionAbortController` names this distinct cancellation ownership; command controllers are removed on completion.
- An API returning `T | undefined` must not be converted to `Effect.void` (`void` is incompatible with `undefined` in this repo). The few intentionally absent results instead explicitly adapt `Effect.void` to an `undefined` result via `Effect.as`, retaining the exact public contract.
- Typed schema decode calls and `forEach` retain input types and effect evaluation order. The malformed-link test checks that a failed URL parse does not prevent a later valid link from resolving.

## Validation

- Final patched compiler: exit 0; 153 `TS377098`, no errors and no other suggestions.
- Focused tests: `makeManagedServerProvider.test.ts`, `AcpSessionRuntime.processTree.test.ts`, `ClaudeAdapterV2.test.ts`, `ThreadTitleLinks.test.ts`: 153 passing before adding malformed-link regression; malformed-link test rerun: 4 passing. `OpenCodeAdapterV2.test.ts`: 44 passing after scoped subscription fix.
- A broader test command also ran `PullRequestService.test.ts` and `GitHubPullRequestCli.test.ts`; those two suites passed (316 total in that command). OpenCode failed in that intermediate command because one old finalizer still referenced a removed controller; the finalizer was removed and OpenCode's full 44-test suite then passed.


The reviewed source checkout was moved out of tmpfs to `/home/tnfssc/.die/worktrees/die-a86675007a5e-task_a478759f-a86675007a5e-task_c87953d1/.cache/t3-effect-control-reviewed` after the worker completed. Final authoritative integrated source is the final-installer checkout in the parent handoff.
