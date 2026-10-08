import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel, createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import * as anthropic from "@earendil-works/pi-ai/api/anthropic-messages";
import * as codex from "@earendil-works/pi-ai/api/openai-codex-responses";
import {
  ModelRuntime,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import tasks from "../src/agent/extension";

const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const token =
  encode({ alg: "none" }) +
  "." +
  encode({ "https://api.openai.com/auth": { chatgpt_account_id: "offline-account" } }) +
  ".signature";
const usage = {
  input: 10,
  output: 2,
  cacheRead: 100,
  cacheWrite: 0,
  totalTokens: 112,
  cost: { input: 0.001, output: 0.001, cacheRead: 0.001, cacheWrite: 0, total: 0.003 },
};
const sentinel = "phase2-offline-serializer";

// Native compaction uses the HTTP seam; ordinary turns below use the SDK serializer seam.
function nativeCompactionResponse(requestNumber: number, mode: "success" | "failure"): Response {
  if (mode === "failure")
    return new Response(
      "data: " +
        JSON.stringify({
          type: "response.completed",
          response: {
            status: "completed",
            output: [{ type: "message" }],
            usage: { input_tokens: 100, output_tokens: 10 },
          },
        }) +
        "\n\n",
    );
  const item = {
    type: "compaction",
    id: "cmp_fixture_" + requestNumber,
    encrypted_content: "opaque-fixture-" + requestNumber,
  };
  return new Response(
    "data: " +
      JSON.stringify({ type: "response.output_item.done", item }) +
      "\n\ndata: " +
      JSON.stringify({
        type: "response.completed",
        response: {
          status: "completed",
          output: [item],
          usage: {
            input_tokens: 100,
            input_tokens_details: { cached_tokens: 80, cache_write_tokens: 0 },
            output_tokens: 10,
            total_tokens: 110,
          },
        },
      }) +
      "\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}

// Run the real provider serializer and extension hooks, but stop before dispatch.
function captureOrdinaryRequests(sent: any[]) {
  function fixtureStream(m: any, context: any, options: any) {
    const events = createAssistantMessageEventStream();
    void (async () => {
      let error: string | undefined;
      if (options?.signal?.aborted) error = "aborted";
      else {
        const headers = (await options?.transformHeaders?.(options.headers ?? {})) ?? options?.headers;
        const captured = await (m.api === "anthropic-messages" ? anthropic : codex)
          .streamSimple(m, context, {
            ...options,
            headers,
            apiKey: token,
            transport: "sse",
            fetch: (async () => {
              throw Error("ordinary request escaped offline capture");
            }) as any,
            onPayload: async (payload: any) => {
              const changed = await options?.onPayload?.(payload, m);
              sent.push(structuredClone(changed ?? payload));
              throw Error(sentinel);
            },
          })
          .result();
        if (!captured.errorMessage?.includes(sentinel)) error = captured.errorMessage ?? "serializer failed";
      }
      const message: AssistantMessage = {
        role: "assistant",
        api: m.api,
        provider: m.provider,
        model: m.id,
        content: error ? [] : [{ type: "text", text: "Fixture response." }],
        stopReason: error ? "aborted" : "stop",
        errorMessage: error,
        usage,
        timestamp: Date.now(),
      };
      if (error) events.push({ type: "error", reason: "aborted", error: message });
      else events.push({ type: "done", reason: "stop", message });
      events.end(message);
    })().catch((error) => {
      const message: any = {
        role: "assistant",
        api: m.api,
        provider: m.provider,
        model: m.id,
        content: [],
        stopReason: "error",
        errorMessage: String(error),
        usage,
        timestamp: Date.now(),
      };
      events.push({ type: "error", reason: "error", error: message });
      events.end(message);
    });
    return events;
  }
  return fixtureStream;
}

test("native Codex real SDK: auth, Astra checkpoint to Sol, repeat, disk resume, and provider guard", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-native-sdk-"));
  const originalFetch = globalThis.fetch;
  const sent: any[] = [];
  const compactRequests: any[] = [];
  const notices: string[] = [];
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let restoreNotify = () => {};
  let nativeMode: "success" | "failure" = "success";
  const model = getModel("openai-codex", "gpt-6-astra")!;
  const selected = getModel("openai-codex", "gpt-6.1-sol")!;
  try {
    globalThis.fetch = (async (url: any, init: any) => {
      expect(String(url)).toEndWith("/codex/responses");
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe("Bearer " + token);
      expect(headers.get("chatgpt-account-id")).toBe("offline-account");
      const body = JSON.parse(init.body);
      compactRequests.push(body);
      expect(body.input.at(-1)).toEqual({ type: "compaction_trigger" });
      return nativeCompactionResponse(compactRequests.length, nativeMode);
    }) as typeof fetch;
    const runtime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    runtime.hasConfiguredAuth = () => true;
    runtime.checkAuth = (async () => true) as any;
    runtime.getAuth = (async () => ({ auth: { apiKey: token } })) as any;
    const fixtureStream = captureOrdinaryRequests(sent);
    runtime.streamSimple = fixtureStream as any;
    async function open(manager: SessionManager) {
      // Each SDK session gets a fresh offline transport seam; do not inherit
      // wrappers bound to the disposed session's extension context.
      runtime.streamSimple = fixtureStream as any;
      const loader = new DefaultResourceLoader({
        cwd: dir,
        agentDir: dir,
        noExtensions: true,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        extensionFactories: [
          {
            name: "observer",
            factory: (pi) => {
              pi.on("before_agent_start", (_e, ctx) => {
                const ui = ctx.ui,
                  old = ui.notify;
                ui.notify = (message) => {
                  notices.push(message);
                };
                restoreNotify = () => {
                  ui.notify = old;
                };
              });
            },
          },
          { name: "bruv-tasks", factory: tasks },
        ],
      });
      await loader.reload();
      return (
        await createAgentSession({
          cwd: dir,
          agentDir: dir,
          resourceLoader: loader,
          model,
          modelRuntime: runtime,
          sessionManager: manager,
          settingsManager: SettingsManager.inMemory({
            transport: "sse",
            compaction: { enabled: false, keepRecentTokens: 128, reserveTokens: 8192 },
          }),
          thinkingLevel: "medium",
          tools: ["execute"],
        })
      ).session;
    }
    let manager = SessionManager.create(dir, join(dir, "sessions"));
    manager.appendMessage({
      role: "user",
      content: "Original durable fact. " + "older-context ".repeat(500),
      timestamp: 1,
    });
    manager.appendMessage({
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: [{ type: "text", text: "Old reply." }],
      stopReason: "stop",
      usage,
      timestamp: 2,
    });
    session = await open(manager);
    await session.setModel(selected);
    await session.prompt("Ordinary model switch before any checkpoint.");
    expect(sent).toHaveLength(1);
    expect(sent[0].model).toBe(selected.id);
    expect(sent[0].input.some((x: any) => x.type === "compaction")).toBe(false);
    await session.setModel(model);
    await session.prompt("Keep current detail. " + "recent-context ".repeat(150));
    expect(sent).toHaveLength(2);
    const originalPayload = sent.at(-1);
    await session.compact();
    expect(compactRequests).toHaveLength(1);
    for (const key of ["model", "instructions", "tools", "reasoning", "prompt_cache_key"])
      expect(compactRequests[0][key]).toEqual(originalPayload[key]);
    const first = manager
      .getEntries()
      .slice()
      .reverse()
      .find((e) => e.type === "compaction") as any;
    expect(first.details.strategy).toBe("codex-native");
    expect(first.usage).toMatchObject({ input: 20, cacheRead: 80, output: 10, totalTokens: 110 });
    const disk = manager.getSessionFile()!;
    const persisted = await readFile(disk, "utf8");
    expect(persisted).toContain("Original durable fact");
    expect(persisted).toContain("opaque-fixture-1");
    expect(first.summary).not.toContain("opaque-fixture-1");
    const originalDiskEntry = persisted
      .split("\n")
      .filter(Boolean)
      .find((line) => JSON.parse(line).id === first.id)!;
    const originalEntry = JSON.stringify(first);
    const originalItem = structuredClone(first.details.item);
    expect(first.details.model).toBe(model.id);
    await session.setModel(selected);
    await session.prompt("Continue after checkpoint. " + "new-detail ".repeat(180));
    expect(sent.at(-1).model).toBe(selected.id);
    expect(sent.at(-1).input.filter((x: any) => x.type === "compaction")).toEqual([originalItem]);
    expect(JSON.stringify(manager.getEntries().find((e) => e.id === first.id))).toBe(originalEntry);
    expect(
      (await readFile(disk, "utf8"))
        .split("\n")
        .filter(Boolean)
        .find((line) => JSON.parse(line).id === first.id),
    ).toBe(originalDiskEntry);
    expect(sent.at(-1).input.filter((x: any) => x.type === "compaction")).toEqual([
      { type: "compaction", id: "cmp_fixture_1", encrypted_content: "opaque-fixture-1" },
    ]);
    restoreNotify();
    session.dispose();
    session = undefined;
    manager = SessionManager.open(disk);
    session = await open(manager);
    await session.setModel(selected);
    const beforeDiskResume = sent.length;
    await session.prompt("Reconstruct Astra checkpoint on disk and continue with Sol. " + "disk-detail ".repeat(160));
    expect(sent.at(-1).model).toBe(selected.id);
    expect(sent.at(-1).input.filter((x: any) => x.type === "compaction")).toEqual([originalItem]);
    expect(sent).toHaveLength(beforeDiskResume + 1);
    expect(JSON.stringify(manager.getEntries().find((e) => e.id === first.id))).toBe(originalEntry);
    await session.compact();
    expect(compactRequests[1].model).toBe(selected.id);
    expect(
      compactRequests[1].input.some((x: any) => x.type === "compaction" && x.encrypted_content === "opaque-fixture-1"),
    ).toBe(true);
    restoreNotify();
    session.dispose();
    session = undefined;
    manager = SessionManager.open(disk);
    session = await open(manager);
    await session.setModel(model);
    const beforeSecondDiskResume = sent.length;
    await session.prompt("Resume from disk, preserving native state. " + "resumed-context ".repeat(160));
    expect(sent.at(-1).input.filter((x: any) => x.type === "compaction")).toEqual([
      { type: "compaction", id: "cmp_fixture_2", encrypted_content: "opaque-fixture-2" },
    ]);
    expect(sent).toHaveLength(beforeSecondDiskResume + 1);
    expect(sent.at(-1).model).toBe(model.id);
    const checkpoints = () => manager.getEntries().filter((e) => e.type === "compaction").length;
    const beforeCount = checkpoints(),
      beforeSent = sent.length;
    await expect(session.compact("Unsupported custom focus")).rejects.toThrow();
    expect(checkpoints()).toBe(beforeCount);
    expect(sent).toHaveLength(beforeSent);
    nativeMode = "failure";
    await expect(session.compact()).rejects.toThrow();
    expect(checkpoints()).toBe(beforeCount);
    expect(sent).toHaveLength(beforeSent);
    expect(compactRequests).toHaveLength(3);
    const attempts = manager
      .getEntries()
      .filter((e) => e.type === "custom" && e.customType === "bruv-compaction-attempt") as any[];
    expect(attempts).toHaveLength(1);
    expect(attempts[0].data.usage.cost.total).toBeGreaterThan(0);
    manager.appendMessage({
      role: "user",
      content: "Uncaptured discarded fact. " + "uncaptured detail ".repeat(180),
      timestamp: Date.now(),
    });
    manager.appendMessage({
      role: "assistant",
      api: model.api,
      provider: model.provider,
      model: model.id,
      content: [{ type: "text", text: "Uncaptured reply." }],
      stopReason: "stop",
      usage,
      timestamp: Date.now(),
    });
    await expect(session.compact()).rejects.toThrow();
    expect(compactRequests).toHaveLength(3);
    expect(checkpoints()).toBe(beforeCount);
    await session.setModel(selected);
    await session.prompt("Normal Codex switching still preserves the opaque context.");
    expect(sent).toHaveLength(beforeSent + 1);
    expect(sent.at(-1).model).toBe(selected.id);
    expect(sent.at(-1).input.filter((x: any) => x.type === "compaction")).toEqual([
      { type: "compaction", id: "cmp_fixture_2", encrypted_content: "opaque-fixture-2" },
    ]);
    await session.setModel({ ...selected, api: "openai-responses" });
    await session.prompt("Wrong API on the same provider must be blocked.").catch(() => {});
    expect(sent).toHaveLength(beforeSent + 1);
    await session.setModel(getModel("anthropic", "claude-sonnet-4-5")!);
    await session.prompt("Foreign-provider request must also be blocked.").catch(() => {});
    expect(sent).toHaveLength(beforeSent + 1);
    expect(notices.some((n) => /native|opaque/i.test(n))).toBe(true);
  } finally {
    restoreNotify();
    session?.dispose();
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
