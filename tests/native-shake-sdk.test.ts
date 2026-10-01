import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { type AssistantMessage, createAssistantMessageEventStream, getModel } from "@earendil-works/pi-ai/compat";
import {
  convertToLlm,
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import tasks from "../src/agent/extension";
import { normalizeContext } from "@earendil-works/pi-ai";
import { convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { adaptNativeCompactionMessages, NATIVE_CODEX_SUMMARY } from "../src/agent/native-compaction";
import {
  buildShakePlan,
  latestShakeRecord,
  projectShakenContext,
  registerManualShake,
} from "../src/agent/manual-shake";
import { bindInstructionContinuitySession, clearInstructionContinuity } from "../src/agent/instruction-continuity";

const usage = (input: number) => ({
  input,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: input + 5,
  cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
});

function assistant(model: any, content: any[], input = 20): AssistantMessage {
  return {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content,
    stopReason: content.some((part) => part.type === "toolCall") ? "toolUse" : "stop",
    usage: usage(input),
    timestamp: Date.now(),
  } as AssistantMessage;
}

function appendTrace(manager: SessionManager, model: any, id: string, result: string, input = 20): any[] {
  const call = assistant(
    model,
    [
      { type: "thinking", thinking: "private-" + id },
      { type: "toolCall", id, name: "execute", arguments: { code: "secret-" + id } },
    ],
    input,
  );
  const toolResult = {
    role: "toolResult",
    toolCallId: id,
    toolName: "execute",
    content: [{ type: "text", text: result }],
    isError: false,
    timestamp: Date.now(),
  } as any;
  manager.appendMessage(call);
  manager.appendMessage(toolResult);
  return [call, toolResult];
}

function response(model: any, text: string, input = 20): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream();
  const message = assistant(model, [{ type: "text", text }], input);
  stream.push({ type: "start", partial: message });
  stream.push({ type: "done", reason: "stop", message });
  stream.end(message);
  return stream;
}

async function fixture(model: any, manager: SessionManager, dir: string) {
  const runtime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  runtime.hasConfiguredAuth = () => true;
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    extensionFactories: [{ name: "die-tasks", factory: tasks }],
  });
  await loader.reload();
  const created = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    resourceLoader: loader,
    model,
    modelRuntime: runtime,
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false, reserveTokens: 5000, keepRecentTokens: 200 },
      retry: { enabled: false },
    }),
    tools: ["execute"],
  });
  await created.session.bindExtensions({ mode: "print" });
  return created.session;
}

function shakeEntries(manager: SessionManager): any[] {
  return manager
    .getEntries()
    .filter((entry: any) => entry.type === "custom" && entry.customType === "die-manual-shake");
}

const model = getModel("openai-codex", "gpt-5.6-luna")!;
const details = {
  strategy: "codex-native",
  version: 1,
  api: model.api,
  provider: model.provider,
  model: "original-checkpoint-model",
  thinkingLevel: "high",
  item: { type: "compaction", id: "cmp_shake", encrypted_content: "  OPAQUE+/=\nkeep bytes  " },
  runtimeState: "Background job still running: preserve its owner and ID.",
};
function nativeBranch(manager: SessionManager) {
  manager.appendMessage({ role: "user", content: "EXCLUDED_PREFIX", timestamp: 1 });
  appendTrace(manager, model, "reuse", "EXCLUDED_PREFIX_RESULT");
  // Even an unresolved ID in discarded history must not poison the active boundary.
  manager.appendMessage(
    assistant(model, [{ type: "toolCall", id: "hidden-unresolved", name: "execute", arguments: {} }]),
  );
  const kept = manager.appendMessage({ role: "user", content: "KEPT_USER", timestamp: 2 });
  appendTrace(manager, model, "kept", "DROP_KEPT_RESULT");
  manager.appendCompaction(NATIVE_CODEX_SUMMARY, kept, 100, structuredClone(details), true);
  manager.appendMessage({ role: "user", content: "POST_USER", timestamp: 3 });
  const call = manager.appendMessage(
    assistant(model, [
      { type: "thinking", thinking: "DROP_POST_REASONING" },
      { type: "text", text: "POST_ASSISTANT_PROSE" },
      { type: "toolCall", id: "reuse", name: "execute", arguments: { code: "DROP_POST_CALL" } },
    ]),
  );
  const result = manager.appendMessage({
    role: "toolResult",
    toolCallId: "reuse",
    toolName: "execute",
    content: [{ type: "text", text: "DROP_POST_RESULT" }],
    isError: false,
    timestamp: 4,
  });
  manager.appendMessage(assistant(model, [{ type: "text", text: "FINAL_PROSE" }]));
  return { call, result };
}
function wire(messages: any[]) {
  return convertResponsesMessages(
    model,
    normalizeContext({ messages: convertToLlm(messages) }),
    new Set([model.provider]),
    { includeSystemPrompt: false },
  );
}
function assertPayload(input: any[]) {
  expect(input.filter((x: any) => x.type === "compaction")).toEqual([details.item]);
  expect(JSON.stringify(input.find((x: any) => x.type === "compaction"))).toBe(JSON.stringify(details.item));
  const text = JSON.stringify(input);
  for (const retained of ["KEPT_USER", "POST_USER", "POST_ASSISTANT_PROSE", "FINAL_PROSE", details.runtimeState])
    expect(text).toContain(retained);
  for (const removed of [
    "EXCLUDED_PREFIX",
    "private-kept",
    "DROP_KEPT_RESULT",
    "DROP_POST_REASONING",
    "DROP_POST_CALL",
    "DROP_POST_RESULT",
    "function_call",
    "function_call_output",
  ])
    expect(text).not.toContain(removed);
}

test("real SDK /shake preserves native checkpoint exactly once, kept tail, post-checkpoint prose and disk reopen", async () => {
  const dir = await mkdtemp("/var/tmp/die-native-shake-sdk-");
  let session: any;
  try {
    const manager = SessionManager.create(dir, dir);
    nativeBranch(manager);
    const checkpoint = manager.getEntries().find((e: any) => e.type === "compaction")!;
    const checkpointBytes = JSON.stringify(checkpoint);
    const checkpointLine = (await readFile(manager.getSessionFile()!, "utf8"))
      .split("\n")
      .find((line) => line.includes(checkpoint.id))!;
    session = await fixture(model, manager, dir);
    const before = await session.agent.transformContext(
      structuredClone(manager.buildSessionContext().messages),
      new AbortController().signal,
    );
    const shimBytes = JSON.stringify(before[0]);
    expect(before[0].role).toBe("assistant");
    expect(before[0].content[0].thinkingSignature).toBe(JSON.stringify(details.item));
    let streamCalls = 0;
    const payloads: any[][] = [];
    session.agent.streamFunction = (_m: any, context: any) => {
      streamCalls++;
      payloads.push(wire(context.messages));
      return response(model, "OFFLINE_STUB");
    };
    await session.prompt("/shake");
    expect(streamCalls).toBe(0);
    expect(shakeEntries(manager)).toHaveLength(1);
    const after = await session.agent.transformContext(
      structuredClone(manager.buildSessionContext().messages),
      new AbortController().signal,
    );
    expect(JSON.stringify(after[0])).toBe(shimBytes);
    expect(after[1]).toEqual(before[1]); // runtimeState user message unchanged
    assertPayload(wire(after));
    const payload = { model: model.id, stream: true, store: false, input: wire(after) };
    const prepared = await session._extensionRunner.emitBeforeProviderRequest(payload);
    assertPayload(prepared.input);
    expect(wire(after)[1]).toEqual(wire(before)[1]);
    expect(JSON.stringify(checkpoint)).toBe(checkpointBytes);
    await session.prompt("/shake");
    expect(shakeEntries(manager)).toHaveLength(1);
    expect(streamCalls).toBe(0);
    const file = manager.getSessionFile()!;
    const disk = await readFile(file, "utf8");
    expect(disk.split("\n").find((line) => line.includes(checkpoint.id))).toBe(checkpointLine);
    const reopened = SessionManager.open(file);
    const projected = projectShakenContext(
      reopened.buildSessionContext().messages,
      reopened.buildContextEntries(),
      latestShakeRecord(reopened.buildContextEntries(), reopened.getSessionId())!,
    );
    assertPayload(wire(adaptNativeCompactionMessages(projected, { sessionManager: reopened, model } as any)));
    expect(JSON.stringify(reopened.getEntries().find((e: any) => e.type === "compaction"))).toBe(checkpointBytes);
    expect(await readFile(file, "utf8")).toBe(disk);
    // An ordinary request continuation reaches the actual SDK transform plus
    // response converter, but a local stub replaces network transport.
    await session.prompt("FOLLOW_UP");
    expect(streamCalls).toBe(1);
    assertPayload(payloads[0]!);
  } finally {
    session?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 10_000);

function harness(manager: SessionManager, transform?: (messages: any[]) => any) {
  const handlers = new Map<string, Function>();
  let command: any;
  const notices: string[] = [];
  const ctx: any = {
    sessionManager: manager,
    model,
    isIdle: () => true,
    hasPendingMessages: () => false,
    ui: { notify: (message: string) => notices.push(message) },
  };
  registerManualShake({
    on: (name: string, fn: Function) => handlers.set(name, fn),
    registerCommand: (_n: string, c: any) => (command = c),
    appendEntry: (type: string, data: any) => manager.appendCustomEntry(type, data),
  } as any);
  if (transform)
    bindInstructionContinuitySession({ sessionManager: manager, agent: { transformContext: transform } } as any);
  return { handlers, command, ctx, notices };
}

test("native shim is never selected or counted as ordinary thinking, including transformed synthetic checkpoints", async () => {
  const manager = SessionManager.inMemory();
  nativeBranch(manager);
  const ctx: any = { sessionManager: manager, model };
  const synthetic = adaptNativeCompactionMessages(manager.buildSessionContext().messages, ctx)[0]!;
  // Adversarial hook provenance: even a byte-identical shim stored as a message
  // must not give projection permission to remove the synthetic checkpoint.
  const fake = manager.appendMessage(synthetic as AssistantMessage);
  const plan = buildShakePlan(manager.buildContextEntries(), manager.getSessionId());
  expect(plan.record.assistantEntryIds).not.toContain(fake);
  expect(plan.removedAssistantBlocks).toBe(4); // two genuine thinking/call pairs
  const transformed = adaptNativeCompactionMessages(manager.buildSessionContext().messages, ctx);
  const projected = projectShakenContext(transformed, manager.buildContextEntries(), {
    ...plan.record,
    assistantEntryIds: [...plan.record.assistantEntryIds, fake],
  });
  expect(
    projected.filter(
      (m: any) =>
        m.role === "assistant" && m.content.some((p: any) => p.thinkingSignature === JSON.stringify(details.item)),
    ),
  ).toHaveLength(2);
  expect(JSON.stringify(projected[0])).toBe(JSON.stringify(synthetic));
});

test("valid checkpoint without new trace is an honest no-op; automatic shake remains deferred", async () => {
  const manager = SessionManager.inMemory();
  const kept = manager.appendMessage({ role: "user", content: "KEEP", timestamp: 1 });
  manager.appendCompaction(NATIVE_CODEX_SUMMARY, kept, 1, structuredClone(details), true);
  const h = harness(manager);
  await h.command.handler("", h.ctx);
  expect(shakeEntries(manager)).toHaveLength(0);
  expect(h.notices.at(-1)).toContain("Native checkpoint remains unchanged");
  appendTrace(manager, model, "big", "x".repeat(50000));
  expect(
    await h.handlers.get("session_before_compact")!({ signal: new AbortController().signal }, h.ctx),
  ).toBeUndefined();
  expect(shakeEntries(manager)).toHaveLength(0);
});

test("opaque invalid schema, incompatible provider/API, unresolved retained batch and stale hooks fail safe", async () => {
  for (const mode of [
    "schema",
    "provider",
    "api",
    "unresolved",
    "stale",
    "lost-shim",
    "changed-runtime",
    "duplicate-shim",
  ]) {
    const manager = SessionManager.inMemory();
    nativeBranch(manager);
    const checkpoint: any = manager.getEntries().find((e: any) => e.type === "compaction");
    const h = harness(
      manager,
      mode === "stale"
        ? async (messages) => {
            manager.appendMessage({ role: "user", content: "changed", timestamp: 50 });
            return messages;
          }
        : ["lost-shim", "changed-runtime", "duplicate-shim"].includes(mode)
          ? (messages) => {
              const transformed = adaptNativeCompactionMessages(messages, { sessionManager: manager, model } as any);
              if (mode === "lost-shim") return transformed.slice(1);
              if (mode === "changed-runtime")
                return transformed.map((m: any, i: number) => (i === 1 ? { ...m, content: "lost" } : m));
              return [transformed[0], ...transformed];
            }
          : undefined,
    );
    if (mode === "schema") checkpoint.details.version = 999;
    if (mode === "provider") h.ctx.model = { ...model, provider: "foreign" };
    if (mode === "api") h.ctx.model = { ...model, api: "openai-responses" };
    if (mode === "unresolved")
      manager.appendMessage(assistant(model, [{ type: "toolCall", id: "pending", name: "execute", arguments: {} }]));
    await h.command.handler("", h.ctx);
    expect(shakeEntries(manager), mode).toHaveLength(0);
    expect(h.notices.at(-1), mode).toContain("refused");
    clearInstructionContinuity(manager);
  }
});

test("hook-excluded active IDs never accumulate in a durable shake, hidden duplicate IDs never poison the boundary", async () => {
  const manager = SessionManager.inMemory();
  const ids = nativeBranch(manager);
  const entries = manager.buildContextEntries();
  const hidden: any = entries.find(
    (e: any) =>
      e.type === "message" && e.message.role === "assistant" && e.message.content.some((p: any) => p.id === "kept"),
  );
  const hiddenResult: any = entries.find(
    (e: any) => e.type === "message" && e.message.role === "toolResult" && e.message.toolCallId === "kept",
  );
  const h = harness(manager, (messages) =>
    messages.filter(
      (m: any) =>
        JSON.stringify(m) !== JSON.stringify(hidden.message) &&
        JSON.stringify(m) !== JSON.stringify(hiddenResult.message),
    ),
  );
  await h.command.handler("", h.ctx);
  const record = latestShakeRecord(manager.buildContextEntries(), manager.getSessionId())!;
  expect(record.assistantEntryIds).toEqual([ids.call]);
  expect(record.toolResultEntryIds).toEqual([ids.result]);
  clearInstructionContinuity(manager);
});

test("SDK active-boundary semantics omit older retained checkpoints without losing their journal bytes", async () => {
  const dir = await mkdtemp("/var/tmp/die-native-shake-nested-");
  let session: any;
  try {
    const manager = SessionManager.create(dir, dir);
    const kept = manager.appendMessage({ role: "user", content: "KEPT_USER", timestamp: 1 });
    manager.appendCompaction(
      "archived summary",
      kept,
      1,
      { ...structuredClone(details), version: 999, item: { ...details.item, id: "cmp_archived" } },
      true,
    );
    const archived = JSON.stringify(manager.getEntries().at(-1));
    appendTrace(manager, model, "kept", "DROP_KEPT_RESULT");
    manager.appendCompaction(NATIVE_CODEX_SUMMARY, kept, 1, structuredClone(details), true);
    manager.appendMessage({ role: "user", content: "POST_USER", timestamp: 2 });
    manager.appendMessage(assistant(model, [{ type: "text", text: "POST_ASSISTANT_PROSE FINAL_PROSE" }]));
    expect(manager.buildContextEntries().filter((e) => e.type === "compaction")).toHaveLength(2);
    expect(
      manager
        .buildSessionProjection()
        .entries.filter((e) => e.sourceEntry.type === "compaction")
        .map((e) => e.messages.length),
    ).toEqual([1, 0]);
    session = await fixture(model, manager, dir);
    await session.prompt("/shake");
    expect(shakeEntries(manager)).toHaveLength(1);
    const after = await session.agent.transformContext(
      structuredClone(manager.buildSessionContext().messages),
      new AbortController().signal,
    );
    const payload = { model: model.id, stream: true, store: false, input: wire(after) };
    assertPayload((await session._extensionRunner.emitBeforeProviderRequest(payload)).input);
    expect(
      JSON.stringify(manager.getEntries().find((e: any) => e.type === "compaction" && e.details.version === 999)),
    ).toBe(archived);
  } finally {
    session?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 10_000);

test("shake previews honor SDK context edits rather than restoring raw kept-history messages", async () => {
  const manager = SessionManager.inMemory();
  const ids = nativeBranch(manager);
  manager.appendContextEdit(ids.call, { content: [{ type: "text", text: "EDITED_PROSE" }] });
  manager.appendContextEdit(ids.result, null);
  const h = harness(manager);
  await h.command.handler("", h.ctx);
  const record = latestShakeRecord(manager.buildContextEntries(), manager.getSessionId())!;
  expect(record.assistantEntryIds).not.toContain(ids.call);
  expect(record.toolResultEntryIds).not.toContain(ids.result);
  const projected = h.handlers.get("context")!({ messages: manager.buildSessionContext().messages }, h.ctx).messages;
  expect(JSON.stringify(projected)).toContain("EDITED_PROSE");
  expect(JSON.stringify(projected)).not.toContain("DROP_POST_CALL");
  expect(JSON.stringify(projected)).not.toContain("DROP_POST_RESULT");
});
