# Remaining pinned-T3 Effect compiler suggestions (2026-09-27)

Generated from `tsc --noEmit` in `.cache/t3-effect-b488c57/apps/server` after applying `die.patch` then `effect.patch`. Paths below are relative to `apps/server` (including `../../scripts`), locations are line:column; each location is one diagnostic. **272 suggestions remain**; no suppressions were added.

## TS377009 (1)

- `src/provider/acp/XAiAcpExtension.ts`: 1401:15

## TS377012 (13)

- `src/mcp/AcpMcpStdioBridge.ts`: 312:9
- `src/orchestration-v2/http.ts`: 225:11
- `src/orchestration/decider.ts`: 912:9
- `src/provider/acp/AcpSessionRuntime.processTree.test.ts`: 305:13, 331:9, 336:9, 342:11, 483:13, 498:9
- `src/provider/acp/AcpSessionRuntime.ts`: 499:7, 509:7, 525:7
- `src/textGeneration/ThreadTitleLinks.ts`: 18:5

## TS377015 (4)

- `scripts/acp-mock-agent.ts`: 842:16
- `src/mcp/toolkits/pullRequests/handlers.ts`: 169:27
- `src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts`: 1140:37
- `src/pullRequest/GitHubPullRequestCli.ts`: 1556:12

## TS377016 (3)

- `src/mcp/McpSessionRegistry.testkit.ts`: 22:20
- `src/orchestration-v2/Adapters/AntigravityAdapterV2.test.ts`: 18:17
- `src/textGeneration/AntigravityTextGeneration.ts`: 241:60

## TS377017 (6)

- `src/mcp/WorktreeMcpService.test.ts`: 370:3
- `src/orchestration-v2/Adapters/AcpAdapterV2.ts`: 4604:21, 5284:21
- `src/provider/Layers/cursorUsageLimits.test.ts`: 64:5
- `src/pullRequest/PullRequestService.test.ts`: 4415:9, 4486:9

## TS377095 (11)

- `src/environment/ServerEnvironmentMachine.ts`: 110:5, 128:7
- `src/mcp/toolkits/preview/handlers.ts`: 90:11
- `src/project/RepositoryIdentityResolver.ts`: 166:45
- `src/provider/Layers/cursorUsageLimits.ts`: 130:5
- `src/provider/Layers/grokUsageLimits.ts`: 138:5
- `src/provider/providerInstallation.ts`: 121:9
- `src/resourceTelemetry/HostResources.ts`: 63:15, 71:11
- `src/textGeneration/ThreadTitleLinks.ts`: 43:9
- `src/vcs/GitVcsDriver.ts`: 1110:13

## TS377098 (153)

- `../../scripts/lib/dev-share.ts`: 94:21
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
- `src/cloud/bootService.ts`: 420:38, 421:42, 422:42
- `src/cloud/CliTokenManager.test.ts`: 51:24
- `src/cloud/CliTokenManager.ts`: 124:28, 137:22, 151:22, 152:36
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
- `src/provider/acp/AcpSessionRuntime.ts`: 166:41
- `src/provider/AntigravityInstallation.test.ts`: 345:53
- `src/provider/AntigravityInstallation.ts`: 56:66, 57:63
- `src/provider/ClaudeModelManifest.ts`: 16:84, 17:52
- `src/provider/Drivers/GrokSkills.ts`: 34:38
- `src/provider/Layers/CodexCollabRuntime.integration.test.ts`: 35:18
- `src/provider/Layers/cursorUsageLimits.ts`: 20:72, 23:48, 24:47, 25:46
- `src/provider/Layers/EventNdjsonLogger.ts`: 99:19, 100:21
- `src/provider/Layers/grokUsageLimits.ts`: 27:50
- `src/provider/ModelManifest.ts`: 195:23
- `src/provider/providerSnapshot.ts`: 43:22, 44:26, 45:26
- `src/pullRequest/azureDevOpsPullRequestJson.ts`: 421:50
- `src/pullRequest/gitHubPullRequestJson.ts`: 2341:68
- `src/pullRequest/PullRequestProvider.ts`: 57:37
- `src/resourceTelemetry/DesktopTelemetryReceiver.ts`: 53:29, 54:29, 76:16, 88:16, 99:16, 100:26, 118:16, 131:16, 132:28
- `src/resourceTelemetry/NativeTelemetryClient.ts`: 70:23, 82:23, 93:29, 94:29, 128:22
- `src/serverRuntimeStartup.ts`: 60:18
- `src/sourceControl/BitbucketApi.ts`: 103:37, 120:37
- `src/sourceControl/GitLabCli.ts`: 333:14
- `src/sourceControl/gitLabMergeRequests.ts`: 52:59, 53:59
- `src/sourceControl/SourceControlRateLimit.ts`: 40:21
- `src/terminal/Manager.ts`: 119:52, 141:25
- `src/usage/cliproxyApi.ts`: 34:57, 36:24, 37:50, 38:48, 50:23, 60:55
- `src/usage/UsageService.ts`: 90:23
- `src/workspace/WorkspaceSearchIndex.ts`: 74:25, 75:22

## TS377099 (15)

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

## TS377103 (2)

- `src/cloud/selfUpdate.test.ts`: 108:19
- `src/mcp/McpSessionRegistry.ts`: 254:7

## TS377111 (7)

- `src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts`: 940:26, 952:26, 1146:28, 1169:37
- `src/orchestration-v2/Adapters/OpenCodeAdapterV2.ts`: 1067:33, 3279:43, 3440:47

## TS377112 (8)

- `src/orchestration-v2/Adapters/AcpRegistryAdapterV2.testkit.ts`: 29:32
- `src/orchestration-v2/Adapters/GrokAdapterV2.testkit.ts`: 26:38
- `src/orchestration-v2/Adapters/OpenCodeAdapterV2.test.ts`: 105:39
- `src/orchestration/decider.pullRequests.test.ts`: 297:41
- `src/provider/AntigravityInstallation.ts`: 318:26
- `src/pullRequest/PullRequestReadCache.ts`: 80:46
- `src/pullRequest/PullRequestService.ts`: 2761:35
- `src/terminal/BunPtyAdapter.test.ts`: 190:28

## TS377113 (12)

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

## TS377116 (20)

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

## TS377118 (4)

- `src/provider/acp/AcpSessionRuntime.ts`: 2064:17
- `src/terminal/Manager.ts`: 2021:7
- `src/vcs/GitVcsDriverCore.ts`: 946:11
- `src/ws.ts`: 1236:23

## TS377120 (12)

- `src/mcp/McpInvocationContext.ts`: 65:3
- `src/orchestration-v2/Orchestrator.ts`: 8852:7
- `src/orchestration-v2/ThreadManagementService.ts`: 449:7
- `src/orchestration/commandInvariants.ts`: 121:5, 140:5
- `src/project/RepositoryIdentityResolver.ts`: 164:9
- `src/provider/Drivers/CursorDriver.ts`: 113:9
- `src/provider/Drivers/GrokDriver.ts`: 112:9
- `src/pullRequest/GitHubPullRequestCli.ts`: 1574:7, 1818:9, 2031:11
- `src/vcs/GitVcsDriverCore.ts`: 1004:7

## TS377121 (1)

- `src/provider/makeManagedServerProvider.ts`: 255:9

