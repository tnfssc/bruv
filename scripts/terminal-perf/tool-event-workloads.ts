import type { ProbeMethods as Methods, ProbeInteractiveMode } from "./sdk-probe-types";
import { requireValue } from "../lib/require-value";
/** Actual initialized InteractiveMode callbacks, NOT a component-only or provider benchmark. */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir, cpus, platform, release, arch } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import http from "node:http";
import https from "node:https";
import { Socket } from "node:net";
import {
  createAssistantMessageEventStream,
  getModel,
  type AssistantMessage,
  type ToolCall,
} from "@earendil-works/pi-ai/compat";
import {
  AgentSessionRuntime,
  createAgentSession,
  DefaultResourceLoader,
  InteractiveMode,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  ToolExecutionComponent,
  type AgentSessionEvent,
  type AgentSession,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Terminal } from "@earendil-works/pi-tui";
import { installDiskBackedSessionManager, disposeDiskBackedSessionManager } from "../../src/history/session-manager";
import { installConversationDensity } from "../../src/ui/conversation-density";
import { installQuietStartup, installStartupEditor } from "../../src/ui/startup";
import { registerExecuteTool } from "../../src/typescript/extension";
import {
  attachTerminalActionProfiler,
  type TerminalActionProfiler,
  type TerminalActionProfilerSnapshot,
} from "./action-profiler";

export const TOOL_EVENT_FIXTURE_VERSION = 1;
export const toolEventShapes = ["normal", "ascii", "ansi", "unicode", "newline", "structured"] as const;
export type ToolEventShape = (typeof toolEventShapes)[number];
export type ToolEventOptions = {
  shape?: ToolEventShape;
  outcome?: "success" | "error" | "warning";
  historyTurns?: number;
  burstCount?: number;
  /** UTF-8 target size; exact bytes are recorded, multi-byte characters may overshoot slightly. */
  argsBytes?: number;
  finalBytes?: number;
};
export type ToolEventCallback = {
  scope: "async-prefix";
  index: number;
  type: string;
  source: "direct-handleEvent" | "subscribed-session";
  startMs: number;
  endMs: number;
  updateDisplayCount: number;
  renderResultCount: number;
  returnedPromise: boolean;
  settledAtMs: number | null;
  rejected: string | null;
};
export type ToolEventFrame = { startMs: number; endMs: number; phase: string; callbackCount: number; lines: string[] };
export type ToolEventInput = {
  action: string;
  data: string;
  queuedAtMs: number;
  expectedAtMs: number;
  enteredAtMs: number;
  returnedAtMs: number;
  latenessMs: number;
  editorText: string;
};
export type ToolEventEvidence = {
  fixtureVersion: number;
  seam: string;
  options: Required<ToolEventOptions>;
  environment: { bun: string; platform: string; release: string; arch: string; cpu: string };
  sourceHashes: Record<string, string>;
  historyHash: string;
  content: { events: AgentSessionEvent[]; hash: string; argsBytes: number; finalBytes: number; finalHash: string };
  callbacks: ToolEventCallback[];
  frames: ToolEventFrame[];
  inputs: ToolEventInput[];
  burst: {
    startMs: number;
    endMs: number;
    callbackCount: number;
    updateDisplayCount: number;
    renderResultCount: number;
    frameCount: number;
  };
  visibility: {
    intermediateMarkers: string[];
    intermediateSeen: string[];
    intermediateNotSeen: string[];
    finalMarker: string;
    finalSeen: boolean;
    finalStateMatches: boolean;
    pendingAfterFinal: number;
  };
  counts: {
    callback: number;
    updateDisplay: number;
    renderResult: number;
    frame: number;
    input: number;
    networkAttempts: number;
  };
  providerRequests: Array<{ atMs: number; messages: number; bytes: number; hash: string }>;
  journalGrowthBytes: number;
  output: string;
  outputBytes: number;
  outputHash: string;
  trace: TerminalActionProfilerSnapshot;
};
export type ToolEventWorkload = {
  setup(): Promise<void>;
  action(): Promise<ToolEventEvidence>;
  dispose(): Promise<void>;
};
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const now = () => performance.now();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let installed = false;

class RecordingTerminal implements Terminal {
  kittyProtocolActive = false;
  writes: string[] = [];
  listener?: (data: string) => void;
  columns = 100;
  rows = 32;
  start(input: (data: string) => void, _resize: () => void) {
    this.listener = input;
  }
  stop() {
    this.listener = undefined;
  }
  async drainInput() {}
  input(data: string) {
    if (!this.listener) throw new Error("Terminal not started");
    this.listener(data);
  }
  write(data: string) {
    this.writes.push(data);
  }
  moveBy(n: number) {
    if (n) this.write(`\x1b[${Math.abs(n)}${n > 0 ? "B" : "A"}`);
  }
  hideCursor() {
    this.write("\x1b[?25l");
  }
  showCursor() {
    this.write("\x1b[?25h");
  }
  clearLine() {
    this.write("\x1b[2K");
  }
  clearFromCursor() {
    this.write("\x1b[J");
  }
  clearScreen() {
    this.write("\x1b[2J");
  }
  setProgramStatus() {}
  setTitle(text: string) {
    this.write(`\x1b]0;${text}\x07`);
  }
  setProgress(_active: boolean) {}
}

/** Block provider fetch and other TCP/HTTP egress; no auth secrets are needed or supplied. */
function guardNetwork(onAttempt: () => void): () => void {
  const restores: Array<() => void> = [];
  function deny(object: object, method: string) {
    const target = object as Methods;
    const descriptor = Object.getOwnPropertyDescriptor(target, method);
    target[method] = () => {
      onAttempt();
      throw new Error(`tool-event workload forbids network: ${method}`);
    };
    restores.push(() => {
      if (descriptor) Object.defineProperty(target, method, descriptor);
      else delete target[method];
    });
  }
  deny(globalThis, "fetch");
  for (const target of [http, https]) for (const method of ["request", "get"]) deny(target, method);
  deny(Socket.prototype as unknown as Methods, "connect");
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

function fill(unit: string, bytes: number): string {
  return unit.repeat(Math.ceil(bytes / Buffer.byteLength(unit)));
}
/** Real SDK event discriminants and AssistantMessageEvent partials, constructed outside measured callbacks. */
export function buildToolEventBurst(options: Required<ToolEventOptions>) {
  const { shape, argsBytes, finalBytes, burstCount, outcome } = options;
  const model = getModel("openai", "gpt-4o");
  const assistant = (args: unknown, stopReason: AssistantMessage["stopReason"] = "toolUse"): AssistantMessage => ({
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "event-probe-tool",
        name: shape === "structured" ? "event_probe_json" : "execute",
        arguments: args as ToolCall["arguments"],
      },
    ],
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: 1700000000000,
    stopReason,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  const units = {
    normal: "console.log('short');",
    ascii: "const ascii = 'abcdefgh0123456789'; ",
    ansi: "\x1b[31mred\x1b[0m ",
    unicode: "界🙂é👩‍💻 ",
    newline: "console.log('line');\n",
    structured: "record",
  };
  const code = fill(units[shape], argsBytes);
  const args: Record<string, unknown> =
    shape === "structured"
      ? {
          records: Array.from({ length: Math.max(1, Math.ceil(argsBytes / 64)) }, (_, i) => ({
            index: i,
            text: `structured record ${i}`,
            flags: [true, false],
            nested: { value: i },
          })),
        }
      : { label: "Tool event probe", code };
  const name = shape === "structured" ? "event_probe_json" : "execute";
  const events: AgentSessionEvent[] = [{ type: "message_start", message: assistant({}) }];
  const intermediateMarkers: string[] = [];
  for (let i = 0; i < burstCount; i++) {
    const partialArgs =
      shape === "structured"
        ? {
            records: (args.records as unknown[]).slice(
              0,
              Math.ceil(((i + 1) / burstCount) * (args.records as unknown[]).length),
            ),
          }
        : { label: "Tool event probe", code: code.slice(0, Math.ceil(((i + 1) / burstCount) * code.length)) };
    const message = assistant(partialArgs);
    events.push({
      type: "message_update",
      message,
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: `controlled partial ${i}`,
        partial: message,
      },
    });
  }
  events.push({ type: "message_end", message: assistant(args) });
  events.push({ type: "tool_execution_start", toolCallId: "event-probe-tool", toolName: name, args });
  for (let i = 0; i < burstCount; i++) {
    const marker = `INTERMEDIATE_EVENT_${i}_ONLY`;
    intermediateMarkers.push(marker);
    events.push({
      type: "tool_execution_update",
      toolCallId: "event-probe-tool",
      toolName: name,
      args,
      partialResult: {
        content: [{ type: "text", text: `${marker}\n${fill(units[shape], Math.min(finalBytes, (i + 1) * 128))}` }],
        details: { exitCode: 0 },
      },
    });
  }
  const finalMarker = `FINAL_EVENT_PAYLOAD_${outcome.toUpperCase()}`;
  const text =
    finalMarker +
    "\n" +
    fill(shape === "normal" || shape === "structured" ? "final oversized output row\n" : units[shape], finalBytes) +
    "\n" +
    finalMarker;
  const result = {
    content: [{ type: "text" as const, text }],
    details:
      outcome === "warning"
        ? {
            exitCode: 0,
            stdoutLost: true,
            stdoutPath: "/fixture/output/stdout.log",
            outputArtifactErrors: { stdout: "ENOSPC: controlled artifact warning" },
          }
        : { exitCode: outcome === "error" ? 1 : 0 },
  };
  events.push({
    type: "tool_execution_end",
    toolCallId: "event-probe-tool",
    toolName: name,
    result,
    isError: outcome === "error",
  });
  // Unexpected but type-valid ordering: absent components must not overwrite final state.
  const ignored = {
    content: [{ type: "text" as const, text: "IGNORED_LATE_DUPLICATE_ORPHAN" }],
    details: { exitCode: 0 },
  };
  events.push({
    type: "tool_execution_update",
    toolCallId: "event-probe-tool",
    toolName: name,
    args,
    partialResult: ignored,
  });
  events.push({
    type: "tool_execution_end",
    toolCallId: "event-probe-tool",
    toolName: name,
    result: ignored,
    isError: false,
  });
  events.push({
    type: "tool_execution_start",
    toolCallId: "event-probe-nested",
    parentToolCallId: "event-probe-tool",
    toolName: name,
    args,
  });
  events.push({
    type: "tool_execution_update",
    toolCallId: "event-probe-orphan",
    toolName: name,
    args,
    partialResult: ignored,
  });
  events.push({
    type: "tool_execution_end",
    toolCallId: "event-probe-nested",
    parentToolCallId: "event-probe-tool",
    toolName: name,
    result: ignored,
    isError: false,
  });
  return { events, args, result, intermediateMarkers, finalMarker };
}

export function createToolEventWorkload(input: ToolEventOptions = {}): ToolEventWorkload {
  const options: Required<ToolEventOptions> = {
    shape: input.shape ?? "normal",
    outcome: input.outcome ?? "success",
    historyTurns: input.historyTurns ?? 8,
    burstCount: input.burstCount ?? 8,
    argsBytes: input.argsBytes ?? (input.shape && input.shape !== "normal" ? 65536 : 64),
    finalBytes: input.finalBytes ?? 65536,
  };
  if (!toolEventShapes.includes(options.shape) || !["success", "error", "warning"].includes(options.outcome))
    throw new Error("Unknown tool-event shape/outcome");
  for (const [key, max] of [
    ["historyTurns", 64],
    ["burstCount", 64],
    ["argsBytes", 262144],
    ["finalBytes", 262144],
  ] as const) {
    if (!Number.isSafeInteger(options[key]) || options[key] < (key === "burstCount" ? 1 : 0) || options[key] > max)
      throw new Error(`Bounded sequential probe: invalid ${key}`);
  }
  const payload = buildToolEventBurst(options);
  const cleanups: Array<() => void> = [];
  const terminal = new RecordingTerminal();
  let dir: string | undefined,
    manager: SessionManager | undefined,
    session: AgentSession | undefined,
    mode: ProbeInteractiveMode | undefined;
  let profiler: TerminalActionProfiler | undefined;
  let collecting = false,
    used = false,
    phase = "setup",
    source: ToolEventCallback["source"] = "subscribed-session";
  let updateCount = 0,
    resultCount = 0,
    networkAttempts = 0;
  const callbacks: ToolEventCallback[] = [],
    frames: ToolEventFrame[] = [],
    inputs: ToolEventInput[] = [];
  const settlements: Promise<unknown>[] = [];
  const requests: Array<{ atMs: number; messages: unknown[] }> = [];
  const sourceHashes: Record<string, string> = {};
  let historyHash = "";
  let finalComponent: { result?: Parameters<ToolExecutionComponent["updateResult"]>[0] } | undefined;
  function countWrap(target: Methods, method: string, increment: () => void) {
    const descriptor = Object.getOwnPropertyDescriptor(target, method),
      original = target[method];
    target[method] = function (...args: unknown[]) {
      if (collecting) increment();
      return original.apply(this, args);
    };
    cleanups.push(() => {
      if (descriptor) Object.defineProperty(target, method, descriptor);
      else delete target[method];
    });
  }
  async function framesAfter(before: number) {
    // Bounded observation wait OUTSIDE all CPU boundaries, never renderNow in action.
    for (let i = 0; i < 200 && frames.length <= before; i++) await sleep(5);
    if (frames.length <= before) throw new Error(`No actual scheduled frame for ${phase}`);
  }
  function queueInput(action: string, data: string): Promise<void> {
    const queuedAtMs = now(),
      expectedAtMs = queuedAtMs;
    return new Promise<void>((resolve, reject) =>
      setTimeout(() => {
        const enteredAtMs = now();
        try {
          requireValue(profiler).runAction(`input:${action}`, () => terminal.input(data));
          const returnedAtMs = now();
          inputs.push({
            action,
            data,
            queuedAtMs,
            expectedAtMs,
            enteredAtMs,
            returnedAtMs,
            latenessMs: Math.max(0, enteredAtMs - expectedAtMs),
            editorText: requireValue(mode).editor.getText(),
          });
          resolve();
        } catch (error) {
          reject(error);
        }
      }, 0),
    );
  }
  // No await: only direct callbacks belong to this contiguous measured slice.
  function dispatchToolBurst(mode: ProbeInteractiveMode): ToolEventEvidence["burst"] {
    const beforeFrames = frames.length,
      beforeCallbacks = callbacks.length,
      beforeUpdates = updateCount,
      beforeResults = resultCount;
    const startMs = now();
    source = "direct-handleEvent";
    try {
      for (const event of payload.events) {
        mode.handleEvent(event);
        if (event.type === "tool_execution_start" && event.toolCallId === "event-probe-tool")
          finalComponent = mode.pendingTools.get("event-probe-tool");
      }
    } finally {
      source = "subscribed-session";
    }
    const endMs = now();
    return {
      startMs,
      endMs,
      callbackCount: callbacks.length - beforeCallbacks,
      updateDisplayCount: updateCount - beforeUpdates,
      renderResultCount: resultCount - beforeResults,
      frameCount: frames.length - beforeFrames,
    };
  }

  // Unlike the injected burst, Enter must run through the subscribed SDK session.
  async function sendEditorThroughSession(
    mode: ProbeInteractiveMode,
    session: AgentSession,
    profiler: TerminalActionProfiler,
  ) {
    phase = "send-enter";
    const beforeSend = frames.length;
    // Identical one-turn body of Pi run(), without its infinite loop/startup network work.
    const sendPromise = profiler
      .runAction("send:getUserInput", () => mode.getUserInput())
      .then((text: string) => profiler.runAction("send:session.prompt:async-prefix", () => session.prompt(text)));
    await queueInput("send-enter", "\r");
    for (let i = 0; i < 400 && (!requests.length || session.isStreaming); i++) await sleep(5);
    if (!requests.length || session.isStreaming) throw new Error("Real send did not settle through recording provider");
    await sendPromise;
    await framesAfter(beforeSend);
    await sleep(30);
    await Promise.all(settlements);
  }

  const fixture: ToolEventWorkload = {
    async setup() {
      if (installed) throw new Error("Tool-event workloads require a fresh process (irreversible Bruv disk adapter)");
      installed = true;
      const offline = process.env.PI_OFFLINE;
      process.env.PI_OFFLINE = "1";
      cleanups.push(() => {
        if (offline === undefined) delete process.env.PI_OFFLINE;
        else process.env.PI_OFFLINE = offline;
      });
      cleanups.push(guardNetwork(() => networkAttempts++));
      try {
        dir = await mkdtemp(join(tmpdir(), "bruv-tool-event-perf-"));
        installDiskBackedSessionManager();
        cleanups.push(installQuietStartup(), installStartupEditor(), installConversationDensity());
        const sdkDir = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
        const tuiDir = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-tui")));
        for (const [key, file] of Object.entries({
          workload: "scripts/terminal-perf/tool-event-workloads.ts",
          interactive: join(sdkDir, "modes/interactive/interactive-mode.js"),
          component: join(sdkDir, "modes/interactive/components/tool-execution.js"),
          renderer: join(tuiDir, "tui-alt-screen.js"),
          session: join(sdkDir, "core/agent-session.js"),
          diskAdapter: "src/history/session-manager.ts",
          editor: "src/ui/editor.ts",
          executeAdapter: "src/typescript/extension.ts",
          previews: "src/ui/execution-previews.ts",
        }))
          sourceHashes[key] = hash(await readFile(file, "utf8"));
        const syntax = await import(pathToFileURL(join(sdkDir, "utils/syntax-highlight.js")).href);
        await syntax.loadAllHighlightLanguages();
        manager = SessionManager.create(dir, join(dir, "sessions"));
        const model = getModel("openai", "gpt-4o");
        const response = (text: string): AssistantMessage => ({
          role: "assistant",
          content: [{ type: "text", text }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          timestamp: 1700000000000,
          stopReason: "stop",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        });
        const history: unknown[] = [];
        for (let i = 0; i < options.historyTurns; i++) {
          const user = { role: "user" as const, content: `tool event history ${i}`, timestamp: 1700000000000 + i };
          const answer = response(`settled history ${i}`);
          manager.appendMessage(user);
          manager.appendMessage(answer);
          history.push(user, answer);
        }
        historyHash = hash(JSON.stringify(history));
        const settingsManager = SettingsManager.inMemory({
          compaction: { enabled: false },
          retry: { enabled: false },
          tuiMode: "fullscreen",
          quietStartup: true,
        });
        const modelRuntime = await ModelRuntime.create({
          authPath: join(dir, "auth.json"),
          modelsPath: null,
          refreshOnCreate: false,
        });
        modelRuntime.hasConfiguredAuth = () => true; // Admission only, no real credential; streamFunction replaces provider.
        const resourceLoader = new DefaultResourceLoader({
          cwd: dir,
          agentDir: dir,
          settingsManager,
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
        });
        await resourceLoader.reload();
        let definition: ToolDefinition | undefined;
        const listeners = new Map<string, Array<() => void>>();
        registerExecuteTool(
          {
            on: (event: string, fn: () => void) => listeners.set(event, [...(listeners.get(event) ?? []), fn]),
            registerTool: (tool: ToolDefinition) => {
              definition = tool;
            },
          } as unknown as ExtensionAPI,
          undefined,
          undefined,
          () => 0,
        );
        cleanups.push(() => {
          for (const fn of listeners.get("agent_end") ?? []) fn();
        });
        if (!definition) throw new Error("Production execute registration failed");
        // Never execute code. The actual tool renderer is registered on the real session.
        definition.execute = async () => {
          throw new Error("Tool execution forbidden in event dispatch workload");
        };
        countWrap(definition as unknown as Methods, "renderResult", () => resultCount++);
        countWrap(ToolExecutionComponent.prototype as unknown as Methods, "updateDisplay", () => updateCount++);
        ({ session } = await createAgentSession({
          cwd: dir,
          agentDir: dir,
          model,
          modelRuntime,
          settingsManager,
          resourceLoader,
          sessionManager: manager,
          tools: ["execute"],
          customTools: [definition],
        }));
        session.agent.streamFunction = (_model, context) => {
          if (collecting) requests.push({ atMs: now(), messages: context.messages });
          const stream = createAssistantMessageEventStream();
          const answer = response("tool-event send acknowledged");
          setTimeout(() => {
            stream.push({ type: "start", partial: answer });
            stream.push({ type: "done", reason: "stop", message: answer });
            stream.end(answer);
          }, 0);
          return stream;
        };
        const host = new AgentSessionRuntime(
          session,
          { cwd: dir, agentDir: dir, modelRuntime, settingsManager, resourceLoader, diagnostics: [] },
          async () => {
            throw new Error("Session replacement forbidden");
          },
        );
        mode = new InteractiveMode(host, { terminal, tuiMode: "fullscreen" }) as unknown as ProbeInteractiveMode;
        await mode.init();
        if (typeof mode.getRegisteredToolDefinition("execute")?.renderResult !== "function")
          throw new Error("SDK did not admit production execute renderer");
        const renderer = mode.renderer as unknown as {
          doRender(...args: unknown[]): void;
          renderNow(): void;
          getScreenLines(): string[];
        };
        const original = mode.handleEvent;
        mode.handleEvent = function (event: AgentSessionEvent) {
          if (!collecting) return original.call(this, event);
          const callback: ToolEventCallback = {
            scope: "async-prefix",
            index: callbacks.length,
            type: event.type,
            source,
            startMs: now(),
            endMs: 0,
            updateDisplayCount: 0,
            renderResultCount: 0,
            returnedPromise: false,
            settledAtMs: null,
            rejected: null,
          };
          const beforeUpdates = updateCount,
            beforeResults = resultCount;
          callbacks.push(callback);
          let value: Promise<void> | undefined;
          try {
            // Exactly one whole-call boundary; no callback-internal spans or await.
            value = requireValue(profiler).runAction(`event:${event.type}:${callback.index}`, () =>
              original.call(this, event),
            );
            return requireValue(value);
          } finally {
            callback.endMs = now();
            callback.updateDisplayCount = updateCount - beforeUpdates;
            callback.renderResultCount = resultCount - beforeResults;
            callback.returnedPromise = value instanceof Promise;
            if (callback.returnedPromise)
              settlements.push(
                Promise.resolve(value).then(
                  () => {
                    callback.settledAtMs = now();
                  },
                  (error) => {
                    callback.settledAtMs = now();
                    callback.rejected = String(error);
                  },
                ),
              );
          }
        };
        cleanups.push(() => {
          if (mode) mode.handleEvent = original;
        });
        const doRender = renderer.doRender;
        renderer.doRender = function (...args: unknown[]) {
          if (!collecting) return doRender.apply(this, args);
          const startMs = now();
          try {
            return doRender.apply(this, args);
          } finally {
            frames.push({
              startMs,
              endMs: now(),
              phase,
              callbackCount: callbacks.length,
              lines: this.getScreenLines(),
            });
          }
        };
        cleanups.push(() => {
          renderer.doRender = doRender;
        });
        profiler = attachTerminalActionProfiler(renderer, {
          capacity: 16384,
          heartbeatIntervalMs: 4,
          traceInfo: { fixture: "tool-event", seam: "direct-handleEvent", source: requireValue(sourceHashes.workload) },
        });
        // Only setup drain. Expanded final output must be genuinely visible, not inferred from component state.
        terminal.input("\x0f");
        renderer.renderNow();
        await sleep(30);
        terminal.writes = [];
        profiler.clear();
      } catch (error) {
        await fixture.dispose();
        throw error;
      }
    },
    async action() {
      if (!mode || !session || !manager || !profiler || used)
        throw new Error("One action after setup, in a fresh process");
      used = true;
      const beforeBytes = await stat(requireValue(manager.getSessionFile()))
        .then((s) => s.size)
        .catch(() => 0);
      collecting = true;
      phase = "burst";
      // Input readiness is queued BEFORE the same-turn burst; callback entry occurs AFTER it.
      const queued = [
        queueInput("type-after-burst", "event-input"),
        queueInput("paste-after-burst", "\x1b[200~ first line\nsecond line\x1b[201~"),
        queueInput("cursor-left-after-burst", "\x1b[D"),
        queueInput("backspace-after-burst", "\x7f"),
      ];
      const beforeFrames = frames.length;
      const burst = dispatchToolBurst(mode);
      phase = "backlogged-input";
      await Promise.all(queued);
      await Promise.all(settlements);
      await framesAfter(beforeFrames);
      for (const [action, data] of [
        ["collapse-tool", "\x0f"],
        ["reveal-tool", "\x0f"],
        ["scroll-up", "\x1b[5~"],
        ["scroll-down", "\x1b[6~"],
      ]) {
        phase = requireValue(action);
        const before = frames.length;
        await queueInput(requireValue(action), requireValue(data));
        await framesAfter(before);
      }
      await sendEditorThroughSession(mode, session, profiler);
      collecting = false;
      const afterBytes = await stat(requireValue(manager.getSessionFile()))
        .then((s) => s.size)
        .catch(() => 0);
      const output = terminal.writes.join("");
      const screen = frames
        .flatMap((frame) => frame.lines)
        .map((line) => Bun.stripANSI(line))
        .join("\n");
      const intermediateSeen = payload.intermediateMarkers.filter((marker) => screen.includes(marker));
      const finalStateMatches =
        JSON.stringify(finalComponent?.result?.content) === JSON.stringify(payload.result.content) &&
        JSON.stringify(finalComponent?.result?.details) === JSON.stringify(payload.result.details) &&
        finalComponent?.result?.isError === (options.outcome === "error");
      return {
        fixtureVersion: TOOL_EVENT_FIXTURE_VERSION,
        seam: "Typed AgentSessionEvent direct InteractiveMode.handleEvent injection for controlled same-turn tool burst; real subscribed SDK session events for subsequent Enter. No provider/tool execution or stream parser speed claim.",
        options,
        environment: {
          bun: Bun.version,
          platform: platform(),
          release: release(),
          arch: arch(),
          cpu: cpus()[0]?.model ?? "unknown",
        },
        sourceHashes,
        historyHash,
        content: {
          events: payload.events,
          hash: hash(JSON.stringify(payload.events)),
          argsBytes: Buffer.byteLength(JSON.stringify(payload.args)),
          finalBytes: Buffer.byteLength(requireValue(payload.result.content[0]).text),
          finalHash: hash(JSON.stringify(payload.result)),
        },
        callbacks,
        frames,
        inputs,
        burst,
        visibility: {
          intermediateMarkers: payload.intermediateMarkers,
          intermediateSeen,
          intermediateNotSeen: payload.intermediateMarkers.filter((marker) => !intermediateSeen.includes(marker)),
          finalMarker: payload.finalMarker,
          finalSeen: screen.includes(payload.finalMarker),
          finalStateMatches,
          pendingAfterFinal: mode.pendingTools.size,
        },
        counts: {
          callback: callbacks.length,
          updateDisplay: updateCount,
          renderResult: resultCount,
          frame: frames.length,
          input: inputs.length,
          networkAttempts,
        },
        providerRequests: requests.map((request) => ({
          atMs: request.atMs,
          messages: request.messages.length,
          bytes: Buffer.byteLength(JSON.stringify(request.messages)),
          hash: hash(JSON.stringify(request.messages)),
        })),
        journalGrowthBytes: afterBytes - beforeBytes,
        output,
        outputBytes: Buffer.byteLength(output),
        outputHash: hash(output),
        trace: profiler.snapshot(),
      };
    },
    async dispose() {
      collecting = false;
      profiler?.dispose();
      profiler = undefined;
      mode?.stop("none");
      session?.dispose();
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
      if (manager) disposeDiskBackedSessionManager(manager);
      mode = undefined;
      session = undefined;
      manager = undefined;
      if (dir) await rm(dir, { recursive: true, force: true });
      dir = undefined;
    },
  };
  return fixture;
}

if (import.meta.main) {
  const options = process.argv[2] ? (JSON.parse(process.argv[2]) as ToolEventOptions) : {};
  const workload = createToolEventWorkload(options);
  try {
    await workload.setup();
    const bytes = Buffer.from(`${JSON.stringify(await workload.action(), null, 2)}\n`, "utf8");
    await new Promise<void>((resolve, reject) =>
      process.stdout.write(bytes, (error) => (error ? reject(error) : resolve())),
    );
  } finally {
    await workload.dispose();
  }
}
