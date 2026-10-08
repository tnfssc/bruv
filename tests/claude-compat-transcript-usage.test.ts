import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { NativeHistory, readNativeHistory } from "../src/claude-compat/history";
import { nativeAssistantCost, nativeAssistantUsage } from "../src/claude-compat/message-usage";
import { writeNativeChildFrame } from "../src/claude-compat/task-child-journal";
import { nativeTaskId, projectChildFrame, type TaskLink } from "../src/claude-compat/task-projection";
import { parseClaudeLine, mightCarryUsage, priceUsage } from "./claude-compat/fixtures/t3-usage";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const stamp = "2026-10-08T08:00:00.000Z";
function assistant(model: string, total: number): AssistantMessage {
  return {
    role: "assistant",
    provider: "openai-codex",
    model,
    api: "openai-codex-responses",
    content: [{ type: "text", text: "offline child" }],
    timestamp: Date.parse(stamp),
    stopReason: "stop",
    usage: {
      input: 13,
      output: 17,
      cacheRead: 5,
      cacheWrite: 7,
      totalTokens: 42,
      cost: { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total },
    },
  };
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "bruv-transcript-usage-"));
  dirs.push(dir);
  const history = await NativeHistory.open({
    cwd: dir,
    configDir: join(dir, "native"),
    sessionId: randomUUID(),
    sourceSessionId: "actual-root-source",
  });
  const link: Extract<TaskLink, { kind: "worker" }> = {
    root: {
      namespace: "bruv:offline-usage",
      sourceSessionId: history.options.sourceSessionId,
      sessionId: history.options.sessionId,
    },
    sourceId: "actual-local-owner",
    jobId: "actual-child-job",
    launchToolUseId: "actual-launch-call",
    parent: { sourceSessionId: history.options.sourceSessionId, launchToolUseId: null },
    origin: "bruv",
    kind: "worker",
    child: { sourceSessionId: "actual-child-source", parentSessionId: history.options.sourceSessionId },
    prompt: "Offline pricing fixture",
  };
  return { history, link };
}

test("child durable callback writes actual costs, exact models and usage; replay stays single-write", async () => {
  const { history, link } = await fixture();
  const models = ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"];
  const costs = [0.017, 0.029, 0];
  for (const [index, model] of models.entries()) {
    const message = assistant(model, costs[index]!);
    const entry = { type: "message" as const, id: "actual-entry-" + index, parentId: null, timestamp: stamp, message };
    const frame = projectChildFrame(link, {
      sourceSessionId: link.child.sourceSessionId,
      eventId: entry.id,
      body: {
        type: "assistant",
        message: {
          role: "assistant",
          id: entry.id,
          model: message.provider + "/" + model,
          content: message.content,
          usage: nativeAssistantUsage(message),
        },
      },
    })!;
    expect(await writeNativeChildFrame(history, { link, entry }, frame)).toBe(true);
    const restored = await NativeHistory.open(history.options);
    expect(await writeNativeChildFrame(restored, { link, entry }, frame)).toBe(false);
    const changed = { ...entry, message: assistant(model, costs[index]! + 1) };
    await expect(writeNativeChildFrame(restored, { link, entry: changed }, frame)).rejects.toThrow(
      "Conflicting replay",
    );
  }
  const child = await history.child({
    taskId: nativeTaskId(link),
    sourceSessionId: link.child.sourceSessionId,
    sourceCallId: link.launchToolUseId,
  });
  const lines = (await readFile(child.filePath, "utf8")).trim().split("\n");
  expect(lines).toHaveLength(3);
  for (const [index, line] of lines.entries()) {
    const written = JSON.parse(line);
    expect(written.isSidechain).toBe(true);
    expect(written.costUSD).toBe(costs[index]);
    expect(written.parentUuid).toBe(index ? JSON.parse(lines[index - 1]!).uuid : null);
    expect(mightCarryUsage(line, "claude")).toBe(true);
    const parsed = parseClaudeLine(line);
    expect(parsed.model).toBe("openai-codex/" + models[index]);
    expect(parsed.totals).toEqual({
      uncachedInputTokens: 13,
      outputTokens: 17,
      cachedInputTokens: 5,
      cacheCreationTokens: 7,
      reasoningTokens: 0,
    });
    expect(priceUsage(new Map(), parsed)).toMatchObject({
      costUsd: costs[index],
      costSource: "providerReported",
      categoryCostUsd: null,
    });
  }
  await expect(readFile(history.filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

test("unknown or invalid Pi totals stay omitted and unpriced; known zero remains zero", async () => {
  const { history } = await fixture();
  for (const [index, total] of [undefined, null, NaN, Infinity, -1, 0].entries()) {
    const message = assistant("gpt-6-astra", 0);
    (message.usage.cost as { total: unknown }).total = total;
    const cost = nativeAssistantCost(message);
    expect(cost).toEqual(total === 0 ? { costUSD: 0 } : {});
    await history.append({
      sourceMessageId: "unknown-" + index,
      type: "assistant",
      timestamp: stamp,
      message: {
        role: "assistant",
        model: message.provider + "/" + message.model,
        content: message.content,
        usage: nativeAssistantUsage(message),
      },
      ...cost,
    });
  }
  const entries = await readNativeHistory(history.options);
  for (const [index, entry] of entries.entries()) {
    const parsed = parseClaudeLine(JSON.stringify(entry));
    expect(priceUsage(new Map(), parsed).costSource).toBe(index === 5 ? "providerReported" : "unpriced");
    if (index !== 5) expect(Object.hasOwn(entry, "costUSD")).toBe(false);
  }
});

test("legacy replay stays immutable rather than backfilling cost", async () => {
  const { history } = await fixture();
  const input = {
    sourceMessageId: "legacy-entry",
    type: "assistant" as const,
    timestamp: stamp,
    message: {
      role: "assistant",
      model: "openai-codex/gpt-6-luna",
      usage: nativeAssistantUsage(assistant("gpt-6-luna", 0.01)),
    },
  };
  await history.append(input);
  const before = await readFile(history.filePath, "utf8");
  const restored = await NativeHistory.open(history.options);
  expect((await restored.appendWithResult({ ...input, costUSD: 0.01 })).appended).toBe(false);
  expect(await readFile(history.filePath, "utf8")).toBe(before);
});
