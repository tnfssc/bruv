import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeContext, type Model } from "@earendil-works/pi-ai";
import { convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import { prepareCompaction } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js";
import {
  buildShakePlan,
  latestShakeRecord,
  projectShakenContext,
  projectShakenRequiredMessages,
} from "../../src/agent/manual-shake";
import {
  coversDiscardedMessages,
  registerNativeCodexCompaction,
  NATIVE_CODEX_SUMMARY,
  adaptNativeCompactionMessages,
} from "../../src/agent/native-compaction";
import { MANUAL_SHAKE_ENTRY } from "../../src/history/shake-record";

const model: Model<any> = {
  id: "gpt-test",
  name: "test",
  api: "openai-codex-responses",
  provider: "openai-codex",
  baseUrl: "https://chatgpt.com/backend-api",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 10000,
};
const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const item = { type: "compaction" as const, id: "cmp_original", encrypted_content: "opaque-original" };
let timestamp = 1;
function assistant(content: any[]) {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason: "toolUse",
    timestamp: timestamp++,
  } as any;
}
function trace(manager: SessionManager, id: string, text = "") {
  manager.appendMessage(
    assistant([
      { type: "thinking", thinking: "hidden trace", thinkingSignature: "ordinary-signed-reasoning" },
      ...(text ? [{ type: "text", text }] : []),
      { type: "toolCall", id, name: "execute", arguments: { code: "1" } },
    ]),
  );
  manager.appendMessage({
    role: "toolResult",
    toolCallId: id,
    toolName: "execute",
    content: [{ type: "text", text: "result" }],
    isError: false,
    timestamp: timestamp++,
  } as any);
}
function fixture(manager = SessionManager.inMemory()) {
  const first = manager.appendMessage({ role: "user", content: "preserve this user", timestamp: timestamp++ });
  manager.appendCompaction(
    NATIVE_CODEX_SUMMARY,
    first,
    10,
    {
      strategy: "codex-native",
      version: 1,
      api: model.api,
      provider: model.provider,
      model: model.id,
      thinkingLevel: null,
      item,
    },
    true,
  );
  // Recorded trigger: a durable shake removes tool-only assistants/results;
  // raw SDK preparation still requires those messages (not a long continuation).
  for (let i = 0; i < 105; i++) trace(manager, "call-" + i);
  trace(manager, "mixed", "substantive assistant text");
  manager.appendCustomEntry(
    MANUAL_SHAKE_ENTRY,
    buildShakePlan(manager.buildContextEntries(), manager.getSessionId()).record,
  );
  manager.appendMessage({ role: "user", content: "kept question", timestamp: timestamp++ });
  manager.appendMessage(assistant([{ type: "text", text: "kept answer".repeat(100) }]));
  return manager;
}
function capture(manager: SessionManager) {
  const entries = manager.buildContextEntries();
  return {
    sessionId: manager.getSessionId(),
    leafId: manager.getLeafId(),
    model,
    thinkingLevel: null,
    messages: projectShakenContext(
      manager.buildSessionContext().messages,
      entries,
      latestShakeRecord(manager.getBranch(), manager.getSessionId())!,
    ),
  };
}
function event(manager: SessionManager) {
  const preparation = prepareCompaction(manager.getBranch(), {
    enabled: true,
    reserveTokens: 100,
    keepRecentTokens: 100,
  })!;
  expect(preparation).toBeDefined();
  return { preparation, branchEntries: manager.getBranch() } as any;
}

test("SDK raw preparation requires the recorded shake-discarded tool group; projected capture covers it without moving the cut", () => {
  const manager = fixture();
  const c = capture(manager),
    e = event(manager);
  const before = structuredClone(e);
  expect(e.preparation.isSplitTurn).toBe(true);
  expect(e.preparation.turnPrefixMessages.length).toBeGreaterThan(0);
  const required = [...e.preparation.messagesToSummarize, ...e.preparation.turnPrefixMessages];
  expect(required.some((m: any) => m.role === "toolResult")).toBe(true);
  expect(c.messages.some((m: any) => m.role === "toolResult")).toBe(false);
  expect(manager.buildSessionContext().messages.length - c.messages.length).toBe(211); // mixed assistant remains, its result does not
  expect(coversDiscardedMessages(c, e)).toBe(true);
  expect(e).toEqual(before);
  expect(c.messages.some((m: any) => m.content?.some?.((p: any) => p.text === "substantive assistant text"))).toBe(
    true,
  );
});

test("disk reopen retains genuine shake marker and original opaque transport", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-shake-coverage-"));
  try {
    const manager = fixture(SessionManager.create(dir, dir));
    // SDK saves the journal when an assistant exists; reopen the actual file.
    const file = manager.getSessionFile()!;
    for (const current of [manager, SessionManager.open(file, dir)]) {
      const c = capture(current),
        e = event(current);
      expect(coversDiscardedMessages(c, e)).toBe(true);
      const adapted = adaptNativeCompactionMessages(c.messages, { model, sessionManager: current } as any);
      const signatures = adapted.flatMap((m: any) =>
        m.role === "assistant"
          ? m.content.filter((p: any) => p.type === "thinking").map((p: any) => p.thinkingSignature)
          : [],
      );
      expect(signatures.filter((s: string) => s === JSON.stringify(item))).toHaveLength(1);
      const wire = convertResponsesMessages(
        model,
        normalizeContext({ messages: convertToLlm(adapted) }),
        new Set([model.provider]),
        { includeSystemPrompt: false },
      );
      expect(wire.filter((row: any) => row.type === "compaction")).toEqual([item]);
      expect(JSON.stringify(wire)).not.toContain("ordinary-signed-reasoning");
      expect(JSON.stringify(wire)).toContain("substantive assistant text");
      expect(current.buildContextEntries()[0]).toMatchObject({ details: { item } });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing or rewritten substantive content and reordering remain coverage failures", () => {
  const manager = fixture(),
    c = capture(manager),
    e = event(manager);
  const user = c.messages.findIndex((m: any) => m.role === "user" && m.content === "preserve this user");
  expect(coversDiscardedMessages({ ...c, messages: c.messages.filter((_, i) => i !== user) }, e)).toBe(false);
  const changed = structuredClone(c.messages);
  (changed[user] as any).content = "rewritten user";
  expect(coversDiscardedMessages({ ...c, messages: changed }, e)).toBe(false);
  expect(coversDiscardedMessages({ ...c, messages: [...c.messages].reverse() }, e)).toBe(false);
});

for (const mixed of [false, true]) {
  test("split-turn required call with kept result uses full pairing evidence (mixed=" + mixed + ")", () => {
    const manager = SessionManager.inMemory();
    manager.appendMessage({ role: "user", content: "turn start", timestamp: timestamp++ });
    trace(manager, "split", mixed ? "keep exact assistant text" : "");
    const entries = manager.buildContextEntries();
    const record = buildShakePlan(entries, manager.getSessionId()).record;
    const raw = manager.buildSessionContext().messages;
    const required = raw.slice(0, 2); // user and call; the result lies on the kept side
    expect(projectShakenContext(required, entries, record)).toEqual(required); // slice alone cannot prove pairing
    const projected = projectShakenRequiredMessages(required, entries, record);
    expect(projected).toEqual(
      mixed
        ? [raw[0], { ...(raw[1] as any), content: [{ type: "text", text: "keep exact assistant text" }] }]
        : [raw[0]],
    );
    expect(required).toEqual(raw.slice(0, 2));
    manager.appendCustomEntry(MANUAL_SHAKE_ENTRY, record);
    const e = {
      branchEntries: manager.getBranch(),
      preparation: {
        messagesToSummarize: [],
        turnPrefixMessages: required,
        firstKeptEntryId: entries[2]!.id,
        isSplitTurn: true,
      },
    } as any;
    expect(coversDiscardedMessages(capture(manager), e)).toBe(true);
    const incomplete = entries.filter((_, i) => i !== 2);
    expect(projectShakenRequiredMessages(required, incomplete, record)).toEqual(required);
    const partialMarker = { ...record, toolResultEntryIds: [] };
    expect(projectShakenRequiredMessages(required, entries, partialMarker)).toEqual(required);
  });
}

test("malformed latest marker and a changed marker cannot hide missing substantive content", () => {
  const manager = fixture(),
    c = capture(manager);
  manager.appendCustomEntry(MANUAL_SHAKE_ENTRY, {
    ...latestShakeRecord(manager.getBranch(), manager.getSessionId()),
    version: 999,
  });
  expect(coversDiscardedMessages({ ...c, leafId: manager.getLeafId() }, event(manager))).toBe(false);
  const other = fixture(),
    old = capture(other);
  other.appendCustomEntry(MANUAL_SHAKE_ENTRY, {
    ...latestShakeRecord(other.getBranch(), other.getSessionId()),
    assistantEntryIds: [],
    toolResultEntryIds: [],
  });
  expect(coversDiscardedMessages({ ...old, leafId: other.getLeafId() }, event(other))).toBe(false);
});

test("ordinary signed reasoning outside the durable marker must still be covered exactly", () => {
  const manager = fixture();
  manager.appendMessage(
    assistant([
      { type: "thinking", thinking: "ordinary thought", thinkingSignature: "signature-kept" },
      { type: "text", text: "ordinary answer" },
    ]),
  );
  manager.appendMessage({ role: "user", content: "new kept turn".repeat(1000), timestamp: timestamp++ });
  const c = capture(manager),
    e = event(manager);
  expect(coversDiscardedMessages(c, e)).toBe(true);
  const messages = structuredClone(c.messages);
  const signed = messages.find(
    (m: any) => m.role === "assistant" && m.content.some((p: any) => p.thinkingSignature === "signature-kept"),
  ) as any;
  signed.content[0].thinkingSignature = "changed-signature";
  expect(coversDiscardedMessages({ ...c, messages }, e)).toBe(false);
});

test("native dispatch uses the ordinary serialized shaken prefix and unchanged SDK cut, fresh and reopened", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-native-shake-dispatch-"));
  const originalFetch = globalThis.fetch;
  try {
    const manager = fixture(SessionManager.create(dir, dir));
    for (const current of [manager, SessionManager.open(manager.getSessionFile()!, dir)]) {
      const handlers = new Map<string, Function>();
      registerNativeCodexCompaction({
        on: (name: string, fn: Function) => handlers.set(name, fn),
        appendEntry: (type: string, data: any) => current.appendCustomEntry(type, data),
      } as any);
      const ctx: any = {
        model,
        sessionManager: current,
        abort: () => {
          throw new Error("unexpected abort");
        },
        modelRegistry: {
          getApiKeyAndHeaders: async () => ({
            ok: true,
            headers: { Authorization: "Bearer offline", "chatgpt-account-id": "offline" },
          }),
        },
        ui: { notify: () => {} },
      };
      const projected = capture(current).messages;
      const transformed = handlers.get("context")!({ messages: projected }, ctx).messages;
      const input = convertResponsesMessages(
        model,
        normalizeContext({ messages: convertToLlm(transformed) }),
        new Set([model.provider]),
        { includeSystemPrompt: false },
      );
      const ordinary = {
        model: model.id,
        store: false,
        stream: true,
        instructions: "ordinary instruction",
        tools: [],
        input,
        prompt_cache_key: "stable-session",
      };
      handlers.get("before_provider_headers")!(
        { headers: { Authorization: "Bearer offline", "chatgpt-account-id": "offline" } },
        ctx,
      );
      handlers.get("before_provider_request")!({ payload: ordinary }, ctx);
      const e = { ...event(current), reason: "manual", willRetry: false, signal: new AbortController().signal };
      const cut = e.preparation.firstKeptEntryId;
      let body: any,
        calls = 0;
      globalThis.fetch = (async (_url: any, init: any) => {
        calls++;
        body = JSON.parse(init.body);
        return new Response(
          "data: " +
            JSON.stringify({
              type: "response.completed",
              response: {
                status: "completed",
                output: [{ ...item, id: "cmp_new" }],
                usage: { input_tokens: 4, output_tokens: 1 },
              },
            }) +
            "\n\n",
          { status: 200 },
        );
      }) as any;
      const result = await handlers.get("session_before_compact")!(e, ctx);
      expect(calls).toBe(1);
      expect(body.input.slice(0, -1)).toEqual(input);
      expect(body.input.filter((row: any) => row.type === "compaction")).toEqual([item]);
      expect(body.prompt_cache_key).toBe(ordinary.prompt_cache_key);
      expect(body.instructions).toBe(ordinary.instructions);
      expect(result.compaction.firstKeptEntryId).toBe(cut);
      expect(result.compaction.details.item.id).toBe("cmp_new");
      expect(e.preparation.firstKeptEntryId).toBe(cut);
      expect(current.buildContextEntries()[0]).toMatchObject({ details: { item } });
    }
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("unrelated incomplete kept protocol groups do not erase or poison complete discarded shake groups", () => {
  const manager = fixture();
  manager.appendMessage(
    assistant([{ type: "toolCall", id: "pending", name: "execute", arguments: { code: "pending" } }]),
  );
  manager.appendMessage({ role: "user", content: "kept continuation".repeat(1000), timestamp: timestamp++ });
  const c = capture(manager),
    e = event(manager);
  expect(coversDiscardedMessages(c, e)).toBe(true);
  expect(c.messages.some((m: any) => m.role === "assistant" && m.content.some((p: any) => p.id === "pending"))).toBe(
    true,
  );
  expect(
    coversDiscardedMessages(
      {
        ...c,
        messages: c.messages.filter(
          (m: any) => !(m.role === "assistant" && m.content.some((p: any) => p.id === "pending")),
        ),
      },
      e,
    ),
  ).toBe(false);
});

test("split multi-call batch is projected only when every result is explicitly selected", () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage({ role: "user", content: "multi-call turn", timestamp: timestamp++ });
  manager.appendMessage(
    assistant(["one", "two"].map((id) => ({ type: "toolCall", id, name: "execute", arguments: { code: id } }))),
  );
  for (const id of ["one", "two"])
    manager.appendMessage({
      role: "toolResult",
      toolCallId: id,
      toolName: "execute",
      content: [{ type: "text", text: id }],
      isError: false,
      timestamp: timestamp++,
    } as any);
  const entries = manager.buildContextEntries(),
    raw = manager.buildSessionContext().messages;
  const record = buildShakePlan(entries, manager.getSessionId()).record;
  const required = raw.slice(0, 3); // second result is kept
  expect(projectShakenRequiredMessages(required, entries, record)).toEqual([raw[0]]);
  expect(
    projectShakenRequiredMessages(required, entries, {
      ...record,
      toolResultEntryIds: record.toolResultEntryIds.slice(0, 1),
    }),
  ).toEqual(required);
  const reordered = [entries[0]!, entries[2]!, entries[1]!, entries[3]!];
  expect(projectShakenRequiredMessages(required, reordered, record)).toEqual(required);
});

test("projected coverage retains original leaf and boundary guards", () => {
  const manager = fixture(),
    c = capture(manager),
    e = event(manager);
  expect(coversDiscardedMessages(c, e)).toBe(true);
  expect(coversDiscardedMessages({ ...c, leafId: null }, e)).toBe(false);
  expect(
    coversDiscardedMessages(c, { ...e, preparation: { ...e.preparation, firstKeptEntryId: "missing-boundary" } }),
  ).toBe(false);
});
