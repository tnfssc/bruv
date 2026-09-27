# Effect control-flow diagnostics: pinned T3 (2026-09-27)

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

## Exact remaining TS377098 inventory (153)

- `scripts/evaluate-thread-titles.ts`: 55:25
- `scripts/migrate-dev-db.ts`: 87:17, 120:18, 170:78
- `scripts/t3-sqlite-state.ts`: 97:10, 98:23
- `src/assets/AssetAccess.ts`: 91:23, 98:23, 106:23, 119:23, 126:23, 132:23, 138:23, 146:23
- `src/assets/AttachmentUpload.test.ts`: 44:21, 45:21
- `src/assets/AttachmentUpload.ts`: 52:21, 53:21
- `src/auth/SessionStore.ts`: 142:29, 433:15, 434:15, 442:15, 443:15
- `src/bootstrap.ts`: 18:16, 30:16, 45:16, 57:16
- `src/cli/pair.ts`: 110:23, 119:23, 128:23
- `src/cli/project.ts`: 134:32
- `src/cli/theme.ts`: 78:51, 116:44
- `src/cloud/CliTokenManager.test.ts`: 51:24
- `src/cloud/CliTokenManager.ts`: 124:28, 137:22, 151:22, 152:36
- `src/cloud/bootService.ts`: 420:38, 421:42, 422:42
- `src/cloud/pinnedRuntime.ts`: 77:38, 78:42, 79:42
- `src/device/DeviceHost.ts`: 35:46
- `src/device/DeviceToolchain.ts`: 53:38
- `src/diagnostics/ProcessDiagnostics.ts`: 19:17
- `src/environment/ServerEnvironmentLabel.ts`: 37:27
- `src/orchestration-v2/Adapters/ClaudeAdapterV2.testkit.ts`: 86:20, 99:20, 113:20, 128:20, 142:20, 143:23
- `src/orchestration-v2/Adapters/CodexAdapterV2.ts`: 1151:80
- `src/orchestration-v2/Adapters/CursorAdapterV2.testkit.ts`: 78:20, 91:20, 105:20, 106:23, 118:20
- `src/orchestration-v2/Adapters/OpenCodeAdapterV2.testkit.ts`: 64:20, 78:20, 79:23
- `src/orchestration-v2/CheckpointService.ts`: 58:32
- `src/orchestration-v2/EventSink.ts`: 53:24, 67:43
- `src/orchestration-v2/EventStore.ts`: 20:24, 32:43
- `src/orchestration-v2/ProjectionSettlement.test.ts`: 37:83
- `src/orchestration-v2/ProviderEventIngestor.ts`: 53:24
- `src/orchestration-v2/testkit/ReplayFixtureWorkspace.ts`: 13:22
- `src/orchestration-v2/testkit/ReplayTranscriptNdjson.ts`: 18:24
- `src/orchestration-v2/testkit/ThreadFork.integration.test.ts`: 63:22
- `src/orchestration/Layers/ProjectionSnapshotQuery.ts`: 103:22, 110:25, 116:48, 164:24, 165:23, 172:22, 173:24, 217:25, 218:23, 1555:70, 1556:66
- `src/persistence/Errors.test.ts`: 12:23
- `src/persistence/Layers/OrchestrationEventStore.ts`: 61:35, 87:17, 662:46
- `src/persistence/Layers/ProjectionPendingApprovals.ts`: 73:43
- `src/persistence/Layers/ProjectionProjects.ts`: 21:22
- `src/persistence/Layers/ProjectionThreadMessages.ts`: 24:25, 29:81
- `src/processRunner.ts`: 53:25, 74:51, 88:24, 102:22, 103:27, 125:23
- `src/provider/AntigravityInstallation.test.ts`: 345:53
- `src/provider/AntigravityInstallation.ts`: 56:66, 57:63
- `src/provider/ClaudeModelManifest.ts`: 16:84, 17:52
- `src/provider/Drivers/GrokSkills.ts`: 34:38
- `src/provider/Layers/CodexCollabRuntime.integration.test.ts`: 35:18
- `src/provider/Layers/EventNdjsonLogger.ts`: 99:19, 100:21
- `src/provider/Layers/cursorUsageLimits.ts`: 20:72, 23:48, 24:47, 25:46
- `src/provider/Layers/grokUsageLimits.ts`: 27:50
- `src/provider/ModelManifest.ts`: 195:23
- `src/provider/acp/AcpSessionRuntime.ts`: 167:41
- `src/provider/providerSnapshot.ts`: 43:22, 44:26, 45:26
- `src/pullRequest/PullRequestProvider.ts`: 57:37
- `src/pullRequest/azureDevOpsPullRequestJson.ts`: 421:50
- `src/pullRequest/gitHubPullRequestJson.ts`: 2341:68
- `src/resourceTelemetry/DesktopTelemetryReceiver.ts`: 53:29, 54:29, 76:16, 88:16, 99:16, 100:26, 118:16, 131:16, 132:28
- `src/resourceTelemetry/NativeTelemetryClient.ts`: 70:23, 82:23, 93:29, 94:29, 128:22
- `src/serverRuntimeStartup.ts`: 60:18
- `src/sourceControl/BitbucketApi.ts`: 103:37, 120:37
- `src/sourceControl/GitLabCli.ts`: 333:14
- `src/sourceControl/SourceControlRateLimit.ts`: 40:21
- `src/sourceControl/gitLabMergeRequests.ts`: 52:59, 53:59
- `src/terminal/Manager.ts`: 119:52, 141:25
- `src/usage/UsageService.ts`: 90:23
- `src/usage/cliproxyApi.ts`: 34:57, 36:24, 37:50, 38:48, 50:23, 60:55
- `src/workspace/WorkspaceSearchIndex.ts`: 74:25, 75:22
- `../../scripts/lib/dev-share.ts`: 94:21
