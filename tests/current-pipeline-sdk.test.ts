import { isReadOnlyCompactionContext } from "../src/agent/native-compaction";
import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, getModel, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import * as anthropic from "@earendil-works/pi-ai/api/anthropic-messages";
import {
  ModelRuntime,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { bruvSystemPrompt } from "../src/prompts";
import tasks from "../src/agent/extension";

const sentinel = "offline-compaction-sdk-capture";
const usage = {
  input: 20,
  output: 5,
  cacheRead: 100,
  cacheWrite: 0,
  totalTokens: 125,
  cost: { input: 0.01, output: 0.02, cacheRead: 0.001, cacheWrite: 0, total: 0.031 },
};
// Keep real serializer option mapping and the no-network boundary together.
// Scenario hooks below still own conversation transforms and compaction timing.
function captureOfflineRequests(runtime: ModelRuntime, isCompacting: () => boolean) {
  const captured: any[] = [];
  const attempts: any[] = [];
  let networkCalls = 0;
  function fixture(serializer: any, m: any, context: any, options: any) {
    const output = createAssistantMessageEventStream();
    void (async () => {
      const headers = (await options?.transformHeaders?.(options?.headers ?? {})) ?? options?.headers;
      const observed = await serializer(m, context, {
        ...options,
        headers,
        apiKey: "offline-key",
        transport: "sse",
        fetch: async () => {
          networkCalls++;
          throw Error("unexpected network");
        },
        onPayload: async (payload: any) => {
          attempts.push(structuredClone(payload));
          const result = await options?.onPayload?.(payload, m);
          captured.push({ compacting: isCompacting(), headers, payload: structuredClone(result ?? payload) });
          throw Error(sentinel);
        },
      }).result();
      if (!observed.errorMessage?.includes(sentinel)) {
        output.push({ type: "error", reason: "error", error: observed });
        output.end(observed);
        return;
      }
      const message: AssistantMessage = {
        role: "assistant",
        api: m.api,
        provider: m.provider,
        model: m.id,
        content: [
          {
            type: "text",
            text: isCompacting()
              ? "## Goal\nPreserve fixture state.\n## Critical Context\nfixture-checkpoint"
              : "Fixture acknowledged.",
          },
        ],
        stopReason: "stop",
        usage,
        timestamp: Date.now(),
      };
      output.push({ type: "done", reason: "stop", message });
      output.end(message);
    })().catch((e) => {
      const message: any = {
        role: "assistant",
        api: m.api,
        provider: m.provider,
        model: m.id,
        content: [],
        stopReason: "error",
        errorMessage: String(e),
        usage,
        timestamp: Date.now(),
      };
      output.push({ type: "error", reason: "error", error: message });
      output.end(message);
    });
    return output;
  }
  // Exercise the real simple/native provider option mappings, rather than a
  // mock complete() that accepts options the real serializer would ignore.
  runtime.streamSimple = ((m: any, c: any, o: any) => fixture(anthropic.streamSimple, m, c, o)) as any;
  runtime.stream = ((m: any, c: any, o: any) => fixture(anthropic.stream, m, c, o)) as any;
  const realProvider = runtime.getProvider("anthropic")!;
  runtime.getProvider = (() => ({
    ...realProvider,
    streamSimple: (m: any, c: any, o: any) => fixture(anthropic.streamSimple, m, c, o),
  })) as any;

  return {
    captured,
    attempts,
    get networkCalls() {
      return networkCalls;
    },
  };
}

for (const scenario of [
  "fresh",
  "uncaptured-tool-results",
  "changed-prefix",
  "automatic",
  "tail-rewrite",
  "empty-context",
  "over-limit",
] as const) {
  const provider = "anthropic" as const;
  test(scenario + " compacts current transformed conversation without a warm capture", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-compact-sdk-"));
    let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
    const notifications: string[] = [];
    let restoreNotify = () => {};
    try {
      const model = getModel("anthropic", "claude-sonnet-4-5")!;
      const runtime = await ModelRuntime.create({
        authPath: join(dir, "auth.json"),
        modelsPath: null,
        refreshOnCreate: false,
      });
      runtime.hasConfiguredAuth = () => true;
      runtime.getAuth = (async () => ({ auth: { apiKey: "offline-key" } })) as any;
      let compacting = false;
      const requests = captureOfflineRequests(runtime, () => compacting);
      const { captured, attempts } = requests;
      let manager = SessionManager.create(dir, join(dir, "sessions"));
      manager.appendMessage({
        role: "user",
        content: "Old task fixture. " + "context-detail ".repeat(500),
        timestamp: 1,
      });
      manager.appendMessage({
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [{ type: "text", text: "Old task noted." }],
        stopReason: "stop",
        usage,
        timestamp: 2,
      });
      if (scenario === "fresh") manager = SessionManager.open(manager.getSessionFile()!);
      let contextCalls = 0,
        frameCalls = 0,
        payloadCalls = 0,
        rewritePrefix = false;
      const contextPrompts: string[] = [];
      const loader = new DefaultResourceLoader({
        cwd: dir,
        agentDir: dir,
        noExtensions: true,
        noSkills: true,
        noThemes: true,
        noPromptTemplates: true,
        systemPrompt: bruvSystemPrompt(),
        extensionFactories: [
          {
            name: "observe",
            factory: (pi) => {
              pi.on("context", (event, ctx) => {
                contextCalls++;
                // A local preview can precede fresh request framing; only provider-bound
                // transforms must already carry the prepared instruction frame.
                if (!isReadOnlyCompactionContext()) contextPrompts.push(ctx.getSystemPrompt());
                const messages =
                  compacting && scenario === "empty-context"
                    ? []
                    : event.messages
                        .filter(
                          (m) =>
                            !(
                              m.role === "assistant" &&
                              m.content.some((c) => c.type === "text" && c.text === "Old task noted.")
                            ) &&
                            !(
                              scenario === "tail-rewrite" &&
                              m.role === "assistant" &&
                              m.content.some((c) => c.type === "text" && c.text === "Current tail acknowledged.")
                            ),
                        )
                        .map((m) =>
                          m.role === "toolResult"
                            ? {
                                ...m,
                                content: m.content.map((c) =>
                                  c.type === "text"
                                    ? { ...c, text: c.text.replaceAll("PRIVATE_REDACT_ME", "[REDACTED]") }
                                    : c,
                                ),
                              }
                            : rewritePrefix && m.role === "user" && typeof m.content === "string"
                              ? { ...m, content: m.content.replace("Old task fixture.", "CURRENT_REWRITTEN_PREFIX.") }
                              : m,
                        );
                return { messages };
              });
              pi.on("before_agent_start", (event) => {
                frameCalls++;
                return { systemPrompt: event.systemPrompt + "\nCURRENT_PIPELINE_FRAME" };
              });
              pi.on("before_provider_request", (event) => {
                payloadCalls++;
                return {
                  ...(event.payload as object),
                  metadata: { user_id: "pipeline-fixture" },
                  ...(compacting && scenario === "over-limit" ? { max_tokens: model.contextWindow } : {}),
                };
              });
              pi.on("before_provider_headers", (event) => {
                event.headers["x-bruv-fixture-routing"] = "same-route";
              });
              pi.on("before_agent_start", (_e, ctx) => {
                const ui = ctx.ui;
                const original = ui.notify;
                ui.notify = (message) => {
                  notifications.push(message);
                };
                restoreNotify = () => {
                  ui.notify = original;
                };
              });
            },
          },
          { name: "bruv-tasks", factory: tasks },
        ],
      });
      await loader.reload();
      ({ session } = await createAgentSession({
        cwd: dir,
        agentDir: dir,
        resourceLoader: loader,
        model,
        modelRuntime: runtime,
        sessionManager: manager,
        settingsManager: SettingsManager.inMemory({
          compaction: { enabled: false, keepRecentTokens: 128, reserveTokens: 8192 },
        }),
        thinkingLevel: "medium",
        tools: ["execute"],
      }));
      if (scenario !== "fresh") await session.prompt("Warm ordinary request. " + "warm-detail ".repeat(100));
      const ordinaryCount = captured.length;
      expect(ordinaryCount).toBe(scenario === "fresh" ? 0 : 1);
      manager.appendMessage({
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [
          { type: "toolCall", id: "call_new_result", name: "execute", arguments: { code: 'console.log("fixture")' } },
        ],
        stopReason: "toolUse",
        usage,
        timestamp: Date.now(),
      });
      manager.appendMessage({
        role: "toolResult",
        toolCallId: "call_new_result",
        toolName: "execute",
        content: [{ type: "text", text: "PRIVATE_REDACT_ME LATEST_TOOL_VALUE=maple-cobalt-527" }],
        isError: false,
        timestamp: Date.now(),
      });
      manager.appendMessage({
        role: "user",
        content: "Current tail. DISCARDED_REQUEST_VALUE=cedar-slate-629 " + "retained-detail ".repeat(180),
        timestamp: Date.now(),
      });
      manager.appendMessage({
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [{ type: "text", text: "Current tail acknowledged." }],
        stopReason: "stop",
        usage,
        timestamp: Date.now(),
      });
      session.agent.state.messages = manager.buildSessionContext().messages;
      compacting = true;
      rewritePrefix = scenario === "changed-prefix";
      if (scenario === "empty-context" || scenario === "over-limit") {
        await expect(session.compact()).rejects.toThrow();
        expect(captured).toHaveLength(ordinaryCount);
        expect(manager.getEntries().filter((e) => e.type === "compaction")).toHaveLength(0);
        expect(requests.networkCalls).toBe(0);
        return;
      }
      if (scenario === "automatic") await (session as any)._runAutoCompaction("threshold", false);
      else await session.compact();
      const checkpoint = manager
        .getEntries()
        .slice()
        .reverse()
        .find((e) => e.type === "compaction") as any;
      if (checkpoint?.details?.strategy !== "cache-affine-plaintext") {
        await Bun.write(
          "artifacts/compaction/current-sdk-failure-" + scenario + "-" + Date.now() + ".json",
          JSON.stringify(attempts, null, 2),
        );
        const before = attempts[0],
          after = attempts[1];
        console.log(provider, "notifications", notifications);
        console.log(
          provider,
          "mismatched fields",
          Object.keys(before ?? {}).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after?.[k])),
        );
      }
      expect(checkpoint?.details?.strategy).toBe("cache-affine-plaintext");
      expect(checkpoint.usage).toEqual(usage);
      expect(checkpoint.fromHook).toBe(true);
      expect(captured).toHaveLength(ordinaryCount + 1);
      // One additional read-only context transform previews shake without a provider call.
      expect(contextCalls).toBe(ordinaryCount + 2);
      expect(frameCalls).toBe(1);
      expect(payloadCalls).toBe(ordinaryCount + 1);
      expect(contextPrompts.every((p) => p.includes("CURRENT_PIPELINE_FRAME"))).toBe(true);
      const last = captured.at(-1).payload;
      const wire = JSON.stringify(last);
      expect(wire).toContain("LATEST_TOOL_VALUE=maple-cobalt-527");
      expect(wire).toContain("[REDACTED]");
      expect(wire).not.toContain("PRIVATE_REDACT_ME");
      expect(wire).not.toContain("Old task noted.");
      expect(JSON.stringify(last.system)).toContain("CURRENT_PIPELINE_FRAME");
      expect(JSON.stringify(last.system)).not.toContain("operating inside pi,");
      expect(wire).toContain("Summarize the whole conversation above.");
      expect(last.metadata).toEqual({ user_id: "pipeline-fixture" });
      if (scenario === "changed-prefix") expect(wire).toContain("CURRENT_REWRITTEN_PREFIX");
      expect(last.tools.some((t: any) => t.name === "execute")).toBe(true);
      expect(captured.at(-1).headers["x-bruv-fixture-routing"]).toBe("same-route");
      if (ordinaryCount) {
        expect(last.tools).toEqual(captured[0].payload.tools);
        expect(last.system).toEqual(captured[0].payload.system);
        expect(last.thinking).toEqual(captured[0].payload.thinking);
      }
      expect(requests.networkCalls).toBe(0);
    } finally {
      restoreNotify();
      session?.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
}
