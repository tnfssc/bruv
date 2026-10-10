import { describe, expect, test } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { inspectDiagnostics } from "../../src/diagnostics";
import {
  isCacheAffineProviderPayload,
  isUsableSummaryResponse,
  registerCacheAffineCompaction,
} from "../../src/agent/cache-affine-compaction";
import {
  bindInstructionContinuitySession,
  clearInstructionContinuity,
  scopeInstructionContinuity,
  setCurrentInstructionFrame,
} from "../../src/agent/instruction-continuity";

function wireProvider(ctx: any, pi: any, transformContext?: (messages: any[]) => any[]) {
  if (!ctx.modelRegistry) return;
  bindInstructionContinuitySession({
    sessionManager: ctx.sessionManager,
    agent: {
      state: { systemPrompt: ctx.getSystemPrompt(), tools: pi.getAllTools() },
      convertToLlm,
      transformContext,
      streamFunction: (m: any, c: any, o: any) => ({ result: () => ctx.modelRegistry.completeSimple(m, c, o) }),
    },
  } as any);
}

const usage = {
  input: 10,
  output: 2,
  cacheRead: 8,
  cacheWrite: 0,
  totalTokens: 20,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const model = {
  id: "m",
  name: "M",
  provider: "p",
  api: "openai-responses",
  reasoning: true,
  input: ["text"],
  cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
  contextWindow: 100_000,
  maxTokens: 8_192,
} as any;
const user = (text: string) => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 }) as any;
const assistant = (text: string) =>
  ({
    role: "assistant",
    api: "openai-responses",
    provider: "p",
    model: "m",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage,
    timestamp: 2,
  }) as any;
const entries = [
  { type: "message", id: "1", parentId: null, timestamp: "2026-01-01", message: user("old-user") },
  { type: "message", id: "2", parentId: "1", timestamp: "2026-01-01", message: assistant("old-assistant") },
  { type: "message", id: "3", parentId: "2", timestamp: "2026-01-01", message: user("tail-user") },
  { type: "message", id: "4", parentId: "3", timestamp: "2026-01-01", message: assistant("tail-assistant") },
] as any[];

function event(overrides: any = {}) {
  return {
    type: "session_before_compact",
    branchEntries: entries,
    reason: "threshold",
    willRetry: false,
    signal: new AbortController().signal,
    preparation: {
      firstKeptEntryId: "3",
      messagesToSummarize: [entries[0].message, entries[1].message],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 1_000,
      previousSummary: undefined,
      fileOps: { read: new Set(["read.ts"]), written: new Set(["write.ts"]), edited: new Set() },
      settings: { enabled: true, reserveTokens: 8_192, keepRecentTokens: 2_000 },
    },
    ...overrides,
  } as any;
}

const tools = [{ name: "execute", description: "run", parameters: { type: "object" } }];

// Exercise the shipped preparation and dispatch path, not a captured-prefix model.
async function currentRequest(compactEvent = event(), options: any = {}) {
  const handlers = new Map<string, Function>();
  let request: any;
  const pi = {
    on: (name: string, fn: Function) => handlers.set(name, fn),
    getActiveTools: () => ["execute"],
    getAllTools: () => tools,
  } as any;
  registerCacheAffineCompaction(pi);
  const ctx = {
    model: options.model ?? model,
    thinkingLevel: "high",
    getSystemPrompt: () => options.systemPrompt ?? "actual post-hook system",
    sessionManager: { getSessionId: () => "stable-session" },
    modelRegistry: {
      completeSimple: async (_model: any, context: any, streamOptions: any) => {
        request = { messages: context.messages, outputTokens: streamOptions.maxTokens };
        await streamOptions.onPayload({ input: [] });
        return assistant("## Goal\nContinue");
      },
    },
  } as any;
  wireProvider(
    ctx,
    pi,
    options.transform ??
      ((messages: any[]) => {
        const firstUser = messages.find((message) => message.role === "user");
        if (firstUser) firstUser.content = [{ type: "text", text: "HOOKED-old-user" }];
        return messages;
      }),
  );
  await handlers.get("context")!({ messages: [] }, ctx);
  const result = await handlers.get("session_before_compact")!(compactEvent, ctx);
  if (!request) expect(result).toEqual({ cancel: true });
  return request;
}

describe("cache-affine compaction request", () => {
  test("preserves the exact fully transformed context, system, and tools", async () => {
    const request = await currentRequest();
    expect(request.messages[0]).toMatchObject({
      role: "system",
      content: "actual post-hook system",
      toolsAdded: tools,
    });
    expect((request.messages[1] as any).content[0].text).toBe("HOOKED-old-user");
    expect((request.messages[3] as any).content[0].text).toBe("tail-user");
    expect((request.messages[4] as any).content[0].text).toBe("tail-assistant");
    expect((request.messages.at(-1) as any).content[0].text).toContain("Summarize whole conversation above.");
  });

  test("counts the transcript system/tool frame once in the compaction input budget", async () => {
    // Make the context ceiling bind: a double-charged frame cannot fit.
    const request = await currentRequest(event(), {
      systemPrompt: "frame ".repeat(4000),
      model: { ...model, contextWindow: 13_000 },
    });
    expect(request).toBeDefined();
    expect(request.outputTokens).toBeGreaterThan(5000);
    expect(request.outputTokens).toBeLessThan(6500);
    expect(request.messages.filter((message: any) => message.role === "system")).toHaveLength(1);
  });

  test("summarizes the whole current conversation regardless of Pi's replay boundary", async () => {
    const request = await currentRequest(
      event({
        preparation: {
          ...event().preparation,
          messagesToSummarize: [],
          turnPrefixMessages: [entries[0].message, entries[1].message],
          isSplitTurn: true,
        },
      }),
    );
    const prompt = (request.messages.at(-1) as any).content[0].text;
    expect(prompt).toContain("Summarize whole conversation above.");
    expect(prompt).not.toContain("retained tail");
    expect(request).not.toHaveProperty("summaryEnd");
    expect(request).not.toHaveProperty("tailStart");
    expect(request).not.toHaveProperty("summaryScope");
  });

  test("prepares current tool results and boundary-changing redaction", async () => {
    const toolResult = {
      role: "toolResult",
      toolCallId: "call",
      toolName: "execute",
      content: [{ type: "text", text: "current-result" }],
      isError: false,
      timestamp: 3,
    };
    const branchEntries = [
      ...entries,
      {
        type: "message",
        id: "5",
        parentId: "4",
        timestamp: "2026-01-01",
        message: {
          ...assistant(""),
          content: [{ type: "toolCall", id: "call", name: "execute", arguments: {} }],
          stopReason: "toolUse",
        },
      },
      { type: "message", id: "6", parentId: "5", timestamp: "2026-01-01", message: toolResult },
    ];
    const request = await currentRequest(event({ branchEntries }), {
      transform: (messages: any[]) => messages.filter((message) => message.role !== "user"),
    });
    expect(JSON.stringify(request.messages)).not.toContain("old-user");
    expect(JSON.stringify(request.messages)).toContain("current-result");
    expect(request.messages.filter((message: any) => message.role === "user")).toHaveLength(1);
  });

  test("keeps the replay tail in the model-facing history being summarized", async () => {
    const request = await currentRequest();
    expect((request.messages[3] as any).content[0].text).toBe("tail-user");
    expect((request.messages[4] as any).content[0].text).toBe("tail-assistant");
    expect((request.messages.at(-1) as any).content[0].text).toContain("whole conversation above");
  });

  test("does not insert raw retained content into the summary instruction", async () => {
    const request = await currentRequest();
    const serialized = JSON.stringify(request.messages);
    expect(serialized.split("tail-user")).toHaveLength(2);
    expect(serialized).not.toContain("retained-tail anchor");
  });

  test("charges transformed-prefix growth against the context window", async () => {
    expect(
      await currentRequest(event(), {
        model: { ...model, contextWindow: 12_000 },
        transform: (messages: any[]) => {
          messages.find((message) => message.role === "user").content = [{ type: "text", text: "x".repeat(40_000) }];
          return messages;
        },
      }),
    ).toBeUndefined();
  });

  test("cancels before dispatch when the summary reserve is too small", async () => {
    expect(
      await currentRequest(
        event({
          preparation: { ...event().preparation, settings: { ...event().preparation.settings, reserveTokens: 1024 } },
        }),
      ),
    ).toBeUndefined();
  });

  test("cancels rather than sending an overflowing fork", async () => {
    const overflow = event({ reason: "overflow", preparation: { ...event().preparation, tokensBefore: 99_000 } });
    expect(await currentRequest(overflow)).toBeUndefined();
  });
});

describe("provider serialization guard", () => {
  test("requires the entire old native wire sequence and cache-affecting fields", () => {
    const old = {
      instructions: "s",
      input: [{ type: "message", id: "1" }],
      tools: [{ name: "execute" }],
      reasoning: { effort: "high" },
      prompt_cache_key: "sid",
    };
    expect(isCacheAffineProviderPayload(old, { ...old, input: [...old.input, { type: "message", id: "2" }] })).toBe(
      true,
    );
    expect(
      isCacheAffineProviderPayload(old, {
        ...old,
        input: [
          { type: "message", id: "changed" },
          { type: "message", id: "2" },
        ],
      }),
    ).toBe(false);
    expect(isCacheAffineProviderPayload(old, { ...old, prompt_cache_key: "new", input: [...old.input, {}] })).toBe(
      false,
    );
    expect(
      isCacheAffineProviderPayload(old, { ...old, unknown_provider_option: true, input: [...old.input, {}] }),
    ).toBe(false);
    expect(isCacheAffineProviderPayload(old, { ...old, max_output_tokens: 2048, input: [...old.input, {}] })).toBe(
      true,
    );
  });

  test("accepts Anthropic cache marker relocation while preserving policy", () => {
    const policy = { type: "ephemeral", ttl: "1h" };
    const old = {
      model: "claude",
      messages: [
        { role: "user", content: [{ type: "text", text: "old", cache_control: policy }] },
        { role: "assistant", content: [{ type: "text", text: "answer" }] },
      ],
      system: [{ type: "text", text: "s", cache_control: policy }],
    };
    const candidate: any = {
      ...old,
      messages: [
        { role: "user", content: [{ type: "text", text: "old" }] },
        old.messages[1],
        { role: "user", content: [{ type: "text", text: "summarize", cache_control: policy }] },
      ],
    };
    expect(isCacheAffineProviderPayload(old, candidate)).toBe(true);
    const changed = structuredClone(candidate);
    changed.messages[2].content[0].cache_control = { type: "ephemeral", ttl: "5m" };
    expect(isCacheAffineProviderPayload(old, changed)).toBe(false);
    const dropped = structuredClone(candidate);
    delete dropped.messages[2].content[0].cache_control;
    expect(isCacheAffineProviderPayload(old, dropped)).toBe(false);
  });
});

describe("summary validation", () => {
  const response = (stopReason: string, content: any[]): AssistantMessage =>
    ({
      role: "assistant",
      api: "openai-responses",
      provider: "p",
      model: "m",
      timestamp: 1,
      usage,
      stopReason,
      content,
    }) as any;
  test("accepts text and rejects errors, cancellation, length and tool calls", () => {
    expect(isUsableSummaryResponse(response("stop", [{ type: "text", text: "summary" }]))).toBe(true);
    expect(isUsableSummaryResponse(response("error", [{ type: "text", text: "x" }]))).toBe(false);
    expect(isUsableSummaryResponse(response("aborted", []))).toBe(false);
    expect(isUsableSummaryResponse(response("length", [{ type: "text", text: "partial" }]))).toBe(false);
    expect(
      isUsableSummaryResponse(response("toolUse", [{ type: "toolCall", id: "x", name: "execute", arguments: {} }])),
    ).toBe(false);
  });
});

describe("extension lifecycle", () => {
  test("passes model/thinking/session identity, never executes tools, and returns usage checkpoint", async () => {
    const handlers = new Map<string, Function>();
    let captured: any;
    const pi = {
      on: (name: string, fn: Function) => handlers.set(name, fn),
      getActiveTools: () => ["execute"],
      getAllTools: () => [{ name: "execute", description: "run", parameters: { type: "object" }, sourceInfo: {} }],
    } as any;
    registerCacheAffineCompaction(pi, () => [{ id: "task_fixture", kind: "command", status: "running" }]);
    const ctx = {
      model,
      thinkingLevel: "high",
      getSystemPrompt: () => "actual post-hook system",
      sessionManager: { getLeafId: () => "4", getSessionId: () => "stable-session" },
      modelRegistry: {
        completeSimple: async (m: any, context: any, options: any) => {
          captured = { m, context, options };
          options.onPayload({
            instructions: "actual post-hook system",
            input: [
              { role: "user", content: "old" },
              { role: "assistant", content: "new" },
            ],
            tools: [{ name: "execute" }],
            reasoning: { effort: "high" },
            prompt_cache_key: "stable-session",
            metadata: { current: true },
          });
          return {
            role: "assistant",
            api: model.api,
            provider: "p",
            model: "m",
            timestamp: 1,
            stopReason: "stop",
            usage,
            content: [{ type: "text", text: "## Goal\nContinue" }],
          };
        },
      },
    } as any;
    wireProvider(ctx, pi);
    await handlers.get("context")!({ messages: entries.map((entry) => entry.message) }, ctx);
    await handlers.get("before_provider_request")!(
      {
        payload: {
          instructions: "actual post-hook system",
          input: [{ role: "user", content: "old" }],
          tools: [{ name: "execute" }],
          reasoning: { effort: "high" },
          prompt_cache_key: "stable-session",
        },
      },
      ctx,
    );
    const result = await handlers.get("session_before_compact")!(event(), ctx);
    expect(captured.options).toMatchObject({ sessionId: "stable-session", reasoning: "high" });
    expect(captured.context.messages[0].toolsAdded.map((tool: any) => tool.name)).toEqual(["execute"]);
    expect(result.compaction.usage.cacheRead).toBe(8);
    expect(result.compaction.summary).toContain("task_fixture: command, running");
    expect(result.compaction.firstKeptEntryId).toBe("3");
    expect(result.compaction.details).toMatchObject({
      strategy: "cache-affine-plaintext",
      version: 5,
      priorPayloadAffine: false,
    });
    expect(result.compaction.details).not.toHaveProperty("summaryEnd");
    expect(result.compaction.details).not.toHaveProperty("tailStart");
    expect(result.compaction.details).not.toHaveProperty("summaryScope");
  });

  test("makes unavailable preparation observable without flattening raw history", async () => {
    const handlers = new Map<string, Function>();
    const notices: string[] = [];
    const pi = {
      on: (n: string, f: Function) => handlers.set(n, f),
      getActiveTools: () => [],
      getAllTools: () => [],
    } as any;
    registerCacheAffineCompaction(pi);
    const ctx = {
      model,
      thinkingLevel: "high",
      getSystemPrompt: () => "s",
      ui: { notify: (message: string) => notices.push(message) },
      sessionManager: { getLeafId: () => "2", getSessionId: () => "stable-session" },
    } as any;
    wireProvider(ctx, pi);
    await handlers.get("context")!({ messages: entries.slice(0, 2).map((entry) => entry.message) }, ctx);
    await handlers.get("before_provider_request")!({ payload: { input: [{}] } }, ctx);
    expect(await handlers.get("session_before_compact")!(event(), ctx)).toEqual({ cancel: true });
    expect(notices[0]).toContain("this Pi runtime has no current-context preparation seam");
    expect(inspectDiagnostics(ctx.sessionManager).records.at(-1)).toMatchObject({
      code: "preparation_failed",
      outcome: "blocked",
      dispatch: "none",
    });
  });

  test("provider errors and aborts cancel without alternate inference", async () => {
    const handlers = new Map<string, Function>();
    const pi = {
      on: (n: string, f: Function) => handlers.set(n, f),
      getActiveTools: () => [],
      getAllTools: () => [],
    } as any;
    registerCacheAffineCompaction(pi);
    const ctx = {
      model,
      thinkingLevel: "high",
      getSystemPrompt: () => "s",
      sessionManager: { getLeafId: () => "4", getSessionId: () => "stable-session" },
      modelRegistry: {
        completeSimple: async () => {
          throw new Error("offline");
        },
      },
    } as any;
    wireProvider(ctx, pi);
    await handlers.get("context")!({ messages: entries.map((entry) => entry.message) }, ctx);
    await handlers.get("before_provider_request")!({ payload: { input: [{ role: "user", content: "old" }] } }, ctx);
    expect(await handlers.get("session_before_compact")!(event(), ctx)).toEqual({ cancel: true });
    expect(inspectDiagnostics(ctx.sessionManager).records.at(-1)).toMatchObject({
      code: "provider_failed",
      outcome: "failed",
      dispatch: "none",
    });
    const controller = new AbortController();
    controller.abort();
    expect(await handlers.get("session_before_compact")!(event({ signal: controller.signal }), ctx)).toEqual({
      cancel: true,
    });
    expect(inspectDiagnostics(ctx.sessionManager).records.at(-1)).toMatchObject({
      code: "caller_aborted",
      outcome: "cancelled",
      dispatch: "none",
      cancellation: "caller",
    });
  });
});

test("provider guard never treats tool-input cache_control keys as cache metadata", () => {
  const before = {
    messages: [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t", name: "execute", input: { cache_control: { type: "ephemeral" } } }],
      },
    ],
  };
  const after = {
    messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "t", name: "execute", input: {} }] },
      { role: "user", content: [{ type: "text", text: "summary", cache_control: { type: "ephemeral" } }] },
    ],
  };
  expect(isCacheAffineProviderPayload(before, after)).toBe(false);
});

test("absent or blank custom focus adds no footer", async () => {
  for (const focus of [undefined, "", "   "]) {
    const request = await currentRequest(event({ customInstructions: focus }));
    const prompt = (request.messages.at(-1) as any).content[0].text;
    expect(prompt).not.toContain("User focus:");
    expect(prompt).not.toContain("No additional focus was requested");
    expect(prompt).not.toContain("{{customInstructions}}");
    expect(prompt).toEndWith("Summary only. No tools or task work.");
  }
});

test("summary focus is literal data without boundary disclaimers", async () => {
  const request = await currentRequest(event({ customInstructions: "Preserve $& and {{tailAnchor}} literally" }));
  const prompt = (request.messages.at(-1) as any).content[0].text;
  expect(prompt).toContain("User focus: Preserve $& and {{tailAnchor}} literally");
  expect(prompt).not.toContain("durable checkpoint boundary");
  expect(prompt).not.toContain("{{customInstructions}}");
});

describe("instruction frame ownership lifecycle", () => {
  const manager = (initial: string) => {
    let id = initial;
    return {
      getSessionId: () => id,
      switchTo: (next: string) => {
        id = next;
      },
    };
  };

  test("independent managers sharing one persisted id never share ownership", () => {
    const first = manager("persisted-id");
    const second = manager("persisted-id");
    scopeInstructionContinuity(first);
    scopeInstructionContinuity(second);
    expect(setCurrentInstructionFrame(first, "first-frame")).toBe(true);
    expect(setCurrentInstructionFrame(second, "second-frame")).toBe(true);
    clearInstructionContinuity(first);
    expect(setCurrentInstructionFrame(first, "leak")).toBe(false);
    expect(setCurrentInstructionFrame(second, "still-owned")).toBe(true);
    clearInstructionContinuity(second);
  });

  test("shutdown/reload/new clearing and in-place session switches cannot revive a frame", () => {
    const owner = manager("old-session");
    for (const lifecycle of ["shutdown", "reload", "new"] as const) {
      scopeInstructionContinuity(owner);
      expect(setCurrentInstructionFrame(owner, lifecycle + "-frame")).toBe(true);
      clearInstructionContinuity(owner);
      expect(setCurrentInstructionFrame(owner, "stale")).toBe(false);
    }
    scopeInstructionContinuity(owner);
    expect(setCurrentInstructionFrame(owner, "old-frame")).toBe(true);
    owner.switchTo("new-session");
    expect(setCurrentInstructionFrame(owner, "cross-session-leak")).toBe(false);
    owner.switchTo("old-session");
    expect(setCurrentInstructionFrame(owner, "revived-frame")).toBe(false);
  });
});

function summaryAttemptHarness(
  complete: (options: any) => Promise<any>,
  pendingJobs: () => readonly { id: string; kind: string; status: string }[] = () => [],
) {
  const handlers = new Map<string, Function>();
  const attempts: any[] = [];
  const notices: string[] = [];
  let requests = 0;
  const pi = {
    on: (name: string, handler: Function) => handlers.set(name, handler),
    getActiveTools: () => [],
    getAllTools: () => [],
    appendEntry: (type: string, data: unknown) => attempts.push({ type, data }),
  } as any;
  registerCacheAffineCompaction(pi, pendingJobs);
  const ctx = {
    model,
    thinkingLevel: "high",
    getSystemPrompt: () => "s",
    sessionManager: { getSessionId: () => "stable-session" },
    ui: { notify: (message: string) => notices.push(message) },
    modelRegistry: {
      completeSimple: async (_model: any, _context: any, options: any) => {
        requests++;
        return complete(options);
      },
    },
  } as any;
  wireProvider(ctx, pi);
  return {
    compact: async (compactEvent = event()) => {
      await handlers.get("context")!({ messages: [] }, ctx);
      return handlers.get("session_before_compact")!(compactEvent, ctx);
    },
    pi,
    attempts,
    notices,
    ui: ctx.ui,
    diagnostics: () => inspectDiagnostics(ctx.sessionManager).records,
    requests: () => requests,
  };
}

describe("cancelled summary attempts", () => {
  test("a paid unusable response is checkpointed without duplicate inference", async () => {
    const harness = summaryAttemptHarness(async (options) => {
      await options.onPayload({
        input: [
          { role: "user", content: "old" },
          { role: "assistant", content: "new" },
        ],
      });
      return { ...assistant("partial"), stopReason: "length" };
    });
    expect(await harness.compact()).toEqual({ cancel: true });
    expect(harness.requests()).toBe(1);
    expect(harness.notices[0]).toContain("no second model call");
    expect(harness.attempts).toEqual([
      { type: "bruv-compaction-attempt", data: { strategy: "cache-affine-plaintext", stopReason: "length", usage } },
    ]);
  });

  test("a failed paid-usage checkpoint cancels without retrying or exposing the storage error", async () => {
    const harness = summaryAttemptHarness(async (options) => {
      await options.onPayload({
        input: [
          { role: "user", content: "old" },
          { role: "assistant", content: "new" },
        ],
      });
      return { ...assistant("partial"), stopReason: "length" };
    });
    let appendCalls = 0;
    harness.pi.appendEntry = () => {
      appendCalls++;
      throw new Error("private disk failure");
    };
    expect(await harness.compact()).toEqual({ cancel: true });
    expect(harness.requests()).toBe(1);
    expect(appendCalls).toBe(1);
    expect(harness.notices.some((message) => message.includes("Usage checkpoint write failed"))).toBe(true);
    expect(harness.notices.at(-1)).toContain("no second model call");
    expect(JSON.stringify(harness.notices)).not.toContain("private disk failure");
  });

  test("a late abort still attempts the paid-usage checkpoint once even when storage fails", async () => {
    const controller = new AbortController();
    const harness = summaryAttemptHarness(async (options) => {
      await options.onPayload({
        input: [
          { role: "user", content: "old" },
          { role: "assistant", content: "new" },
        ],
      });
      controller.abort();
      return { ...assistant("partial"), stopReason: "length" };
    });
    let appendCalls = 0;
    harness.pi.appendEntry = () => {
      appendCalls++;
      throw new Error("private disk failure");
    };
    expect(await harness.compact(event({ signal: controller.signal }))).toEqual({ cancel: true });
    expect(harness.requests()).toBe(1);
    expect(appendCalls).toBe(1);
  });

  test.each([false, true])(
    "final wire rejection cancels before inference (provider returns error: %s)",
    async (swallow) => {
      const harness = summaryAttemptHarness(async (options) => {
        try {
          await options.onPayload({ max_output_tokens: model.contextWindow });
        } catch (error) {
          if (!swallow) throw error;
        }
        return { ...assistant(""), stopReason: "error", usage: { ...usage, totalTokens: 0 } };
      });
      expect(await harness.compact()).toEqual({ cancel: true });
      expect(harness.requests()).toBe(1);
      expect(harness.attempts).toEqual([]);
      expect(harness.diagnostics().at(-1)).toMatchObject({
        code: "capacity_insufficient",
        dispatch: "none",
        outcome: "blocked",
      });
      expect(harness.notices.at(-1)).toContain("stopped before model call");
    },
  );

  test("an accepted request remains uncertain even if a later payload is rejected", async () => {
    const harness = summaryAttemptHarness(async (options) => {
      await options.onPayload({ max_output_tokens: 8192 });
      await options.onPayload({ max_output_tokens: model.contextWindow });
      throw new Error("unreachable");
    });
    expect(await harness.compact()).toEqual({ cancel: true });
    expect(harness.requests()).toBe(1);
    expect(harness.attempts).toEqual([]);
    expect(harness.diagnostics().at(-1)).toMatchObject({ code: "provider_failed", dispatch: "unknown" });
    expect(harness.notices.at(-1)).toContain("no second model call");
  });

  test("failure to project a paid summary checkpoints usage once without another inference", async () => {
    const harness = summaryAttemptHarness(
      async (options) => {
        await options.onPayload({ max_output_tokens: 8192 });
        return assistant("valid summary");
      },
      () => {
        throw new Error("job observer failed");
      },
    );
    expect(await harness.compact()).toEqual({ cancel: true });
    expect(harness.requests()).toBe(1);
    expect(harness.attempts).toEqual([
      { type: "bruv-compaction-attempt", data: { strategy: "cache-affine-plaintext", stopReason: "stop", usage } },
    ]);
    expect(harness.diagnostics().at(-1)).toMatchObject({ code: "provider_failed", dispatch: "response" });
    expect(harness.notices.at(-1)).toContain("no second model call");
  });

  test("failed notifications do not erase paid-attempt cancellation or retry its usage write", async () => {
    const harness = summaryAttemptHarness(async (options) => {
      await options.onPayload({ max_output_tokens: 8192 });
      return { ...assistant("partial summary"), stopReason: "length" };
    });
    harness.ui.notify = () => {
      throw new Error("notification unavailable");
    };
    expect(await harness.compact()).toEqual({ cancel: true });
    expect(harness.requests()).toBe(1);
    expect(harness.attempts).toHaveLength(1);
    expect(harness.diagnostics().at(-1)).toMatchObject({ code: "response_invalid", dispatch: "response" });
  });
});
