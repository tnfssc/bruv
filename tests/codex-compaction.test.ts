import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { convertToLlm, type SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { codexResponsesUrl, registerCodexCompaction } from "../src/codex-compaction";
import { sdk } from "./sdk";

const item = { type: "compaction", id: "cmp_781", encrypted_content: "saved-781" };
const body = {
  model: "codex-test",
  stream: true,
  store: false,
  service_tier: "priority",
  input: [{ role: "user", content: [{ type: "input_text", text: "task-781" }] }],
  tools: [{ type: "function", name: "codemode" }],
  prompt_cache_key: "cache-781",
};
const headers = {
  Authorization: "Bearer fixture",
  "chatgpt-account-id": "account-781",
  "x-extra": "kept",
  connection: "upgrade",
  "sec-websocket-key": "removed",
};
const eventStream = (events: unknown[]) => {
  const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""));
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        // A terminal event must finish even if the connection stays open.
      },
    }),
  );
};
async function setup(fetch: (url: string, init: RequestInit) => Promise<Response>) {
  let notices = 0;
  const app = await sdk([(pi) => registerCodexCompaction(pi, { fetch })], {
    notify: () => {
      notices++;
    },
  });
  app.session.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
  app.faux.setResponses([fauxAssistantMessage("result-781")]);
  await app.session.prompt("task-781");
  await app.session.setModel({
    ...app.faux.getModel(),
    api: "openai-codex-responses",
    id: "codex-test",
    baseUrl: "https://fixture.invalid/backend-api/codex/",
  });
  const runner = app.session.extensionRunner;
  await runner.emitBeforeProviderHeaders(headers);
  await runner.emitBeforeProviderRequest(structuredClone(body));
  return { ...app, runner, notices: () => notices };
}
function nextPayload(app: Awaited<ReturnType<typeof setup>>) {
  const messages = convertToLlm(app.session.sessionManager.buildSessionContext().messages);
  return {
    ...body,
    input: messages
      .filter((m) => m.role === "user")
      .map((m) => ({
        role: "user",
        content:
          typeof m.content === "string"
            ? [{ type: "input_text", text: m.content }]
            : m.content.map((c) => ({ ...c, type: c.type === "text" ? "input_text" : c.type })),
      })),
  };
}

test.each([false, true])("Codex request, saved item, replay, and model fallback (streamed=%s)", async (streamed) => {
  let calls = 0;
  const app = await setup(async (url, init) => {
    calls++;
    expect(url).toBe("https://fixture.invalid/backend-api/codex/responses");
    expect(JSON.parse(String(init?.body))).toEqual({
      ...body,
      service_tier: "default",
      input: [...body.input, { type: "compaction_trigger" }],
    });
    const sent = new Headers(init?.headers);
    expect(sent.get("Authorization")).toBe(headers.Authorization);
    expect(sent.get("chatgpt-account-id")).toBe(headers["chatgpt-account-id"]);
    expect(sent.get("x-extra")).toBe("kept");
    expect(sent.has("connection")).toBe(false);
    expect(sent.has("sec-websocket-key")).toBe(false);
    expect(sent.get("session-id")).toBe(app.session.sessionManager.getSessionId());
    return eventStream([
      ...(streamed ? [{ type: "response.output_item.done", item }] : []),
      {
        type: "response.completed",
        response: {
          status: "completed",
          output: streamed ? [] : [item],
          usage: { input_tokens: 12, output_tokens: 2, input_tokens_details: { cached_tokens: 4 } },
        },
      },
    ]);
  });
  try {
    const result = await app.session.compact();
    expect(result.details).toEqual({
      strategy: "codex-native",
      version: 1,
      provider: app.faux.getModel().provider,
      model: "codex-test",
      item,
    });
    expect(result.usage).toMatchObject({ input: 8, output: 2, cacheRead: 4, totalTokens: 14 });
    const payload = nextPayload(app);
    expect(
      ((await app.runner.emitBeforeProviderRequest(structuredClone(payload))) as { input: unknown[] }).input,
    ).toContainEqual(item);
    await app.runner.emit({ type: "session_start", reason: "reload" });
    expect(
      ((await app.runner.emitBeforeProviderRequest(structuredClone(payload))) as { input: unknown[] }).input,
    ).toContainEqual(item);
    const compactionId = app.session.sessionManager.getLeafId();
    const earlier = app.session.sessionManager.getBranch().find((entry) => entry.type === "message");
    if (!earlier || !compactionId) throw new Error("Missing test entries");
    app.session.sessionManager.branch(earlier.id);
    await app.runner.emit({ type: "session_tree", oldLeafId: compactionId, newLeafId: earlier.id });
    expect(await app.runner.emitBeforeProviderRequest(structuredClone(payload))).toEqual(payload);
    app.session.sessionManager.branch(compactionId);
    await app.runner.emit({ type: "session_tree", oldLeafId: earlier.id, newLeafId: compactionId });
    expect(
      ((await app.runner.emitBeforeProviderRequest(structuredClone(payload))) as { input: unknown[] }).input,
    ).toContainEqual(item);
    await app.session.setModel({ ...app.faux.getModel(), id: "another-codex", api: "openai-codex-responses" });
    expect(await app.runner.emitBeforeProviderRequest(structuredClone(payload))).toEqual(payload);
    await app.runner.emitBeforeProviderRequest(structuredClone(payload));
    expect(app.notices()).toBe(1);
    expect(calls).toBe(1);
  } finally {
    await app.close();
  }
});

test.each(["http", "failed", "missing", "mixed"])(
  "Codex failure keeps history and lets the next compaction use Pi (%s)",
  async (failure) => {
    let calls = 0;
    const app = await setup(async () => {
      calls++;
      if (failure === "http") return new Response("", { status: 500 });
      if (failure === "failed") return eventStream([{ type: "response.failed" }]);
      return eventStream([
        { type: "response.completed", response: { output: failure === "missing" ? [] : [item, { type: "message" }] } },
      ]);
    });
    try {
      const branch = app.session.sessionManager.getBranch();
      await expect(app.session.compact()).rejects.toThrow();
      expect(app.session.sessionManager.getBranch()).toEqual(branch);
      expect(app.notices()).toBe(1);
      const event: SessionBeforeCompactEvent = {
        type: "session_before_compact",
        branchEntries: branch,
        reason: "manual",
        willRetry: false,
        signal: new AbortController().signal,
        preparation: {
          firstKeptEntryId: branch[0].id,
          messagesToSummarize: [],
          turnPrefixMessages: [],
          isSplitTurn: false,
          tokensBefore: 10,
          fileOps: { read: new Set(), written: new Set(), edited: new Set() },
          settings: { enabled: false, keepRecentTokens: 100, reserveTokens: 100 },
        },
      };
      expect(await app.runner.emit(event)).toBeUndefined();
      expect(calls).toBe(1);
    } finally {
      await app.close();
    }
  },
);

test("Codex URL accepts each supported base path", () => {
  expect(codexResponsesUrl("")).toBe("https://chatgpt.com/backend-api/codex/responses");
  for (const suffix of ["", "/codex", "/codex/responses", "/codex/responses/"])
    expect(codexResponsesUrl(`https://fixture.invalid${suffix}`)).toBe("https://fixture.invalid/codex/responses");
});
