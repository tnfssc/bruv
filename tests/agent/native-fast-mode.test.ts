import { AuthStorage } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { normalizeContext } from "@earendil-works/pi-ai";
import * as codex from "@earendil-works/pi-ai/api/openai-codex-responses";
import * as openai from "@earendil-works/pi-ai/api/openai-responses";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  ModelRegistry,
  createAgentSession,
  DefaultResourceLoader,
  type InlineExtension,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  FAST_CHECKPOINT_PERSIST_FAILED,
  FAST_GUARD_TIER_MUTATION,
  FAST_REFUSED_AUTH,
  FAST_REFUSED_STALE,
  NATIVE_FAST_CHILD_ENV,
  NATIVE_FAST_ENTRY,
  nativeFastEnabled,
  nativeFastSupport,
  registerNativeFastMode,
  withStandardProviderTier,
} from "../../src/agent/native-fast-mode";
import { inspectDiagnostics } from "../../src/diagnostics";
import { restoreLeaf } from "../../src/session/restore-leaf";

// The seam is fake, but serialization runs through the actual provider adapters.
function providerRuntime(oauth?: boolean) {
  return {
    isUsingOAuth: (provider: string) => oauth ?? provider === "openai-codex",
    async prepareRequest(requestModel: any, requestOptions: any) {
      return {
        provider: {
          id: requestModel.provider,
          streamSimple: requestModel.provider === "openai-codex" ? codex.streamSimple : openai.streamSimple,
        },
        model: requestModel,
        options: requestOptions,
      };
    },
    streamSimple(model: any, context: any, requestOptions: any) {
      const api = model.provider === "openai-codex" ? codex : openai;
      return api.streamSimple(model, context, requestOptions);
    },
  };
}

function harness(
  model: any,
  options: {
    mode?: string;
    oauth?: boolean;
    accept?: boolean;
    sessionId?: string;
    confirm?: () => Promise<boolean>;
    runtime?: ModelRuntime | ReturnType<typeof providerRuntime>;
    sessionManager?: SessionManager;
    appendEntry?: (customType: string, data: any) => void;
  } = {},
) {
  const entries: any[] = [],
    notices: any[] = [],
    statuses: any[] = [];
  const hooks = new Map<string, any[]>();
  let command: any;
  const sessionManager = options.sessionManager ?? {
    getSessionId: () => options.sessionId ?? "session-a",
    getBranch: () => entries,
    getEntries: () => entries,
  };
  const appendEntry =
    options.appendEntry ??
    (options.sessionManager
      ? options.sessionManager.appendCustomEntry.bind(options.sessionManager)
      : (customType: string, data: any) => entries.push({ type: "custom", customType, data }));
  const pi = {
    registerFlag() {},
    getFlag: () => options.accept ?? false,
    registerCommand(name: string, value: any) {
      if (name === "fast") command = value;
    },
    on(name: string, handler: any) {
      hooks.set(name, [...(hooks.get(name) ?? []), handler]);
    },
    appendEntry,
  } as any;
  const runtime = options.runtime ?? providerRuntime(options.oauth);
  const ctx = {
    mode: options.mode ?? "tui",
    model,
    modelRegistry: {
      runtime,
      isUsingOAuth(value: any) {
        return this.runtime.isUsingOAuth(value.provider);
      },
    },
    sessionManager,
    ui: {
      confirm: options.confirm ?? (async () => true),
      notify: (message: string, kind: string) => notices.push({ message, kind }),
      setStatus: (key: string, value?: string) => statuses.push({ key, value }),
    },
  } as any;
  const registration = registerNativeFastMode(pi);
  const emit = async (name: string, event: any = {}) => {
    let value: unknown;
    for (const handler of hooks.get(name) ?? []) value = await handler(event, ctx);
    return value;
  };
  return {
    runtime,
    command,
    ctx,
    notices,
    statuses,
    emit,
    registration,
    get entries() {
      return sessionManager.getBranch();
    },
  };
}

async function createOfflineSession(
  dir: string,
  model: any,
  manager: SessionManager,
  options: { oauth?: boolean; extensions?: InlineExtension[] } = {},
) {
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    extensionFactories: [
      {
        name: "native-fast",
        factory: (pi) => {
          registerNativeFastMode(pi);
        },
      },
      ...(options.extensions ?? []),
    ],
  });
  await loader.reload();
  const runtime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  runtime.hasConfiguredAuth = () => true;
  runtime.isUsingOAuth = () => options.oauth ?? false;
  runtime.getAuth = (async () => ({ auth: { apiKey: "sk-offline-key" } })) as any;
  return (
    await createAgentSession({
      cwd: dir,
      agentDir: dir,
      resourceLoader: loader,
      modelRuntime: runtime,
      model,
      sessionManager: manager,
      tools: [],
    })
  ).session;
}

function sse(serviceTier: string | undefined) {
  const response = {
    status: "completed",
    service_tier: serviceTier,
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok", annotations: [] }] }],
    usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5, input_tokens_details: { cached_tokens: 0 } },
  };
  return new Response(`data: ${JSON.stringify({ type: "response.completed", response })}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const CODEX_TOKEN = [
  Buffer.from("{}").toString("base64url"),
  Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct" } })).toString("base64url"),
  "x",
].join(".");

async function decodeRequestBody(init: any) {
  const bytes = Buffer.from(await new Response(init.body).arrayBuffer());
  const json =
    init.headers.get("content-encoding") === "zstd" ? zstdDecompressSync(bytes).toString() : bytes.toString();
  return JSON.parse(json);
}

async function wirePayload(
  h: ReturnType<typeof harness>,
  model = h.ctx.model,
  options: {
    apiKey?: string;
    headers?: Record<string, string>;
    onPayload?: (payload: any) => any;
    onProviderStreamEvent?: (event: any, model: any) => void;
    sessionId?: string;
    responseTier?: string | null;
  } = {},
): Promise<any> {
  let body: any;
  await h.ctx.modelRegistry.runtime
    .streamSimple(
      model,
      { systemPrompt: "sys", messages: [{ role: "user", content: "hi", timestamp: 1 }], tools: [] },
      {
        apiKey: options.apiKey ?? (h.ctx.modelRegistry.isUsingOAuth(model) ? CODEX_TOKEN : "sk-offline-key"),
        transport: "sse",
        headers: options.headers,
        sessionId: options.sessionId ?? h.ctx.sessionManager.getSessionId(),
        onPayload: options.onPayload,
        onProviderStreamEvent: options.onProviderStreamEvent,
        fetch: (async (_url: any, init: any) => {
          body = await decodeRequestBody(init);
          return sse(options.responseTier === null ? undefined : (options.responseTier ?? "priority"));
        }) as typeof fetch,
      },
    )
    .result();
  return body;
}

test("Codex fast settings preserve runtime system prompt and tools", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-fast-codex-context-"));
  try {
    const model = getModel("openai-codex", "gpt-5.6-luna")!;
    for (const action of ["status", "on", "off"]) {
      const runtime = await ModelRuntime.create({
        authPath: join(dir, "auth.json"),
        modelsPath: null,
        refreshOnCreate: false,
      });
      runtime.isUsingOAuth = () => true;
      runtime.getAuth = (async () => ({ auth: { apiKey: CODEX_TOKEN } })) as any;
      const h = harness(model, { mode: "print", accept: true, runtime });
      await h.command.handler(action, h.ctx);
      let body: any;
      const response = await runtime
        .streamSimple(
          model,
          {
            systemPrompt: "keep-system",
            messages: [{ role: "user", content: "hi", timestamp: 1 }],
            tools: [{ name: "lookup", description: "Look up a value", parameters: { type: "object", properties: {} } }],
          },
          {
            transport: "sse",
            sessionId: "session-a",
            fetch: (async (_url: any, init: any) => {
              body = await decodeRequestBody(init);
              return sse(action === "on" ? "priority" : "default");
            }) as typeof fetch,
          },
        )
        .result();
      expect(response.stopReason).toBe("stop");
      expect(body.service_tier).toBe(action === "status" ? undefined : action === "on" ? "priority" : "default");
      expect(response.usage.cost.total).toBeCloseTo(
        ((4 * model.cost.input + model.cost.output) / 1_000_000) * (action === "on" ? 2 : 1),
        12,
      );
      expect(body.instructions).toBe("keep-system");
      expect(body.tools).toMatchObject([{ type: "function", name: "lookup" }]);
      await h.emit("session_shutdown");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const provider of ["openai", "openai-codex"] as const) {
  test(`native fast forwards model aliases on the official ${provider} surface`, async () => {
    const base = provider === "openai" ? getModel("openai", "gpt-5.3-codex")! : getModel("openai-codex", "gpt-5.5")!;
    for (const id of ["gpt-6.1-sol", "gpt-5.3-codex-spark", "gpt-5.4-mini", "future-model-alias"]) {
      const model = { ...base, id };
      expect(nativeFastSupport(model)).toEqual({
        supported: true,
        tier: "priority",
        surface: provider === "openai" ? "api" : "codex",
      });
      const h = harness(model, { mode: "print", accept: true });
      expect((await wirePayload(h)).service_tier).toBeUndefined();
      await h.command.handler("on", h.ctx);
      expect(await wirePayload(h)).toMatchObject({
        model: id,
        service_tier: "priority",
      });
      await h.command.handler("off", h.ctx);
      expect(await wirePayload(h)).toMatchObject({ model: id, service_tier: "default" });
    }
  });
}

test("a shared runtime rejects competing authorizations and restores only after its last owner leaves", async () => {
  const model = getModel("openai", "gpt-5.3-codex")!;
  const runtime = providerRuntime();
  const first = harness(model, { mode: "print", accept: true, runtime });
  const second = harness(model, { mode: "print", accept: true, runtime });
  const originalDescriptor = Object.getOwnPropertyDescriptor(runtime, "streamSimple");
  let preparations = 0;
  const prepare = runtime.prepareRequest;
  runtime.prepareRequest = async (...args) => {
    preparations++;
    return prepare(...args);
  };

  await first.command.handler("on", first.ctx);
  const guard = runtime.streamSimple;
  await second.command.handler("on", second.ctx);
  expect(runtime.streamSimple).toBe(guard);
  expect(await wirePayload(first)).toBeUndefined();
  expect(preparations).toBe(0);

  await second.emit("session_shutdown");
  expect(runtime.streamSimple).toBe(guard);
  expect((await wirePayload(first)).service_tier).toBe("priority");
  expect(preparations).toBe(1);

  await first.emit("session_shutdown");
  expect(Object.getOwnPropertyDescriptor(runtime, "streamSimple")).toEqual(originalDescriptor);
  expect((await wirePayload(first)).service_tier).toBeUndefined();
});

test("native fast rejects unofficial provider and endpoint routing", () => {
  const custom = { ...getModel("openai", "gpt-5.3-codex")!, provider: "gateway" };
  expect(nativeFastSupport(custom).supported).toBe(false);
  const proxy = { ...getModel("openai", "gpt-5.3-codex")!, baseUrl: "https://proxy.example/v1" };
  expect(nativeFastSupport(proxy).supported).toBe(false);
});

test("fast mode rejects the wrong authentication surface", async () => {
  const codexModel = getModel("openai-codex", "gpt-5.5")!;
  const codex = harness(codexModel, { mode: "print", accept: true });
  codex.ctx.modelRegistry.isUsingOAuth = () => false;
  await codex.command.handler("on", codex.ctx);
  expect(codex.entries).toEqual([]);
  expect(codex.notices.at(-1).message).toContain("ChatGPT OAuth");

  const apiModel = getModel("openai", "gpt-5.3-codex")!;
  const api = harness(apiModel, { mode: "print", accept: true, oauth: true });
  await api.command.handler("on", api.ctx);
  expect(api.entries.at(-1).data).toMatchObject({ enabled: true, oauth: true });
  expect(nativeFastEnabled(api.ctx)).toBe(true);
  expect((await wirePayload(api)).service_tier).toBe("priority");
});

test("/fast is safe status; on requires consent and state is session/model/branch bound", async () => {
  const model = getModel("openai-codex", "gpt-5.6-luna")!;
  const h = harness(model, { mode: "print", accept: false });
  await h.command.handler("", h.ctx);
  expect(h.notices.at(-1).message).toContain("no model-bound setting");
  await h.command.handler("on", h.ctx);
  expect(h.entries).toEqual([]);
  expect(h.notices.at(-1).message).toContain("--accept-cost");

  const accepted = harness(model, { mode: "print", accept: true });
  await accepted.command.handler("on", accepted.ctx);
  expect(accepted.notices.at(-1)).toMatchObject({ kind: "info" });
  expect(accepted.notices.at(-1).message).toContain(
    "Native fast mode on for this session, model, and new supported subagents",
  );
  expect(accepted.entries[0].data).toMatchObject({ enabled: true, costAcknowledged: true, model: model.id });
  expect((await wirePayload(accepted)).service_tier).toBe("priority");

  accepted.ctx.model = getModel("openai-codex", "gpt-5.5")!;
  expect((await wirePayload(accepted)).service_tier).toBeUndefined();
  accepted.ctx.model = model;
  accepted.ctx.sessionManager.getSessionId = () => "new-child-session";
  expect((await wirePayload(accepted)).service_tier).toBeUndefined();
});

test("enabling and restoring fast fail visibly without the pinned runtime seam", async () => {
  const model = getModel("openai", "gpt-5.3-codex")!;
  const h = harness(model, { mode: "print", accept: true });
  h.ctx.modelRegistry.runtime = undefined;
  await h.command.handler("on", h.ctx);
  expect(h.entries).toEqual([]);
  expect(h.notices.at(-1)).toMatchObject({ kind: "error" });
  expect(h.notices.at(-1).message).toContain("pinned Pi 1.1.0");
  expect(() => h.registration.setWithCostConsent(true)).toThrow("pinned Pi 1.1.0");
  expect(h.entries).toEqual([]);

  h.entries.push({
    type: "custom",
    customType: NATIVE_FAST_ENTRY,
    data: {
      version: 2,
      oauth: false,
      sessionId: "session-a",
      provider: model.provider,
      model: model.id,
      enabled: true,
      costAcknowledged: true,
      timestamp: 1,
    },
  });
  await h.emit("session_start");
  expect(h.notices.at(-1)).toMatchObject({ kind: "error" });
  expect(h.notices.at(-1).message).toContain("compatibility seam is missing");

  const savedFast = process.env[NATIVE_FAST_CHILD_ENV];
  const savedDepth = process.env.BRUV_SUBAGENT_DEPTH;
  try {
    process.env[NATIVE_FAST_CHILD_ENV] = "1";
    process.env.BRUV_SUBAGENT_DEPTH = "1";
    const child = harness(model, { mode: "print", accept: true });
    child.ctx.modelRegistry.runtime = undefined;
    await child.emit("session_start");
    expect(child.entries).toEqual([]);
  } finally {
    if (savedFast === undefined) delete process.env[NATIVE_FAST_CHILD_ENV];
    else process.env[NATIVE_FAST_CHILD_ENV] = savedFast;
    if (savedDepth === undefined) delete process.env.BRUV_SUBAGENT_DEPTH;
    else process.env.BRUV_SUBAGENT_DEPTH = savedDepth;
  }
});

test("consent is rejected if session, branch, or model changes while confirmation is open", async () => {
  const model = getModel("openai-codex", "gpt-5.6-luna")!;
  const confirming = Promise.withResolvers<void>();
  const decision = Promise.withResolvers<boolean>();
  const h = harness(model, {
    confirm: () => {
      confirming.resolve();
      return decision.promise;
    },
  });
  h.ctx.sessionManager.getLeafId = () => "leaf-a";
  const pending = h.command.handler("on", h.ctx);
  await confirming.promise;
  h.ctx.model = getModel("openai-codex", "gpt-5.5")!;
  h.ctx.sessionManager.getSessionId = () => "session-b";
  h.ctx.sessionManager.getLeafId = () => "leaf-b";
  decision.resolve(true);
  await pending;
  expect(h.entries).toEqual([]);
  expect(h.notices.at(-1).message).toContain("became stale");
});

test("compaction snapshot is request-local and explicit off affects only later requests", async () => {
  const model = getModel("openai", "gpt-5.3-codex")!;
  const h = harness(model, { mode: "print", accept: true });
  await h.command.handler("on", h.ctx);
  expect((await withStandardProviderTier(() => wirePayload(h))).service_tier).toBe("default");
  expect((await wirePayload(h)).service_tier).toBe("priority");

  let release!: () => void;
  const scoped = withStandardProviderTier(async () => {
    await new Promise<void>((resolve) => (release = resolve));
    return wirePayload(h);
  });
  expect((await wirePayload(h)).service_tier).toBe("priority");
  release();
  expect((await scoped).service_tier).toBe("default");

  await h.command.handler("off", h.ctx);
  expect((await wirePayload(h)).service_tier).toBe("default");
  const untouched = harness(model);
  expect(
    (
      await wirePayload(untouched, model, {
        onPayload: (payload) => ({ ...payload, service_tier: "project-custom" }),
      })
    ).service_tier,
  ).toBe("project-custom");
});

test("actual Pi streamSimple OpenAI serialization carries Codex-compatible priority tier", async () => {
  const model = getModel("openai", "gpt-5.3-codex")!;
  const h = harness(model, { mode: "print", accept: true });
  await h.command.handler("on", h.ctx);
  let body: any;
  const result = await h.ctx.modelRegistry.runtime
    .streamSimple(
      model,
      { systemPrompt: "sys", messages: [{ role: "user", content: "hi", timestamp: 1 }], tools: [] },
      {
        apiKey: "sk-offline-key",
        reasoning: "low",
        fetch: (async (_url: any, init: any) => {
          body = JSON.parse(init.body);
          return sse("fast");
        }) as typeof fetch,
        sessionId: "session-a",
      },
    )
    .result();
  expect(result.stopReason).toBe("stop");
  expect(body.service_tier).toBe("priority");
  // This is the pinned SDK catalog estimate, not an upstream credit price.
  expect(result.usage.cost.total).toBeCloseTo(((4 * model.cost.input + model.cost.output) / 1_000_000) * 2, 12);
  expect(body.model).toBe("gpt-5.3-codex");
  expect(body.reasoning.effort).toBe("low");
});

test("actual Pi streamSimple Codex SSE serialization carries priority and preserves request settings", async () => {
  const model = getModel("openai-codex", "gpt-5.6-luna")!;
  const h = harness(model, { mode: "print", accept: true });
  await h.command.handler("on", h.ctx);
  let body: any;
  await h.ctx.modelRegistry.runtime
    .streamSimple(
      model,
      normalizeContext({
        systemPrompt: "keep-system",
        messages: [{ role: "user", content: "hi", timestamp: 1 }],
        tools: [],
      }),
      {
        apiKey: CODEX_TOKEN,
        transport: "sse",
        reasoning: "low",
        fetch: (async (_url: any, init: any) => {
          body = await decodeRequestBody(init);
          return sse("priority");
        }) as typeof fetch,
        sessionId: "session-a",
      },
    )
    .result();
  expect(body).toMatchObject({ service_tier: "priority", instructions: "keep-system", stream: true, store: false });
  expect(body.reasoning.effort).toBe("low");
});

test("actual Pi streamSimple Codex WebSocket frame carries priority", async () => {
  const model = getModel("openai-codex", "gpt-5.6-luna")!;
  const h = harness(model, { mode: "print", accept: true });
  await h.command.handler("on", h.ctx);
  const original = globalThis.WebSocket;
  let frame: any;
  class FixtureWebSocket extends EventTarget {
    static OPEN = 1;
    readyState = 0;
    constructor(_url: string, _options?: unknown) {
      super();
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      });
    }
    send(value: string) {
      frame = JSON.parse(value);
      const response = {
        type: "response.completed",
        response: {
          status: "completed",
          service_tier: "default",
          output: [],
          usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5, input_tokens_details: { cached_tokens: 0 } },
        },
      };
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(response) })));
    }
    close() {
      this.readyState = 3;
    }
  }
  try {
    globalThis.WebSocket = FixtureWebSocket as any;
    const response = await h.ctx.modelRegistry.runtime
      .streamSimple(
        model,
        normalizeContext({
          systemPrompt: "ws-system",
          messages: [{ role: "user", content: "hi", timestamp: 1 }],
          tools: [],
        }),
        {
          apiKey: CODEX_TOKEN,
          transport: "websocket",
          sessionId: "session-a",
        },
      )
      .result();
    expect(response.stopReason).toBe("stop");
    expect(frame).toMatchObject({ type: "response.create", service_tier: "priority", instructions: "ws-system" });
    expect(h.statuses.at(-1).value).toBe(" fast on");
    // Pi streamSimple drops the pricing fallback option; default yields the
    // base catalog estimate, not proof of standard delivery or credit pricing.
    expect(response.usage.cost.total).toBeCloseTo((4 * model.cost.input + model.cost.output) / 1_000_000, 12);
  } finally {
    globalThis.WebSocket = original;
  }
});

test("actual ModelRuntime request snapshot ignores model changes during delayed auth preparation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-fast-snapshot-"));
  const originalFetch = globalThis.fetch;
  try {
    const base = getModel("openai", "gpt-5.3-codex")!;
    const other = { ...base, id: "gpt-6-astra" };
    for (const authorizedModel of [other, base]) {
      const runtime = await ModelRuntime.create({
        authPath: join(dir, authorizedModel.id + ".json"),
        modelsPath: null,
        refreshOnCreate: false,
      });
      runtime.isUsingOAuth = () => false;
      const preparing = Promise.withResolvers<void>();
      const resumeAuth = Promise.withResolvers<void>();
      runtime.getAuth = (async () => {
        preparing.resolve();
        await resumeAuth.promise;
        return { auth: { apiKey: "sk-offline-key" } };
      }) as any;
      const h = harness(base, { runtime });
      h.entries.push({
        type: "custom",
        customType: NATIVE_FAST_ENTRY,
        data: {
          version: 2,
          oauth: false,
          sessionId: "session-a",
          provider: authorizedModel.provider,
          model: authorizedModel.id,
          enabled: true,
          costAcknowledged: true,
          timestamp: 1,
        },
      });
      await h.emit("session_start");
      let body: any;
      globalThis.fetch = (async (_url: any, init: any) => {
        body = JSON.parse(init.body);
        return sse(authorizedModel === base ? "fast" : "default");
      }) as typeof fetch;
      const pending = runtime
        .streamSimple(
          base,
          { systemPrompt: "sys", messages: [{ role: "user", content: "hi", timestamp: 1 }], tools: [] },
          { sessionId: "session-a", onPayload: async (payload) => payload },
        )
        .result();
      await preparing.promise;
      h.ctx.model = other;
      resumeAuth.resolve();
      await pending;
      expect(body.model).toBe(base.id);
      expect(body.service_tier).toBe(authorizedModel === base ? "priority" : undefined);
      await h.emit("session_shutdown");
    }
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("real AgentSession ModelRuntime guard survives swallowed hook throws and stops late mutation before mock fetch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-fast-boundary-"));
  const originalFetch = globalThis.fetch;
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let dispatches = 0;
  try {
    const model = getModel("openai", "gpt-5.3-codex")!;
    const manager = SessionManager.inMemory(dir);
    manager.appendCustomEntry(NATIVE_FAST_ENTRY, {
      version: 2,
      oauth: false,
      sessionId: manager.getSessionId(),
      provider: model.provider,
      model: model.id,
      enabled: true,
      costAcknowledged: true,
      timestamp: 1,
    });
    globalThis.fetch = (async () => {
      dispatches++;
      return sse("fast");
    }) as unknown as typeof fetch;
    session = await createOfflineSession(dir, model, manager, {
      extensions: [
        {
          name: "late-tier-mutator",
          factory: (pi) => {
            pi.on("before_provider_request", (event) => {
              (event.payload as any).service_tier = "default";
              throw new Error("swallowed late hook failure");
            });
          },
        },
      ],
    });
    await session.bindExtensions({ mode: "print" });
    await session.prompt("prove no dispatch");
    expect(dispatches).toBe(0);
    const last = session.messages.at(-1) as any;
    expect(last.stopReason).toBe("error");
    expect(last.errorMessage).toContain("late service-tier mutation");
    const diagnostic = inspectDiagnostics(manager).records.at(-1)!;
    expect(diagnostic).toMatchObject({ code: FAST_GUARD_TIER_MUTATION, outcome: "blocked", dispatch: "none" });
    expect(
      Object.keys(diagnostic)
        .filter((key) => key !== "version" && key !== "generated")
        .sort(),
    ).toEqual(["code", "component", "dispatch", "operationId", "outcome"]);
    expect(JSON.stringify(diagnostic)).not.toContain("swallowed late hook failure");
  } finally {
    session?.dispose();
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

for (const scenario of ["corrupt-record", "wrong-auth", "unsupported-endpoint"] as const) {
  test(`real ModelRuntime blocks ${scenario} at zero fetch dispatches`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-fast-reject-"));
    const originalFetch = globalThis.fetch;
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    let dispatches = 0;
    try {
      const documented = getModel("openai", "gpt-5.3-codex")!;
      const model =
        scenario === "unsupported-endpoint" ? { ...documented, baseUrl: "https://proxy.example/v1" } : documented;
      const manager = SessionManager.inMemory(dir);
      manager.appendCustomEntry(NATIVE_FAST_ENTRY, {
        version: scenario === "corrupt-record" ? 99 : 2,
        oauth: false,
        sessionId: manager.getSessionId(),
        provider: model.provider,
        model: model.id,
        enabled: true,
        costAcknowledged: true,
        timestamp: 1,
      });
      globalThis.fetch = (async () => {
        dispatches++;
        return sse("fast");
      }) as unknown as typeof fetch;
      session = await createOfflineSession(dir, model, manager, { oauth: scenario === "wrong-auth" });
      await session.bindExtensions({ mode: "print" });
      await session.prompt("must fail closed");
      expect(dispatches).toBe(0);
      expect((session.messages.at(-1) as any).stopReason).toBe("error");
    } finally {
      session?.dispose();
      globalThis.fetch = originalFetch;
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("fast refusals and the concrete tier guard emit privacy-bounded static diagnostics", async () => {
  const model = getModel("openai", "gpt-5.3-codex")!;
  const auth = harness(getModel("openai-codex", "gpt-5.5")!, { mode: "print", accept: true });
  auth.ctx.modelRegistry.isUsingOAuth = () => false;
  await auth.command.handler("on", auth.ctx);
  expect(inspectDiagnostics(auth.ctx.sessionManager).records.at(-1)).toMatchObject({
    component: "fast",
    code: FAST_REFUSED_AUTH,
    outcome: "blocked",
    dispatch: "none",
  });

  const stale = harness(model, {
    confirm: async () => {
      stale.ctx.sessionManager.getSessionId = () => "changed-session";
      return true;
    },
  });
  await stale.command.handler("on", stale.ctx);
  expect(inspectDiagnostics(stale.ctx.sessionManager).records.at(-1)?.code).toBe(FAST_REFUSED_STALE);
});

test("fast checkpoint append failure is a controlled refusal with no setting", async () => {
  const model = getModel("openai", "gpt-5.3-codex")!;
  const h = harness(model, {
    mode: "print",
    accept: true,
    appendEntry() {
      throw new Error("private persistence detail");
    },
  });
  await h.command.handler("on", h.ctx);
  expect(h.entries).toEqual([]);
  expect(h.notices.at(-1)).toMatchObject({ kind: "error" });
  const records = inspectDiagnostics(h.ctx.sessionManager).records;
  expect(records.at(-1)).toMatchObject({ code: FAST_CHECKPOINT_PERSIST_FAILED, outcome: "failed" });
  expect(JSON.stringify(records)).not.toContain("private persistence detail");
});

test("append-then-throw restores the active leaf and cannot enable premium fast mode", async () => {
  const manager = SessionManager.inMemory();
  manager.appendMessage({ role: "user", content: "before", timestamp: 1 });
  const priorLeaf = manager.getLeafId();
  const model = getModel("openai", "gpt-5.3-codex")!;
  const h = harness(model, {
    mode: "print",
    accept: true,
    sessionManager: manager,
    appendEntry(type, data) {
      manager.appendCustomEntry(type, data);
      throw new Error("private persistence detail");
    },
  });
  await h.command.handler("on", h.ctx);
  expect(manager.getLeafId()).toBe(priorLeaf);
  expect(h.registration.currentSetting(h.ctx)).toBeUndefined();
  expect(manager.getBranch().some((entry: any) => entry.customType === NATIVE_FAST_ENTRY)).toBe(false);
  expect(JSON.stringify(h.notices)).not.toContain("private persistence detail");
});

test("append-then-throw while opting out keeps prior premium consent unusable", async () => {
  const manager = SessionManager.inMemory();
  const model = getModel("openai", "gpt-5.3-codex")!;
  manager.appendCustomEntry(NATIVE_FAST_ENTRY, {
    version: 2,
    oauth: false,
    sessionId: manager.getSessionId(),
    provider: model.provider,
    model: model.id,
    enabled: true,
    costAcknowledged: true,
    timestamp: 1,
  });
  const priorLeaf = manager.getLeafId();
  let failWrite = true;
  const h = harness(model, {
    mode: "print",
    accept: true,
    sessionManager: manager,
    appendEntry(type, data) {
      manager.appendCustomEntry(type, data);
      if (failWrite) throw new Error("disk");
    },
  });
  await h.command.handler("off", h.ctx);
  expect(manager.getLeafId()).toBe(priorLeaf);
  expect(h.registration.currentSetting(h.ctx)).toMatchObject({ enabled: false, costAcknowledged: false });
  failWrite = false;
  await h.command.handler("on", h.ctx);
  expect(h.registration.currentSetting(h.ctx)).toMatchObject({ enabled: true, costAcknowledged: true });
});

// All three failure paths use this same best-effort view restoration.
test("leaf restoration preserves absent, empty and branched views without masking failure", () => {
  const restored: Array<string | null> = [];
  const manager = { resetLeaf: () => restored.push(null), branch: (id: string) => restored.push(id) } as any;
  restoreLeaf(manager, undefined);
  expect(restored).toEqual([]);
  restoreLeaf(manager, null);
  restoreLeaf(manager, "prior-leaf");
  expect(restored).toEqual([null, "prior-leaf"]);
  expect(() => restoreLeaf({} as any, "prior-leaf")).not.toThrow();
  const broken = {
    resetLeaf() {
      throw new Error("reset failed");
    },
    branch() {
      throw new Error("branch failed");
    },
  } as any;
  expect(() => restoreLeaf(broken, null)).not.toThrow();
  expect(() => restoreLeaf(broken, "prior-leaf")).not.toThrow();
});

test("fast status reports selection regardless of returned tier, like official Codex", async () => {
  for (const provider of ["openai", "openai-codex"] as const) {
    const model =
      provider === "openai" ? getModel("openai", "gpt-5.3-codex")! : getModel("openai-codex", "gpt-5.6-luna")!;
    const h = harness(model, { mode: "print", accept: true });
    await h.command.handler("on", h.ctx);
    expect(h.statuses.at(-1).value).toBe(" fast on");
    for (const responseTier of ["priority", "fast", "default", "flex", "auto", "unknown", null]) {
      const body = await wirePayload(h, model, { responseTier });
      expect(body.service_tier).toBe("priority");
      expect(h.statuses.at(-1).value).toBe(" fast on");
    }
    await h.command.handler("status", h.ctx);
    expect(h.notices.at(-1).message).toContain("fast on");
    await h.command.handler("off", h.ctx);
    expect((await wirePayload(h, model)).service_tier).toBe("default");
    expect(h.statuses.at(-1).value).toBe(" fast off");
  }
});

test("fast leaves raw response-tier events available to existing observers", async () => {
  const model = getModel("openai-codex", "gpt-5.6-luna")!;
  const h = harness(model, { mode: "print", accept: true });
  await h.command.handler("on", h.ctx);
  const completed: string[] = [];
  await wirePayload(h, model, {
    responseTier: "default",
    onProviderStreamEvent(event) {
      if (event.type === "response.completed") completed.push(event.response.service_tier);
    },
  });
  expect(completed).toEqual(["default"]);
  expect(h.statuses.at(-1).value).toBe(" fast on");
});

test("host, command and inherited Fast selections publish the same model-bound consent", async () => {
  const savedFast = process.env[NATIVE_FAST_CHILD_ENV];
  const savedDepth = process.env.BRUV_SUBAGENT_DEPTH;
  try {
    const model = getModel("openai-codex", "gpt-5.6-luna")!;
    const host = harness(model);
    await host.emit("model_select");
    host.registration.setWithCostConsent(true);
    const command = harness(model, { mode: "print", accept: true });
    await command.command.handler("on", command.ctx);
    process.env[NATIVE_FAST_CHILD_ENV] = "1";
    process.env.BRUV_SUBAGENT_DEPTH = "1";
    const child = harness(model);
    await child.emit("session_start");
    const expected = {
      version: 2,
      oauth: true,
      sessionId: "session-a",
      provider: model.provider,
      model: model.id,
      enabled: true,
      costAcknowledged: true,
      timestamp: expect.any(Number),
    };
    expect(host.entries[0].data).toEqual(expected);
    expect(command.entries[0].data).toEqual(expected);
    expect(child.entries[0].data).toEqual(expected);
    host.registration.setWithCostConsent(false);
    expect(host.registration.currentSetting(host.ctx)).toMatchObject({ enabled: false, costAcknowledged: false });
  } finally {
    if (savedFast === undefined) delete process.env[NATIVE_FAST_CHILD_ENV];
    else process.env[NATIVE_FAST_CHILD_ENV] = savedFast;
    if (savedDepth === undefined) delete process.env.BRUV_SUBAGENT_DEPTH;
    else process.env.BRUV_SUBAGENT_DEPTH = savedDepth;
  }
});

test("host opt-out persistence failure throws but suppresses prior premium consent", async () => {
  const manager = SessionManager.inMemory();
  const model = getModel("openai", "gpt-5.3-codex")!;
  let failWrite = false;
  const h = harness(model, {
    sessionManager: manager,
    appendEntry(type, data) {
      manager.appendCustomEntry(type, data);
      if (failWrite) throw new Error("private persistence detail");
    },
  });
  await h.emit("model_select");
  h.registration.setWithCostConsent(true);
  const priorLeaf = manager.getLeafId();
  failWrite = true;
  expect(() => h.registration.setWithCostConsent(false)).toThrow(
    "Could not persist native fast mode; the requested setting was not activated.",
  );
  expect(manager.getLeafId()).toBe(priorLeaf);
  expect(nativeFastEnabled(h.ctx)).toBe(false);
  expect(h.registration.currentSetting(h.ctx)).toMatchObject({ enabled: false, costAcknowledged: false });
});

test("inherited Fast append failure rolls back, reports startup refusal and is not retried", async () => {
  const savedFast = process.env[NATIVE_FAST_CHILD_ENV];
  const savedDepth = process.env.BRUV_SUBAGENT_DEPTH;
  try {
    process.env[NATIVE_FAST_CHILD_ENV] = "1";
    process.env.BRUV_SUBAGENT_DEPTH = "1";
    const manager = SessionManager.inMemory();
    manager.appendMessage({ role: "user", content: "before", timestamp: 1 });
    const priorLeaf = manager.getLeafId();
    let attempts = 0;
    const h = harness(getModel("openai", "gpt-5.3-codex")!, {
      sessionManager: manager,
      appendEntry(type, data) {
        attempts++;
        manager.appendCustomEntry(type, data);
        throw new Error("private persistence detail");
      },
    });
    await h.emit("session_start");
    expect(manager.getLeafId()).toBe(priorLeaf);
    expect(h.registration.currentSetting(h.ctx)).toBeUndefined();
    expect(h.notices.at(-1)).toMatchObject({ kind: "error" });
    expect(h.statuses.at(-1)).toEqual({ key: "bruv-native-fast", value: undefined });
    expect(inspectDiagnostics(manager).records.at(-1)).toMatchObject({
      code: FAST_CHECKPOINT_PERSIST_FAILED,
      outcome: "failed",
    });
    expect(JSON.stringify(h.notices)).not.toContain("private persistence detail");
    await h.emit("session_start");
    expect(attempts).toBe(1);
  } finally {
    if (savedFast === undefined) delete process.env[NATIVE_FAST_CHILD_ENV];
    else process.env[NATIVE_FAST_CHILD_ENV] = savedFast;
    if (savedDepth === undefined) delete process.env.BRUV_SUBAGENT_DEPTH;
    else process.env.BRUV_SUBAGENT_DEPTH = savedDepth;
  }
});

test("parent fast consent bootstraps a distinct supported child and its descendants", async () => {
  const savedFast = process.env[NATIVE_FAST_CHILD_ENV];
  const savedDepth = process.env.BRUV_SUBAGENT_DEPTH;
  try {
    const model = getModel("openai-codex", "gpt-5.6-luna")!;
    const parent = harness(model, { mode: "print", accept: true });
    expect(nativeFastEnabled(parent.ctx)).toBe(false);
    await parent.command.handler("on", parent.ctx);
    expect(nativeFastEnabled(parent.ctx)).toBe(true);
    process.env[NATIVE_FAST_CHILD_ENV] = "1";
    process.env.BRUV_SUBAGENT_DEPTH = "1";
    const child = harness({ ...model, id: "gpt-6.1-sol" }, { mode: "json", sessionId: "child" });
    await child.emit("session_start");
    expect(child.entries[0].data).toMatchObject({
      sessionId: "child",
      model: "gpt-6.1-sol",
      enabled: true,
      costAcknowledged: true,
    });
    expect((await wirePayload(child)).service_tier).toBe("priority");
    expect(nativeFastEnabled(child.ctx)).toBe(true);
    expect(process.env[NATIVE_FAST_CHILD_ENV]).toBeUndefined();
    await child.command.handler("off", child.ctx);
    await child.emit("session_start");
    expect(nativeFastEnabled(child.ctx)).toBe(false);
    expect((await wirePayload(child)).service_tier).toBe("default");
    await parent.command.handler("off", parent.ctx);
    expect(nativeFastEnabled(parent.ctx)).toBe(false);

    process.env[NATIVE_FAST_CHILD_ENV] = "1";
    const unsupported = harness({ ...model, provider: "anthropic" }, { mode: "json", sessionId: "unsupported" });
    await unsupported.emit("session_start");
    expect(unsupported.entries).toEqual([]);
    process.env[NATIVE_FAST_CHILD_ENV] = "1";
    process.env.BRUV_SUBAGENT_DEPTH = "0";
    const root = harness(model, { mode: "tui" });
    await root.emit("session_start");
    expect(root.entries).toEqual([]);
  } finally {
    if (savedFast === undefined) delete process.env[NATIVE_FAST_CHILD_ENV];
    else process.env[NATIVE_FAST_CHILD_ENV] = savedFast;
    if (savedDepth === undefined) delete process.env.BRUV_SUBAGENT_DEPTH;
    else process.env.BRUV_SUBAGENT_DEPTH = savedDepth;
  }
});

test("an in-flight fast response cannot turn an explicit opt-out back on", async () => {
  const model = getModel("openai-codex", "gpt-5.6-luna")!;
  const h = harness(model, { mode: "print", accept: true });
  await h.command.handler("on", h.ctx);
  const body = await wirePayload(h, model, {
    onPayload: async (payload) => {
      await h.command.handler("off", h.ctx);
      return payload;
    },
  });
  expect(body.service_tier).toBe("priority");
  expect(h.statuses.at(-1).value).toBe(" fast off");
});

test("disabled fast inheritance leaves model routing and auth untouched", () => {
  const model = {
    provider: "fixture",
    id: "parent",
    get baseUrl() {
      throw new Error("routing must not be inspected");
    },
  };
  const h = harness(model);
  h.ctx.modelRegistry.isUsingOAuth = () => {
    throw new Error("auth must not be inspected");
  };
  expect(nativeFastEnabled(h.ctx)).toBe(false);
  h.entries.push({
    type: "custom",
    customType: NATIVE_FAST_ENTRY,
    data: {
      version: 2,
      oauth: false,
      sessionId: "session-a",
      provider: model.provider,
      model: model.id,
      enabled: false,
      costAcknowledged: false,
      timestamp: 1,
    },
  });
  expect(nativeFastEnabled(h.ctx)).toBe(false);
  h.entries[0].data.enabled = true;
  expect(nativeFastEnabled(h.ctx)).toBe(false);
});

for (const oauth of [false, true]) {
  test(
    "canonical OpenAI " + (oauth ? "ChatGPT login" : "API key") + " uses priority Responses and standard compaction",
    async () => {
      const credentials = AuthStorage.inMemory({
        openai: oauth
          ? { type: "oauth", access: CODEX_TOKEN, refresh: "offline-refresh", expires: Date.now() + 3_600_000 }
          : { type: "api_key", key: "sk-offline-key" },
      });
      const runtime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
      const registry = new ModelRegistry(runtime);
      const model = registry.find("openai", "gpt-5.3-codex")!;
      expect(model.api).toBe("openai-responses");
      expect(model.baseUrl).toBe("https://api.openai.com/v1");
      expect(registry.isUsingOAuth(model)).toBe(oauth);
      const h = harness(model, { mode: "print", accept: true });
      h.ctx.modelRegistry = registry;
      let body: any;
      let calls = 0;
      const request = () =>
        runtime
          .streamSimple(
            model,
            {
              systemPrompt: "keep-system",
              messages: [{ role: "user", content: "hi", timestamp: 1 }],
              tools: [{ name: "lookup", description: "Look up", parameters: { type: "object", properties: {} } }],
            },
            {
              sessionId: "session-a",
              maxTokens: 100,
              temperature: 0.5,
              fetch: (async (url: any, init: any) => {
                calls++;
                expect(String(url)).toBe("https://api.openai.com/v1/responses");
                const headers = new Headers(init.headers);
                expect(headers.get("authorization")).toBe("Bearer " + (oauth ? CODEX_TOKEN : "sk-offline-key"));
                expect(headers.has("chatgpt-account-id")).toBe(false);
                body = JSON.parse(init.body);
                return sse(body.service_tier);
              }) as typeof fetch,
            },
          )
          .result();
      try {
        await h.command.handler("on", h.ctx);
        expect(h.entries.at(-1).data).toMatchObject({ version: 2, oauth, enabled: true, costAcknowledged: true });
        expect(nativeFastEnabled(h.ctx)).toBe(true);
        const response = await request();
        expect(response.stopReason).toBe("stop");
        expect(body.service_tier).toBe("priority");
        expect(body.input).toContainEqual({ role: "developer", content: "keep-system" });
        expect(body.tools).toMatchObject([{ type: "function", name: "lookup" }]);
        expect(body.max_output_tokens).toBe(oauth ? undefined : 100);
        expect(body.temperature).toBe(oauth ? undefined : 0.5);
        // Pi still returns token-catalog estimates on subscription auth, not account credits.
        expect(response.usage.cost.total).toBeCloseTo(((4 * model.cost.input + model.cost.output) / 1_000_000) * 2, 12);
        await withStandardProviderTier(request);
        expect(body.service_tier).toBe("default");
        expect(nativeFastEnabled(h.ctx)).toBe(true);
        await h.command.handler("off", h.ctx);
        await request();
        expect(body.service_tier).toBe("default");
        expect(nativeFastEnabled(h.ctx)).toBe(false);
        expect(calls).toBe(3);
      } finally {
        await h.emit("session_shutdown");
      }
    },
  );

  test("canonical consent wording identifies " + (oauth ? "ChatGPT subscription" : "API pricing"), async () => {
    const h = harness(getModel("openai", "gpt-5.3-codex")!, { oauth });
    let prompt = "";
    h.ctx.ui.confirm = async (_title: string, text: string) => {
      prompt = text;
      return true;
    };
    await h.command.handler("on", h.ctx);
    expect(prompt).toContain(oauth ? "premium ChatGPT subscription usage/credits" : "premium API token pricing");
    expect(prompt).not.toContain(oauth ? "API token pricing" : "ChatGPT");
    expect(prompt).toContain("new supported subagents");
    expect(prompt).toContain("Provider billing is authoritative");
  });

  test(
    "canonical auth change during confirmation refuses " + (oauth ? "subscription" : "API") + " consent",
    async () => {
      const h = harness(getModel("openai", "gpt-5.3-codex")!, { oauth });
      h.ctx.ui.confirm = async () => {
        h.runtime.isUsingOAuth = () => !oauth;
        return true;
      };
      await h.command.handler("on", h.ctx);
      expect(h.entries).toEqual([]);
      expect(h.notices.at(-1).message).toContain("authentication surface changed");
      expect(nativeFastEnabled(h.ctx)).toBe(false);
    },
  );

  test(
    "canonical resolved credential overrides cannot change " + (oauth ? "subscription" : "API") + " billing consent",
    async () => {
      const h = harness(getModel("openai", "gpt-5.3-codex")!, { oauth, mode: "print", accept: true });
      await h.command.handler("on", h.ctx);
      expect(await wirePayload(h, h.ctx.model, { apiKey: oauth ? "sk-override-key" : CODEX_TOKEN })).toBeUndefined();
      expect(inspectDiagnostics(h.ctx.sessionManager).records.at(-1)).toMatchObject({
        code: "identity_stale",
        outcome: "blocked",
        dispatch: "none",
      });
      expect(
        await wirePayload(h, h.ctx.model, {
          headers: { Authorization: "Bearer " + (oauth ? "sk-override-key" : CODEX_TOKEN) },
        }),
      ).toBeUndefined();
      expect(
        await wirePayload(h, { ...h.ctx.model, headers: { authorization: "Bearer other-account" } }),
      ).toBeUndefined();
      expect((await wirePayload(h)).service_tier).toBe("priority");
      h.runtime.isUsingOAuth = () => !oauth;
      expect(nativeFastEnabled(h.ctx)).toBe(false);
      expect(await wirePayload(h)).toBeUndefined();
      await h.command.handler("on", h.ctx);
      expect(h.entries.at(-1).data.oauth).toBe(!oauth);
      expect((await wirePayload(h)).service_tier).toBe("priority");
    },
  );
}

test("unbound pre-upgrade consent fails closed and can be explicitly renewed", async () => {
  const model = getModel("openai", "gpt-5.3-codex")!;
  const h = harness(model, { oauth: true, mode: "print", accept: true });
  h.entries.push({
    type: "custom",
    customType: NATIVE_FAST_ENTRY,
    data: {
      version: 1,
      sessionId: "session-a",
      provider: model.provider,
      model: model.id,
      enabled: true,
      costAcknowledged: true,
      timestamp: 1,
    },
  });
  expect(nativeFastEnabled(h.ctx)).toBe(false);
  await h.emit("session_start");
  expect(await wirePayload(h)).toBeUndefined();
  await h.command.handler("on", h.ctx);
  expect((await wirePayload(h)).service_tier).toBe("priority");
});

test("new ChatGPT OAuth inheritance authorizes the child's own session and billing surface", async () => {
  const savedFast = process.env[NATIVE_FAST_CHILD_ENV];
  const savedDepth = process.env.BRUV_SUBAGENT_DEPTH;
  try {
    const model = getModel("openai", "gpt-5.3-codex")!;
    const parent = harness(model, { mode: "print", accept: true });
    await parent.command.handler("on", parent.ctx);
    process.env[NATIVE_FAST_CHILD_ENV] = nativeFastEnabled(parent.ctx) ? "1" : "0";
    process.env.BRUV_SUBAGENT_DEPTH = "1";
    const child = harness(model, { oauth: true, mode: "json", sessionId: "oauth-child" });
    await child.emit("session_start");
    expect(child.entries[0].data).toMatchObject({
      version: 2,
      sessionId: "oauth-child",
      oauth: true,
      enabled: true,
      costAcknowledged: true,
    });
    expect(nativeFastEnabled(child.ctx)).toBe(true);
    expect((await wirePayload(child)).service_tier).toBe("priority");
    expect(await wirePayload(child, model, { sessionId: "session-a" })).not.toHaveProperty("service_tier");
    await child.command.handler("off", child.ctx);
    expect((await wirePayload(child)).service_tier).toBe("default");
    expect(nativeFastEnabled(parent.ctx)).toBe(true);
    process.env[NATIVE_FAST_CHILD_ENV] = "1";
    process.env.BRUV_SUBAGENT_DEPTH = "0";
    const root = harness(model, { oauth: true });
    await root.emit("session_start");
    expect(root.entries).toEqual([]);
  } finally {
    if (savedFast === undefined) delete process.env[NATIVE_FAST_CHILD_ENV];
    else process.env[NATIVE_FAST_CHILD_ENV] = savedFast;
    if (savedDepth === undefined) delete process.env.BRUV_SUBAGENT_DEPTH;
    else process.env.BRUV_SUBAGENT_DEPTH = savedDepth;
  }
});

test("canonical OAuth guards reject resolved proxy endpoints, including official-looking trailing slash", async () => {
  const runtime = await ModelRuntime.create({
    credentials: AuthStorage.inMemory({
      openai: { type: "oauth", access: CODEX_TOKEN, refresh: "offline-refresh", expires: Date.now() + 3_600_000 },
    }),
    modelsPath: null,
    allowModelNetwork: false,
  });
  const registry = new ModelRegistry(runtime);
  const model = registry.find("openai", "gpt-5.3-codex")!;
  const h = harness(model, { mode: "print", accept: true });
  h.ctx.modelRegistry = registry;
  await h.command.handler("on", h.ctx);
  let calls = 0;
  try {
    for (const baseUrl of ["https://proxy.example/v1", "https://api.openai.com/v1/"]) {
      runtime.getAuth = (async () => ({ auth: { apiKey: CODEX_TOKEN, baseUrl } })) as any;
      const response = await runtime
        .streamSimple(
          model,
          { messages: [{ role: "user", content: "hi", timestamp: 1 }] },
          {
            sessionId: "session-a",
            fetch: (async (_url: any, _init: any) => {
              calls++;
              return sse("priority");
            }) as typeof fetch,
          },
        )
        .result();
      expect(response.stopReason).toBe("error");
      expect(response.errorMessage).toContain("endpoint is not authorized");
    }
    expect(calls).toBe(0);
  } finally {
    await h.emit("session_shutdown");
  }
});
