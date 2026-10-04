// Isolate full footer renders against real disk-backed history. No provider required.
// Run: bun scripts/benchmark-footer-context.ts. Times are local evidence, not CI thresholds.
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentSession,
  SessionManager,
  type ExtensionContext,
  type Theme,
  type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { DiskEntryStore } from "../src/history/disk-entry-store";
import { installDiskBackedSessionManager, disposeDiskBackedSessionManager } from "../src/history/session-manager";
import { renderCompactFooter, renderDetailedFooter } from "../src/ui/footer";

const nativeContextUsage = AgentSession.prototype.getContextUsage;
installDiskBackedSessionManager();
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
const materialize = DiskEntryStore.prototype.materialize;
let materializations = 0;
DiskEntryStore.prototype.materialize = function (...args) {
  materializations++;
  return materialize.apply(this, args);
};
for (const turns of [20, 200, 1000]) {
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
    const host = { sessionManager: manager, _limitsModel: () => model } as unknown as AgentSession;
    for (const mode of ["uncached-sdk", "cached-sdk"] as const) {
      const read = mode === "uncached-sdk" ? nativeContextUsage : AgentSession.prototype.getContextUsage;
      const ctx = {
        mode: "tui",
        sessionManager: manager,
        model,
        modelRegistry: { isUsingOAuth: () => false },
        getContextUsage: () => read.call(host),
        ui: { theme },
      } as unknown as ExtensionContext;
      for (const [name, render] of [
        ["compact", renderCompactFooter],
        ["detailed", renderDetailedFooter],
      ] as const) {
        render(ctx, data, theme, 100);
        materializations = 0;
        const samples: number[] = [];
        for (let sample = 0; sample < 5; sample++) {
          const start = performance.now();
          render(ctx, data, theme, 100);
          samples.push(performance.now() - start);
        }
        console.log(
          JSON.stringify({
            mode,
            footer: name,
            turns,
            entries: turns * 2,
            fileBytes: statSync(manager.getSessionFile()!).size,
            medianMs: +samples.sort((a, b) => a - b)[2]!.toFixed(3),
            historicalMaterializationsPerFrame: materializations / samples.length,
          }),
        );
      }
    }
  } finally {
    disposeDiskBackedSessionManager(manager);
    rmSync(home, { recursive: true, force: true });
  }
}
