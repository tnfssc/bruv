/**
 * Run with bun scripts/history-sdk-probe.ts. Isolated SDK compaction/reset/resume soak.
 * The extension supplies the summary: no provider, user sessions or installed binary.
 * Heap growth checks retained JSC history residency, not peak allocations or bounded RSS.
 */

import { heapStats } from "bun:jsc";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { disposeDiskBackedSessionManager, installDiskBackedSessionManager } from "../src/history/session-manager";

const model = getModel("anthropic", "claude-sonnet-4-5")!;
const usage = {
  input: 10,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 11,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

async function sample(label: string, manager: SessionManager, compactions: number): Promise<number> {
  await Bun.sleep(20);
  Bun.gc(true);
  await Bun.sleep(20);
  Bun.gc(true);
  const memory = process.memoryUsage();
  const file = manager.getSessionFile();
  const value = {
    label,
    heapMiB: +(heapStats().heapSize / 1048576).toFixed(2),
    rssMiB: +(memory.rss / 1048576).toFixed(2),
    fileMiB: +(file ? (await stat(file).catch(() => ({ size: 0 }))).size / 1048576 : 0).toFixed(2),
    contextMessages: manager.buildSessionContext().messages.length,
    compactions,
  };
  console.log(JSON.stringify(value));
  return value.heapMiB;
}

async function runCompactionSoak(dir: string, manager: SessionManager) {
  // Only the live SDK phase owns these hook inputs and observations.
  let tail = "";
  let compactions = 0;
  const runtime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  runtime.hasConfiguredAuth = () => true;
  runtime.getAuth = (async () => ({ auth: { apiKey: "offline-history-soak" } })) as typeof runtime.getAuth;
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    extensionFactories: [
      {
        name: "offline-history-summary",
        factory: (pi) => {
          pi.on("session_before_compact", () => ({
            compaction: { summary: "Bounded offline summary", firstKeptEntryId: tail, tokensBefore: 2_000_000 },
          }));
          pi.on("session_compact", () => {
            compactions++;
          });
        },
      },
    ],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    resourceLoader: loader,
    model,
    modelRuntime: runtime,
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false, keepRecentTokens: 128, reserveTokens: 8192 },
    }),
    thinkingLevel: "off",
  });

  try {
    const baselineHeapMiB = await sample("baseline", manager, compactions);
    let firstOriginalId = "";
    let originals = 0;
    for (let batch = 1; batch <= 16; batch++) {
      for (let i = 0; i < 32; i++) {
        const id = manager.appendMessage({
          role: "user",
          content: randomBytes(192 * 1024).toString("base64"),
          timestamp: Date.now(),
        });
        firstOriginalId ||= id;
        originals++;
      }
      manager.appendMessage({
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [{ type: "text", text: "Stored original batch" }],
        stopReason: "stop",
        usage,
        timestamp: Date.now(),
      });
      tail = manager.appendMessage({ role: "user", content: "retained tail " + batch, timestamp: Date.now() });
      await session.compact();
      if (manager.buildSessionContext().messages.length !== 2) throw new Error("Compacted context changed");
      if (batch % 4 === 0) await sample("after real compaction " + batch, manager, compactions);
    }
    if (compactions !== 16) throw new Error("SDK did not complete every compaction");
    return { firstOriginalId, originals, compactions, baselineHeapMiB };
  } finally {
    session.dispose();
  }
}

async function runProbe(dir: string) {
  const manager = SessionManager.create(dir, dir);
  try {
    const { firstOriginalId, originals, compactions, baselineHeapMiB } = await runCompactionSoak(dir, manager);
    // The SDK session is disposed; only the manager participates in reset and replay.
    const path = manager.getSessionFile()!;
    manager.newSession();
    await sample("reset", manager, compactions);
    manager.setSessionFile(path);
    await sample("resume", manager, compactions);
    const entry = manager.getEntry(firstOriginalId);
    if (
      entry?.type !== "message" ||
      entry.message.role !== "user" ||
      typeof entry.message.content !== "string" ||
      entry.message.content.length !== 256 * 1024
    )
      throw new Error("Original history lost on resume");
    const resumedId = manager.appendMessage({ role: "user", content: "post-resume append", timestamp: Date.now() });
    manager.appendContextEdit(resumedId, { content: "post-resume edited" });
    manager.setSessionFile(path);
    const projection = manager.buildSessionProjection();
    if (projection.messages.length !== 3) throw new Error("Resume append lost");
    if (!projection.entries.some(({ sourceEntry }) => sourceEntry.type === "context_edit"))
      throw new Error("Context edit provenance lost on resume");
    if (!projection.messages.some((message) => message.role === "user" && message.content === "post-resume edited"))
      throw new Error("Context edit projection lost on resume");
    if (manager.buildSessionContext().messages.length !== projection.messages.length)
      throw new Error("Session context diverged from projection");

    const finalHeapMiB = await sample("resume append", manager, compactions);
    const heapGrowthMiB = finalHeapMiB - baselineHeapMiB;
    if (heapGrowthMiB > 32) throw new Error("Historical heap grew by more than 32 MiB for 128 MiB of original text");
    console.log(JSON.stringify({ ok: true, originals, compactions, heapGrowthMiB: +heapGrowthMiB.toFixed(2) }));
  } finally {
    disposeDiskBackedSessionManager(manager);
  }
}

installDiskBackedSessionManager();
const dir = await mkdtemp(join(tmpdir(), "bruv-history-sdk-soak-"));
try {
  await runProbe(dir);
} finally {
  await rm(dir, { recursive: true, force: true });
}
