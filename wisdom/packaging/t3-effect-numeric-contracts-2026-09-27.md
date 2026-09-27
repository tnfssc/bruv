# Numeric contract decisions for TS377098 (2026-09-27)

Source: pinned `b488c57` plus `die.patch` and `effect.patch`. Review of all 153 changed numeric references in `effect-numbers.patch`: 152 use finite domains, **one must retain the entire number domain**. The original blanket-number-to-finite summary was incorrect. The producer of `EventNdjsonLogConfigurationError.value` rejects non-integers and values below the minimum, including NaN and infinities. Its error carries the *supplied* invalid value so it can be reported; `minimum` remains finite. Only the `value: Schema.Number` line has a documented `schemaNumber:off` annotation, not a compiler-wide suppression. In Effect tsgo tag `@effect/tsgo@0.41.0` (`71ced39`, `internal/rules/schema_number.go`), the rule exempts only `Schema.isFinite()`/`Schema.isInt()` checks (which would incorrectly exclude these values); its diagnostic explicitly recommends a line-local disable when nonfinite is intentional.

SQLite is another exception to a blind policy: `t3-sqlite-state` accepts arbitrary SQLite REAL query results; SQLite can return positive and negative infinity. The schema for the **JSON output** remains finite, but the producer now normalizes nonfinite REAL values into explicit `"Infinity"`/`"-Infinity"` strings before schema encoding instead of throwing or silently serializing as null. SQLite evaluates NaN as NULL; BLOB byte arrays remain finite. Other changed sites were reviewed by producer and boundary: SQL persisted sequence/count/boolean fields, serialized JSON claims, provider API values, process descriptors/status and timestamps have finite domains; the `ProjectionSnapshotQuery` infinity accumulator is converted to zero before crossing its SQL schema. Optional, nullable and string branches are retained. This migration does not add integer, range, or positivity constraints.

## Script state and reports (5)

- `scripts/lib/dev-share.ts`: 94
- `apps/server/scripts/evaluate-thread-titles.ts`: 55
- `apps/server/scripts/migrate-dev-db.ts`: 87, 120, 170

## SQL and JSON-array rows (22)

- `apps/server/scripts/t3-sqlite-state.ts`: 97, 98
- `apps/server/src/orchestration-v2/ProjectionSettlement.test.ts`: 37
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`: 103, 110, 116, 164, 165, 172, 173, 217, 218, 1555, 1556
- `apps/server/src/persistence/Errors.test.ts`: 12
- `apps/server/src/persistence/Layers/OrchestrationEventStore.ts`: 61, 87, 662
- `apps/server/src/persistence/Layers/ProjectionPendingApprovals.ts`: 73
- `apps/server/src/persistence/Layers/ProjectionProjects.ts`: 21
- `apps/server/src/persistence/Layers/ProjectionThreadMessages.ts`: 24, 29

## Wire claims, upstream APIs and provider diagnostics (43)

- `apps/server/src/assets/AssetAccess.ts`: 91, 98, 106, 119, 126, 132, 138, 146
- `apps/server/src/assets/AttachmentUpload.ts`: 52, 53
- `apps/server/src/auth/SessionStore.ts`: 142, 433, 434, 442, 443
- `apps/server/src/cloud/bootService.ts`: 420, 421, 422
- `apps/server/src/cloud/CliTokenManager.ts`: 124, 137, 151, 152
- `apps/server/src/cloud/pinnedRuntime.ts`: 77, 78, 79
- `apps/server/src/provider/acp/AcpSessionRuntime.ts`: 166
- `apps/server/src/provider/AntigravityInstallation.ts`: 56, 57
- `apps/server/src/provider/Drivers/GrokSkills.ts`: 34
- `apps/server/src/provider/Layers/EventNdjsonLogger.ts`: 99, 100
- `apps/server/src/provider/providerSnapshot.ts`: 43, 44, 45
- `apps/server/src/pullRequest/azureDevOpsPullRequestJson.ts`: 421
- `apps/server/src/pullRequest/gitHubPullRequestJson.ts`: 2341
- `apps/server/src/pullRequest/PullRequestProvider.ts`: 57
- `apps/server/src/sourceControl/BitbucketApi.ts`: 103, 120
- `apps/server/src/sourceControl/GitLabCli.ts`: 333
- `apps/server/src/sourceControl/gitLabMergeRequests.ts`: 52, 53
- `apps/server/src/sourceControl/SourceControlRateLimit.ts`: 40

## Test fixtures and replay contracts (22)

- `apps/server/src/assets/AttachmentUpload.test.ts`: 44, 45
- `apps/server/src/cloud/CliTokenManager.test.ts`: 51
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.testkit.ts`: 86, 99, 113, 128, 142, 143
- `apps/server/src/orchestration-v2/Adapters/CursorAdapterV2.testkit.ts`: 78, 91, 105, 106, 118
- `apps/server/src/orchestration-v2/Adapters/OpenCodeAdapterV2.testkit.ts`: 64, 78, 79
- `apps/server/src/orchestration-v2/testkit/ReplayFixtureWorkspace.ts`: 13
- `apps/server/src/orchestration-v2/testkit/ReplayTranscriptNdjson.ts`: 18
- `apps/server/src/orchestration-v2/testkit/ThreadFork.integration.test.ts`: 63
- `apps/server/src/provider/AntigravityInstallation.test.ts`: 345
- `apps/server/src/provider/Layers/CodexCollabRuntime.integration.test.ts`: 35

## Runtime counts, timestamps and process resources (46)

- `apps/server/src/bootstrap.ts`: 18, 30, 45, 57
- `apps/server/src/cli/pair.ts`: 110, 119, 128
- `apps/server/src/cli/project.ts`: 134
- `apps/server/src/cli/theme.ts`: 78, 116
- `apps/server/src/device/DeviceHost.ts`: 35
- `apps/server/src/device/DeviceToolchain.ts`: 53
- `apps/server/src/diagnostics/ProcessDiagnostics.ts`: 19
- `apps/server/src/environment/ServerEnvironmentLabel.ts`: 37
- `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts`: 1151
- `apps/server/src/orchestration-v2/CheckpointService.ts`: 58
- `apps/server/src/orchestration-v2/EventSink.ts`: 53, 67
- `apps/server/src/orchestration-v2/EventStore.ts`: 20, 32
- `apps/server/src/orchestration-v2/ProviderEventIngestor.ts`: 53
- `apps/server/src/processRunner.ts`: 53, 74, 88, 102, 103, 125
- `apps/server/src/resourceTelemetry/DesktopTelemetryReceiver.ts`: 53, 54, 76, 88, 99, 100, 118, 131, 132
- `apps/server/src/resourceTelemetry/NativeTelemetryClient.ts`: 70, 82, 93, 94, 128
- `apps/server/src/serverRuntimeStartup.ts`: 60
- `apps/server/src/terminal/Manager.ts`: 119, 141
- `apps/server/src/workspace/WorkspaceSearchIndex.ts`: 74, 75

## Provider usage and model limits (15)

- `apps/server/src/provider/ClaudeModelManifest.ts`: 16, 17
- `apps/server/src/provider/Layers/cursorUsageLimits.ts`: 20, 23, 24, 25
- `apps/server/src/provider/Layers/grokUsageLimits.ts`: 27
- `apps/server/src/provider/ModelManifest.ts`: 195
- `apps/server/src/usage/cliproxyApi.ts`: 34, 36, 37, 38, 50, 60
- `apps/server/src/usage/UsageService.ts`: 90

## Verification

`src/numericContracts.test.ts` exercises the exported Claude profile schema and the real tagged diagnostic error (including NaN and both infinities); `scripts/t3-sqlite-state.test.ts` queries actual SQLite REAL infinities through exported `runSqliteState` and checks JSON-safe result strings and SQLite NULL. No toy SQL/provider schema substitutes. The existing logger suite also exercises `makeEventNdjsonLogStore` with NaN and both infinities (26 tests across three files pass). `effect-tsgo` v0.41.0 reports 119 messages, 0 errors/warnings, and zero TS377098 after the review. `tsc --noEmit` passes with the pinned workspace dependencies linked into the isolated checkout.

## Exact remaining Effect diagnostics (post-fix)

`effect-tsgo diagnostics --project apps/server/tsconfig.json --format json`: 119 messages, 0 errors, 0 warnings, 1190 files; `TS377098`: 0. No new test-file suggestions. Other rule families remain for their respective owners. Locations below use paths relative to `apps/server` and 1-based line:column.

### TS377009 (1)

- `src/provider/acp/XAiAcpExtension.ts`: 1401:15

### TS377012 (13)

- `src/mcp/AcpMcpStdioBridge.ts`: 312:9
- `src/orchestration-v2/http.ts`: 225:11
- `src/orchestration/decider.ts`: 912:9
- `src/provider/acp/AcpSessionRuntime.processTree.test.ts`: 305:13, 331:9, 336:9, 342:11, 483:13, 498:9
- `src/provider/acp/AcpSessionRuntime.ts`: 499:7, 509:7, 525:7
- `src/textGeneration/ThreadTitleLinks.ts`: 18:5

### TS377015 (4)

- `scripts/acp-mock-agent.ts`: 842:16
- `src/mcp/toolkits/pullRequests/handlers.ts`: 169:27
- `src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts`: 1140:37
- `src/pullRequest/GitHubPullRequestCli.ts`: 1556:12

### TS377016 (3)

- `src/mcp/McpSessionRegistry.testkit.ts`: 22:20
- `src/orchestration-v2/Adapters/AntigravityAdapterV2.test.ts`: 18:17
- `src/textGeneration/AntigravityTextGeneration.ts`: 241:60

### TS377017 (6)

- `src/mcp/WorktreeMcpService.test.ts`: 370:3
- `src/orchestration-v2/Adapters/AcpAdapterV2.ts`: 4604:21, 5284:21
- `src/provider/Layers/cursorUsageLimits.test.ts`: 64:5
- `src/pullRequest/PullRequestService.test.ts`: 4415:9, 4486:9

### TS377095 (11)

- `src/environment/ServerEnvironmentMachine.ts`: 110:5, 128:7
- `src/mcp/toolkits/preview/handlers.ts`: 90:11
- `src/project/RepositoryIdentityResolver.ts`: 166:45
- `src/provider/Layers/cursorUsageLimits.ts`: 130:5
- `src/provider/Layers/grokUsageLimits.ts`: 138:5
- `src/provider/providerInstallation.ts`: 121:9
- `src/resourceTelemetry/HostResources.ts`: 63:15, 71:11
- `src/textGeneration/ThreadTitleLinks.ts`: 43:9
- `src/vcs/GitVcsDriver.ts`: 1110:13

### TS377099 (15)

- `src/device/DeviceHubProxy.ts`: 144:10
- `src/device/LocalDeviceHost.ts`: 329:11, 425:7
- `src/git/GitManager.ts`: 2068:62
- `src/mcp/AcpMcpStdioBridge.ts`: 355:7
- `src/orchestration/Layers/OrchestrationEngine.ts`: 334:23
- `src/provider/acp/XAiAcpExtension.ts`: 1401:15
- `src/provider/Layers/CodexSessionRuntime.ts`: 1525:11
- `src/provider/ModelManifest.ts`: 406:7
- `src/textGeneration/CodexTextGeneration.test.ts`: 589:57, 612:46
- `src/textGeneration/CodexTextGeneration.ts`: 77:38, 82:13
- `src/usage/UsageService.ts`: 228:7, 375:7

### TS377103 (2)

- `src/cloud/selfUpdate.test.ts`: 108:19
- `src/mcp/McpSessionRegistry.ts`: 254:7

### TS377111 (7)

- `src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts`: 940:26, 952:26, 1146:28, 1169:37
- `src/orchestration-v2/Adapters/OpenCodeAdapterV2.ts`: 1067:33, 3279:43, 3440:47

### TS377112 (8)

- `src/orchestration-v2/Adapters/AcpRegistryAdapterV2.testkit.ts`: 29:32
- `src/orchestration-v2/Adapters/GrokAdapterV2.testkit.ts`: 26:38
- `src/orchestration-v2/Adapters/OpenCodeAdapterV2.test.ts`: 105:39
- `src/orchestration/decider.pullRequests.test.ts`: 297:41
- `src/provider/AntigravityInstallation.ts`: 318:26
- `src/pullRequest/PullRequestReadCache.ts`: 80:46
- `src/pullRequest/PullRequestService.ts`: 2761:35
- `src/terminal/BunPtyAdapter.test.ts`: 190:28

### TS377113 (12)

- `scripts/replayRecorderDeferredRegistry.test.ts`: 21:12
- `src/cloud/http.ts`: 139:10
- `src/diagnostics/TraceDiagnostics.ts`: 423:30
- `src/keybindings.test.ts`: 570:16
- `src/orchestration-v2/ProjectionStore.ts`: 4264:32, 4267:30
- `src/provider/acp/AcpClientTerminals.test.ts`: 265:32
- `src/pullRequest/PullRequestService.test.ts`: 3337:12
- `src/serverSettings.test.ts`: 300:30
- `src/sourceControl/GitHubCli.test.ts`: 158:30
- `src/sourceControl/SourceControlProviderRegistry.ts`: 292:17
- `src/vcs/VcsStatusBroadcaster.ts`: 544:19

### TS377116 (20)

- `src/environment/ServerEnvironment.ts`: 133:11
- `src/mcp/toolkits/preview/handlers.ts`: 178:5
- `src/orchestration-v2/CheckpointRestoreSafety.ts`: 43:17
- `src/orchestration-v2/ProviderTurnStartService.ts`: 436:15
- `src/orchestration-v2/RunExecutionService.ts`: 791:15
- `src/orchestration-v2/ThreadPullRequestService.ts`: 229:15, 295:17, 307:11, 322:7
- `src/orchestration-v2/ThreadSettlementService.ts`: 310:11, 453:11, 471:7
- `src/orchestration/PullRequestSyncReactor.ts`: 262:13
- `src/persistence/initializeV2Database.ts`: 45:9
- `src/provider/acp/AcpRegistrySupport.ts`: 1264:9
- `src/provider/acp/AcpSessionRuntime.ts`: 2323:9, 2685:17
- `src/provider/acp/XAiAcpExtension.ts`: 1459:15
- `src/provider/antigravityAuthSupport.ts`: 268:9
- `src/storageCleanup.ts`: 439:7

### TS377118 (4)

- `src/provider/acp/AcpSessionRuntime.ts`: 2064:17
- `src/terminal/Manager.ts`: 2021:7
- `src/vcs/GitVcsDriverCore.ts`: 946:11
- `src/ws.ts`: 1236:23

### TS377120 (12)

- `src/mcp/McpInvocationContext.ts`: 65:3
- `src/orchestration-v2/Orchestrator.ts`: 8852:7
- `src/orchestration-v2/ThreadManagementService.ts`: 449:7
- `src/orchestration/commandInvariants.ts`: 121:5, 140:5
- `src/project/RepositoryIdentityResolver.ts`: 164:9
- `src/provider/Drivers/CursorDriver.ts`: 113:9
- `src/provider/Drivers/GrokDriver.ts`: 112:9
- `src/pullRequest/GitHubPullRequestCli.ts`: 1574:7, 1818:9, 2031:11
- `src/vcs/GitVcsDriverCore.ts`: 1004:7

### TS377121 (1)

- `src/provider/makeManagedServerProvider.ts`: 255:9
