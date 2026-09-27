# Numeric contract decisions for TS377098 (2026-09-27)

> Integrated into `integrations/t3/upstream/die.patch`. Incremental patch names below are historical review artifacts, not current build inputs. See [final installer handoff](install-local-warning-fixes-2026-09-27.md) for current evidence.

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
