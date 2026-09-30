/** Audited source feedback, not compiled/Docker/SSH artifact validation. */
export const remoteSources = [
  "src/remote/artifacts.ts",
  "src/remote/cancellation.ts",
  "src/remote/capabilities.ts",
  "src/remote/capability-runtime.ts",
  "src/remote/client.ts",
  "src/remote/entry.ts",
  "src/remote/extension.ts",
  "src/remote/human-rendering.ts",
  "src/remote/job-artifacts.ts",
  "src/remote/job-delivery.ts",
  "src/remote/job-events.ts",
  "src/remote/job-observations.ts",
  "src/remote/jobs.ts",
  "src/remote/menu.ts",
  "src/remote/operations.ts",
  "src/remote/owner.ts",
  "src/remote/protocol.ts",
  "src/remote/repository-wire.ts",
  "src/remote/repository.ts",
  "src/remote/runtime.ts",
  "src/remote/security.ts",
  "src/remote/services.ts",
  "src/remote/ssh.ts",
  "src/remote/untracked-preview.ts",
] as const;
export const remoteTests = [
  "tests/remote-artifacts.test.ts",
  "tests/remote-capabilities.test.ts",
  "tests/remote-capability-runtime.test.ts",
  "tests/remote-client.test.ts",
  "tests/remote-extension.test.ts",
  "tests/remote-human-rendering.test.ts",
  "tests/remote-job-artifacts.test.ts",
  "tests/remote-job-delivery.test.ts",
  "tests/remote-job-observations.test.ts",
  "tests/remote-jobs.test.ts",
  "tests/remote-menu.test.ts",
  "tests/remote-owner.test.ts",
  "tests/remote-repository-wire.test.ts",
  "tests/remote-repository.test.ts",
  "tests/remote-runtime.test.ts",
  "tests/remote-session-switch.test.ts",
  "tests/remote-ssh.test.ts",
] as const;
/** Human research/reference only: no build, prompt or fixture consumer (see wisdom). */
export const remoteReferenceDocs = [
  "wisdom/remote-workspaces/accepted-reply-session-switch-dogfood-2026-09-27.md",
  "wisdom/remote-workspaces/combined-compiled-docker-2026-09-27.md",
  "wisdom/remote-workspaces/combined-dogfood-2026-09-27.md",
  "wisdom/remote-workspaces/combined-ui-jobs-validation.md",
  "wisdom/remote-workspaces/compiled-remote-pty-acceptance.md",
  "wisdom/remote-workspaces/current-repo-probe.md",
  "wisdom/remote-workspaces/daily-dogfood-2026-09-27.md",
  "wisdom/remote-workspaces/discovery-synthesis.md",
  "wisdom/remote-workspaces/durable-transcript-experiment.md",
  "wisdom/remote-workspaces/environment-research-2026-09-26.md",
  "wisdom/remote-workspaces/execute-live-integration.md",
  "wisdom/remote-workspaces/experiment-findings.md",
  "wisdom/remote-workspaces/experiment-plan.md",
  "wisdom/remote-workspaces/failure-probe.md",
  "wisdom/remote-workspaces/human-progress-followup.md",
  "wisdom/remote-workspaces/human-rendering-polling.md",
  "wisdom/remote-workspaces/human-rendering-recovery.md",
  "wisdom/remote-workspaces/human-ui-followup.md",
  "wisdom/remote-workspaces/human-ux-acceptance-2026-09-27.md",
  "wisdom/remote-workspaces/independent-compiled-docker-dogfood-2026-09-27.md",
  "wisdom/remote-workspaces/integrated-cli-experience.md",
  "wisdom/remote-workspaces/integrated-normal-session.md",
  "wisdom/remote-workspaces/job-delivery-contract.md",
  "wisdom/remote-workspaces/jobs-adapter-contract.md",
  "wisdom/remote-workspaces/jobs-integration.md",
  "wisdom/remote-workspaces/local-capabilities.md",
  "wisdom/remote-workspaces/native-production-integration.md",
  "wisdom/remote-workspaces/native-question-ownership-fix.md",
  "wisdom/remote-workspaces/native-question-probe.md",
  "wisdom/remote-workspaces/network-lab.md",
  "wisdom/remote-workspaces/normal-cli-menu-2026-09-27.md",
  "wisdom/remote-workspaces/offline-first-direction.md",
  "wisdom/remote-workspaces/on-demand-repo-file-read.md",
  "wisdom/remote-workspaces/production-first-slice.md",
  "wisdom/remote-workspaces/production-repository-handoff.md",
  "wisdom/remote-workspaces/production-ssh-slice.md",
  "wisdom/remote-workspaces/remote-agent-probe.md",
  "wisdom/remote-workspaces/remote-jobs-cli-proof.md",
  "wisdom/remote-workspaces/remote-jobs-integration-audit.md",
  "wisdom/remote-workspaces/remote-profile-discovery.md",
  "wisdom/remote-workspaces/remote-review.md",
  "wisdom/remote-workspaces/repo-return-integration.md",
  "wisdom/remote-workspaces/review-hold.md",
  "wisdom/remote-workspaces/runtime-research-2026-09-26.md",
  "wisdom/remote-workspaces/ssh-native-question-combined.md",
  "wisdom/remote-workspaces/ssh-prototype.md",
  "wisdom/remote-workspaces/ssh-research.md",
  "wisdom/remote-workspaces/ssh-transport-probe.md",
  "wisdom/remote-workspaces/startup-replay-followup.md",
  "wisdom/remote-workspaces/stream-probe.md",
  "wisdom/remote-workspaces/task-experience-contract.md",
  "wisdom/remote-workspaces/task-poc.md",
  "wisdom/remote-workspaces/transcript-probe.md",
  "wisdom/remote-workspaces/untracked-preview-and-lock-2026-09-27.md",
  "wisdom/remote-workspaces/user-decisions.md",
  "wisdom/remote-workspaces/wire-bench.md",
  "wisdom/dependencies/claude-workflows-research.md",
  "wisdom/dependencies/daily-dependency-prs.md",
  "wisdom/dependencies/deps-release-2026-09-29.md",
  "wisdom/dependencies/deps-release-v033.md",
  "wisdom/dependencies/deps-release-v054.md",
  "wisdom/dependencies/direct-registry-audit-2026-09-24.md",
  "wisdom/dependencies/hosted-pr-acceptance.md",
  "wisdom/dependencies/pi-0.87-upgrade.md",
  "wisdom/dependencies/pi-0.87.1-update.md",
  "wisdom/dependencies/pi-0.99.1-sol-upgrade.md",
  "wisdom/dependencies/pi-mcp-codemode-audit.md",
  "wisdom/dependencies/pi-mcp-codemode-removal.md",
  "wisdom/configuration/agent-config-discovery.md",
  "src/remote/README.md",
  "src/remote/CAPABILITY-INTEGRATION.md",
  "src/remote/repository.md",
] as const;

export const reverseSourceTests = [
  "tests/execution-previews.test.ts",
  "tests/goals-live.test.ts",
  "tests/herdr-agent-state.test.ts",
  "tests/job-attention.test.ts",
  "tests/job-bridge-protocol.test.ts",
  "tests/job-service.test.ts",
  "tests/live-host-access.test.ts",
  "tests/live-host-bridge.test.ts",
  "tests/live-main-owner.test.ts",
  "tests/prompt-delivery.test.ts",
  "tests/stop-work.test.ts",
  "tests/subagent-extension.test.ts",
  "tests/t3/native-routing.test.ts",
  "tests/tool-schema.test.ts",
  "tests/worktree-workspace.test.ts",
] as const;
export const processSourceTests = ["tests/ci-remote-cli-source.test.ts", "tests/live-spoken-tui.test.ts"] as const;
export const sourceProcessInputs = [
  "tests/ci-remote-offline-source-pty.py",
  "tests/fixtures/live-spoken-tui.ts",
  "tests/live-tui-startup.ts",
] as const;
/** These consumers remain full-tier. Never run against an existing dist in this lane. */
export const fullTierConsumers = [
  // SDK fake-fetch/global prototype suites and server integration retained whole:
  // expanded reverse union was cancelled after 173s without finishing; no <60s claim or quiet omission.
  "tests/attention-sdk.test.ts",
  "tests/auto-shake-sdk.test.ts",
  "tests/cache-affine-compaction-sdk.test.ts",
  "tests/cache-countdown-sdk.test.ts",
  "tests/current-pipeline-sdk.test.ts",
  "tests/goals-sdk.test.ts",
  "tests/instruction-continuity-sdk.test.ts",
  "tests/main-agent-mode-sdk.test.ts",
  "tests/manual-shake-sdk.test.ts",
  "tests/phase2-native-sdk.test.ts",
  "tests/t3/production-bridge.test.ts",
  "tests/phase2-native-live.test.ts", // paid/network opt-in acceptance
  "tests/live-main-integration.test.ts", // compiled auto-detection: retained whole, never stale dist
  "tests/pi-host.test.ts", // mixed source/compiled, retained whole, not silently filtered
  "tests/job-bridge.test.ts",
  "tests/typescript-runner.test.ts",
  "tests/remote-e2e.test.ts",
  "tests/remote-jobs-e2e.test.ts",
  "tests/remote-offline-menu-pty.py",
  "scripts/remote-e2e.sh",
  "scripts/remote-e2e.ts",
  "scripts/remote-pty-e2e.ts",
  "scripts/remote-jobs-e2e.ts",
  "scripts/remote-recovery-e2e.ts",
] as const;

export type RemoteChange = { path: string; status: string; oldPath?: string };
export type RemoteClassification = "source" | "reference" | "full";
const owned = new Set<string>([...remoteSources, ...remoteTests, ...sourceProcessInputs, ...processSourceTests]);
const reference = new Set<string>(remoteReferenceDocs);
/** Parent must inspect both trees/modes and normalize Git renames to delete+add.
 * Unknown paths/deletions are intentionally full. Known additions need the
 * same head-tree/mode audit as modifications. This is a path ownership
 * decision, not revision validation or authorization to skip the full merge gate.
 */
export function classifyRemoteChange(change: RemoteChange): RemoteClassification {
  if (!["M", "A"].includes(change.status) || change.oldPath) return "full";
  if (reference.has(change.path)) return "reference";
  return owned.has(change.path) ? "source" : "full";
}
export type SourceCommand = { argv: string[]; purpose: string };
/** Always union explicit process/fixture consumers with Bun's static reverse imports.
 * Call only on the validated checked-out head, with resolved base SHA, fresh assets,
 * Bun 1.4.2, SHELL=/bin/bash and an isolated TMPDIR under /home.
 */
export function remoteSourceCommands(base: string, bun = process.execPath): SourceCommand[] {
  if (!/^[a-f0-9]{40,64}$/.test(base)) throw new Error("Resolved base commit required");
  return [
    { argv: [bun, "scripts/prepare-assets.ts"], purpose: "fresh root Pi assets; no web/build" },
    {
      argv: [bun, "test", ...remoteTests, ...processSourceTests],
      purpose: "remote behavior + source CLI/PTY and explicit fixtures",
    },
    {
      argv: [bun, "test", ...reverseSourceTests, `--changed=${base}`],
      purpose: "audited source-only reverse consumers (static imports)",
    },
  ];
}
