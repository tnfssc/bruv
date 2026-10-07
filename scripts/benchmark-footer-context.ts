// Isolate full footer renders against real disk-backed history. No provider required.
// Run: bun scripts/benchmark-footer-context.ts. Times are local evidence, not CI thresholds.
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentSession,
  buildSessionProjection,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
  SessionManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { installShakeAccountingAdapter } from "../src/agent/manual-shake";
import { DiskEntryStore } from "../src/history/disk-entry-store";
import { disposeDiskBackedSessionManager, installDiskBackedSessionManager } from "../src/history/session-manager";
import { renderCompactFooter, renderDetailedFooter } from "../src/ui/footer";

const nativeContextUsage = AgentSession.prototype.getContextUsage;
installDiskBackedSessionManager();
installShakeAccountingAdapter();
const usage = {
  input: 8192,
  output: 512,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 8704,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const model = { id: "fixture-model", provider: "fixture", contextWindow: 200000 };
const theme = { fg: (_color: string, text: string) => text } as Theme;
const data = {
  getGitBranch: () => undefined,
  getAvailableProviderCount: () => 1,
  getExtensionStatuses: () => new Map(),
} as unknown as ReadonlyFooterDataProvider;
// Each reader keeps its estimator and receiver together. The native reference
// uses the SDK projection builder, never the adapter's cache-seeding hook.
function contextUsageReaders(manager: SessionManager) {
  const cachedContextUsage = AgentSession.prototype.getContextUsage;
  const cachedHost = { sessionManager: manager, _limitsModel: () => model } as unknown as AgentSession;
  const nativeHost = {
    _limitsModel: () => model,
    sessionManager: {
      buildSessionProjection: () => buildSessionProjection(manager.getEntries(), manager.getLeafId()),
      getBranch: () => manager.getBranch(),
    },
  } as unknown as AgentSession;
  return [
    { mode: "uncached-sdk", getContextUsage: () => nativeContextUsage.call(nativeHost) },
    { mode: "cached-sdk", getContextUsage: () => cachedContextUsage.call(cachedHost) },
  ] as const;
}

function measureFooterFrames(render: typeof renderCompactFooter, ctx: ExtensionContext) {
  const materialize = DiskEntryStore.prototype.materialize;
  let materializations = 0;
  DiskEntryStore.prototype.materialize = function (...args) {
    materializations++;
    return materialize.apply(this, args);
  };
  try {
    // Warm both context accounting and footer summaries before measuring frames.
    render(ctx, data, theme, 100);
    materializations = 0;
    const samples: number[] = [];
    for (let sample = 0; sample < 5; sample++) {
      const start = performance.now();
      render(ctx, data, theme, 100);
      samples.push(performance.now() - start);
    }
    return {
      medianMs: +samples.sort((a, b) => a - b)[2]!.toFixed(3),
      historicalMaterializationsPerFrame: materializations / samples.length,
    };
  } finally {
    DiskEntryStore.prototype.materialize = materialize;
  }
}

function benchmarkHistory(turns: number) {
  const home = mkdtempSync(join(tmpdir(), "bruv-footer-bench-"));
  const manager = SessionManager.create(home, home);
  try {
    for (let turn = 0; turn < turns; turn++) {
      manager.appendMessage({ role: "user", content: "Request " + turn + " paragraph ".repeat(100), timestamp: 1 });
      manager.appendMessage({
        role: "assistant",
        content: [
          { type: "text", text: ("## Section " + turn + "\nSome markdown **content** and more words.\n").repeat(100) },
        ],
        api: "openai-completions",
        provider: "fixture",
        model: "fixture-model",
        usage,
        stopReason: "stop",
        timestamp: 1,
      });
    }
    for (const { mode, getContextUsage } of contextUsageReaders(manager)) {
      const ctx = {
        mode: "tui",
        sessionManager: manager,
        model,
        modelRegistry: { isUsingOAuth: () => false },
        getContextUsage,
        ui: { theme },
      } as unknown as ExtensionContext;
      for (const [name, render] of [
        ["compact", renderCompactFooter],
        ["detailed", renderDetailedFooter],
      ] as const) {
        const measurement = measureFooterFrames(render, ctx);
        console.log(
          JSON.stringify({
            mode,
            footer: name,
            turns,
            entries: turns * 2,
            fileBytes: statSync(manager.getSessionFile()!).size,
            ...measurement,
          }),
        );
      }
    }
  } finally {
    disposeDiskBackedSessionManager(manager);
    rmSync(home, { recursive: true, force: true });
  }
}

for (const turns of [20, 200, 1000]) benchmarkHistory(turns);
