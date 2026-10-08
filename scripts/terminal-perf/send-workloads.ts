/** Real Pi/Bruv editor submission with a recording SDK provider seam. No network. */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAssistantMessageEventStream, getModel, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import {
  AgentSessionRuntime,
  createAgentSession,
  DefaultResourceLoader,
  InteractiveMode,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Terminal, TuiAltScreen } from "@earendil-works/pi-tui";
import { disposeDiskBackedSessionManager, installDiskBackedSessionManager } from "../../src/history/session-manager";
import { installConversationDensity } from "../../src/ui/conversation-density";
import { installQuietStartup, installStartupEditor } from "../../src/ui/startup";

export const SEND_FIXTURE_VERSION = 1;
export type SendPath = "normal" | "steer" | "follow-up" | "command";
export type SendOptions = {
  path?: SendPath;
  historyTurns?: number;
  message?: string;
  /** Bruv installer is permanent, just like CLI startup: use in a dedicated process. */
  journal?: "sdk-disk" | "bruv-disk";
  columns?: number;
  rows?: number;
  /** Controlled mock provider wait, reported separately from synchronous work. */
  providerDelayMs?: number;
  /** Called before init/first frame. Return cleanup for any attached profiler. */
  onRendererReady?: (renderer: TuiAltScreen) => void | (() => void);
};
export type SendSpan = {
  name: string;
  startMs: number;
  endMs: number;
  /** Entry through immediate return. Async methods measure ONLY their prefix. */
  kind: "sync" | "async-prefix";
  depth: number;
};
export type SendMark = { name: string; atMs: number };
export type SendEvidence = {
  fixtureVersion: number;
  path: SendPath;
  journal: string;
  historyTurns: number;
  messageBytes: number;
  messageHash: string;
  historyHash: string;
  sourceHashes: Record<string, string>;
  actionStartMs: number;
  actionEndMs: number;
  spans: SendSpan[];
  marks: SendMark[];
  providerWaits: Array<{
    startMs: number;
    endMs: number;
    controlled: true;
    requestedDelayMs: number;
    callbackLatenessMs: number;
    observedSyncOverlapMs: number;
  }>;
  networkWaitMs: 0;
  work: Record<string, number>;
  providerRequests: Array<{ atMs: number; messages: number; bytes: number; hash: string }>;
  journalGrowthBytes: number;
  outputBytes: number;
  outputWrites: number;
  outputHash: string;
  output: string;
  acknowledgmentScreen: string[];
  screenHash: string;
  requestedProviderDelayMs: number;
  visibleAcknowledgment: boolean;
  acknowledgmentText: string;
  firstRequestMs: number | null;
  firstFrameMs: number | null;
  firstAcknowledgmentFrameMs: number | null;
  /** The fixture uses real scheduling; this is elapsed delay, NOT CPU duration. */
  requestToFrameMs: number | null;
};
export type SendWorkload = {
  name: string;
  setup(): Promise<void>;
  /** One action per setup; includes real bracketed paste dispatch AND real Enter dispatch. */
  action(): Promise<SendEvidence>;
  dispose(): Promise<void>;
};

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const now = () => performance.now();
class RecordingTerminal implements Terminal {
  kittyProtocolActive = false;
  listener?: (data: string) => void;
  writes: string[] = [];
  onWrite?: (text: string) => void;
  constructor(
    public columns: number,
    public rows: number,
  ) {}
  start(input: (data: string) => void, _resize: () => void) {
    this.listener = input;
  }
  stop() {
    this.listener = undefined;
  }
  async drainInput() {}
  input(text: string) {
    if (!this.listener) throw new Error("Terminal not started");
    this.listener(text);
  }
  write(text: string) {
    this.writes.push(text);
    this.onWrite?.(text);
  }
  moveBy(n: number) {
    if (n) this.write("\x1b[" + Math.abs(n) + (n > 0 ? "B" : "A"));
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
    this.write("\x1b]0;" + text + "\x07");
  }
  setProgress(_active: boolean) {}
}

/** Send-specific evidence. The fixture owns SDK work and teardown; this owns only observation. */
class SendObservation {
  private collecting = false;
  private depth = 0;
  private spans: SendSpan[] = [];
  private marks: SendMark[] = [];
  private work: Record<string, number> = {};
  private rawRequests: Array<{ atMs: number; messages: unknown[] }> = [];
  private providerWaits: SendEvidence["providerWaits"] = [];
  private acknowledgmentScreen: string[] = [];
  private ack = false;
  private ackText = "";
  private frameActive = false;
  private visibleNeedles: string[];

  constructor(
    private path: SendPath,
    private message: string,
  ) {
    const body = message.trim();
    const firstBreak = body.indexOf("\n");
    this.visibleNeedles = [
      body.slice(0, firstBreak < 0 ? 60 : Math.min(60, firstBreak)),
      body.slice(body.lastIndexOf("\n") + 1, body.lastIndexOf("\n") + 61),
    ];
  }

  get isCollecting() {
    return this.collecting;
  }

  get hasAcknowledgmentFrame() {
    return this.acknowledgmentScreen.length > 0;
  }

  stop() {
    this.collecting = false;
  }

  begin() {
    this.spans = [];
    this.marks = [];
    this.work = {};
    this.rawRequests = [];
    this.acknowledgmentScreen = [];
    this.providerWaits = [];
    this.ack = false;
    this.collecting = true;
  }

  mark(name: string) {
    if (this.collecting) this.marks.push({ name, atMs: now() });
  }

  measure<T>(name: string, kind: SendSpan["kind"], fn: () => T): T {
    if (!this.collecting) return fn();
    const span: SendSpan = { name, kind, startMs: now(), endMs: 0, depth: this.depth++ };
    this.work[name] = (this.work[name] ?? 0) + 1;
    try {
      return fn();
    } finally {
      this.depth--;
      span.endMs = now();
      this.spans.push(span);
    }
  }

  providerAdmitted(messages: unknown[]) {
    // Capture only references; serialization/hashing happens after action exit.
    const atMs = now();
    if (this.collecting) this.rawRequests.push({ atMs, messages });
    this.mark("provider-admission");
    return atMs;
  }

  providerFinished(startMs: number, requestedDelayMs: number) {
    if (this.collecting)
      this.providerWaits.push({
        startMs,
        endMs: now(),
        controlled: true,
        requestedDelayMs,
        callbackLatenessMs: 0,
        observedSyncOverlapMs: 0,
      });
  }

  event(event: any) {
    this.mark("event:" + event.type);
    if ((event.type === "message_start" && event.message.role === "user") || event.type === "queue_update") {
      this.ack = true;
      this.ackText =
        event.type === "queue_update"
          ? this.message.trim()
          : event.message.content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("\n");
      this.mark("ui-acknowledgment");
    }
  }

  commandAcknowledged(name: string) {
    this.ack = true;
    this.ackText = name;
    this.mark("ui-command-acknowledgment");
  }

  duringFrame<T>(renderer: TuiAltScreen, render: () => T): T {
    const frameEntryMs = now();
    this.mark("frame-entry");
    this.frameActive = true;
    try {
      return render();
    } finally {
      this.frameActive = false;
      if (this.collecting && this.ack) {
        const screen = renderer.getScreenLines();
        const plain = screen.map((line) => Bun.stripANSI(line)).join("\n");
        const needles = this.path === "command" ? [this.ackText] : this.visibleNeedles;
        if (needles.some((line) => line.length > 0 && plain.includes(line))) {
          if (!this.acknowledgmentScreen.length) {
            this.acknowledgmentScreen = screen;
            this.marks.push({ name: "visible-acknowledgment-frame", atMs: frameEntryMs });
          }
        }
      }
      this.mark("frame-exit");
    }
  }

  frameWrite() {
    if (this.frameActive && this.ack) this.mark("acknowledgment-frame-write");
  }

  finish(writes: readonly string[]) {
    // End collection before serialization; hashing is not part of the measured action.
    this.stop();
    const providerRequests = this.rawRequests.map((request) => {
      const encoded = JSON.stringify(request.messages);
      return {
        atMs: request.atMs,
        messages: request.messages.length,
        bytes: Buffer.byteLength(encoded),
        hash: hash(encoded),
      };
    });
    for (const wait of this.providerWaits) {
      wait.callbackLatenessMs = Math.max(0, wait.endMs - wait.startMs - wait.requestedDelayMs);
      // Union overlapping/nested measured intervals: don't double-count wrapper spans.
      const intervals = this.spans
        .map((span) => [Math.max(wait.startMs, span.startMs), Math.min(wait.endMs, span.endMs)])
        .filter(([start, end]) => end! > start!)
        .sort((a, b) => a[0]! - b[0]!);
      let end = wait.startMs;
      for (const [start, stop] of intervals) {
        wait.observedSyncOverlapMs += Math.max(0, stop! - Math.max(start!, end));
        end = Math.max(end, stop!);
      }
    }
    const output = writes.join("");
    const first = (name: string) => this.marks.find((m) => m.name === name)?.atMs ?? null;
    const firstRequestMs = first("render-request"),
      firstFrameMs = first("frame-entry");
    return {
      spans: this.spans.sort((a, b) => a.startMs - b.startMs),
      marks: this.marks.sort((a, b) => a.atMs - b.atMs),
      providerWaits: this.providerWaits,
      networkWaitMs: 0 as const,
      work: this.work,
      providerRequests,
      outputBytes: Buffer.byteLength(output),
      outputHash: hash(output),
      output,
      acknowledgmentScreen: this.acknowledgmentScreen,
      screenHash: hash(this.acknowledgmentScreen.join("\n")),
      visibleAcknowledgment: this.ack && this.acknowledgmentScreen.length > 0,
      acknowledgmentText: this.ackText,
      firstRequestMs,
      firstFrameMs,
      firstAcknowledgmentFrameMs: first("visible-acknowledgment-frame"),
      requestToFrameMs: firstFrameMs !== null && firstRequestMs !== null ? firstFrameMs - firstRequestMs : null,
    };
  }
}

// Pinned Pi private methods are intentionally visible in raw evidence. No production patches.
type Methods = Record<string, any>;
let active: SendWorkload | undefined;
export function createSendWorkload(options: SendOptions = {}): SendWorkload {
  const path = options.path ?? "normal";
  const historyTurns = options.historyTurns ?? 0;
  if (!Number.isInteger(historyTurns) || historyTurns < 0) throw new Error("historyTurns must be nonnegative integer");
  const message = options.message ?? (path === "command" ? "/name send-probe" : "send-probe: explain this change");
  if (!message.trim()) throw new Error("Send message must not be blank");
  const journal = options.journal ?? "sdk-disk";
  const observation = new SendObservation(path, message);
  let dir: string | undefined;
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let manager: SessionManager | undefined;
  let mode: Methods | undefined;
  let terminal: RecordingTerminal;
  let started = false;
  let actionUsed = false;
  let callbackPromise: Promise<unknown> | undefined;
  let backgroundPrompt: Promise<void> | undefined;
  let backgroundHeld = false;
  let releaseBackground: (() => void) | undefined;
  let sourceHashes: Record<string, string> = {};
  let historyHash = "";
  const cleanups: Array<() => void> = [];
  function wrap(
    target: Methods,
    method: string,
    name: string,
    kind: SendSpan["kind"] = "sync",
    after?: (args: any[], result: any) => void,
  ) {
    const original = target[method];
    if (typeof original !== "function") return;
    const descriptor = Object.getOwnPropertyDescriptor(target, method);
    target[method] = function (...args: any[]) {
      return observation.measure(name, kind, () => {
        const result = original.apply(this, args);
        after?.(args, result);
        return result;
      });
    };
    cleanups.push(() => {
      if (descriptor) Object.defineProperty(target, method, descriptor);
      else delete target[method];
    });
  }
  const fixture: SendWorkload = {
    name: "send/" + path + "/" + historyTurns + "/" + Buffer.byteLength(message),
    async setup() {
      if (started || active) throw new Error("Send fixtures must run sequentially");
      active = fixture;
      started = true;
      try {
        dir = await mkdtemp(join(tmpdir(), "bruv-send-perf-"));
        if (journal === "bruv-disk") installDiskBackedSessionManager();
        cleanups.push(installQuietStartup(), installStartupEditor(), installConversationDensity());
        const sdkDir = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
        const tuiDir = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-tui")));
        for (const [key, file] of Object.entries({
          tuiEditor: join(tuiDir, "components/editor.js"),
          tuiRenderer: join(tuiDir, "tui-alt-screen.js"),
          interactive: join(sdkDir, "modes/interactive/interactive-mode.js"),
          session: join(sdkDir, "core/agent-session.js"),
          sdk: join(sdkDir, "core/sdk.js"),
          journal: join(sdkDir, "core/session-manager.js"),
          editor: "src/ui/editor.ts",
          startup: "src/ui/startup.ts",
          diskAdapter: "src/history/session-manager.ts",
          diskStore: "src/history/disk-entry-store.ts",
          workload: "scripts/terminal-perf/send-workloads.ts",
        }))
          sourceHashes[key] = hash(await readFile(file, "utf8"));
        const syntax = await import(pathToFileURL(join(sdkDir, "utils/syntax-highlight.js")).href);
        await syntax.loadAllHighlightLanguages(); // Drain setup grammar work before sampling.
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
        manager = SessionManager.create(dir, join(dir, "sessions"));
        const history: unknown[] = [];
        for (let i = 0; i < historyTurns; i++) {
          const user = {
            role: "user" as const,
            content: [{ type: "text" as const, text: "history " + i + ": deterministic request" }],
            timestamp: 1700000000000 + i,
          };
          const assistant = response("history " + i + ": deterministic answer");
          manager.appendMessage(user);
          manager.appendMessage(assistant);
          history.push(user, assistant);
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
        // Local auth admission only. streamFunction below replaces ALL provider requests.
        modelRuntime.hasConfiguredAuth = () => true;
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
        ({ session } = await createAgentSession({
          cwd: dir,
          agentDir: dir,
          model,
          modelRuntime,
          resourceLoader,
          settingsManager,
          sessionManager: manager,
          tools: [],
        }));
        session.agent.streamFunction = (_model, context) => {
          const stream = createAssistantMessageEventStream();
          const atMs = observation.providerAdmitted(context.messages);
          const finish = () => {
            observation.providerFinished(atMs, options.providerDelayMs ?? 0);
            const answer = response("send-probe mock reply");
            stream.push({ type: "start", partial: answer });
            stream.push({ type: "done", reason: "stop", message: answer });
            stream.end(answer);
          };
          if (!observation.isCollecting && !backgroundHeld && (path === "steer" || path === "follow-up")) {
            backgroundHeld = true;
            releaseBackground = finish;
          } else setTimeout(finish, options.providerDelayMs ?? 0);
          return stream;
        };
        const services = { cwd: dir, agentDir: dir, modelRuntime, settingsManager, resourceLoader, diagnostics: [] };
        const host = new AgentSessionRuntime(session, services, async () => {
          throw new Error("Session replacement not in send fixture");
        });
        terminal = new RecordingTerminal(options.columns ?? 100, options.rows ?? 32);
        mode = new InteractiveMode(host, { terminal, tuiMode: "fullscreen" }) as unknown as Methods;
        const renderer = mode.renderer as TuiAltScreen;
        const cleanup = options.onRendererReady?.(renderer);
        if (cleanup) cleanups.push(cleanup);
        // Wrappers time entry-to-return; never await inside a synchronous interval.
        wrap(renderer, "requestRender", "tui.requestRender", "sync", () => observation.mark("render-request"));
        wrap(renderer, "doRender", "tui.doRender", "sync");
        const originalRender = (renderer as unknown as Methods).doRender;
        (renderer as unknown as Methods).doRender = function (...args: any[]) {
          return observation.duringFrame(renderer, () => originalRender.apply(this, args));
        };
        cleanups.push(() => {
          (renderer as unknown as Methods).doRender = originalRender;
        });
        terminal.onWrite = () => observation.frameWrite();
        await mode.init();
        wrap(mode.editor, "handleInput", "editor.handleInput");
        wrap(mode.editor, "addToHistory", "editor.addToHistory");
        for (const method of ["getExpandedText", "expandPasteMarkers", "handlePaste", "submitValue"])
          wrap(mode.editor, method, "editor." + method);
        wrap(mode.editor, "onSubmit", "interactive.onSubmit", "async-prefix", (_args, result) => {
          callbackPromise = Promise.resolve(result);
        });
        wrap(mode, "handleFollowUp", "interactive.handleFollowUp", "async-prefix", (_args, result) => {
          callbackPromise = Promise.resolve(result);
        });
        wrap(mode, "handleEvent", "interactive.handleEvent", "async-prefix", (args) => {
          observation.event(args[0]);
        });
        const promptOriginal = session.prompt;
        session.prompt = function (text, options) {
          const previous = options?.onUserMessageCreated;
          return promptOriginal.call(this, text, {
            ...options,
            onUserMessageCreated: (message) => {
              observation.mark("user-message-created");
              previous?.(message);
            },
          });
        };
        cleanups.push(() => {
          if (session) session.prompt = promptOriginal;
        });
        for (const method of [
          "prompt",
          "_runAgentPrompt",
          "_normalizePromptImages",
          "_tryExecuteExtensionCommand",
          "_expandSkillCommand",
          "_checkCompaction",
        ])
          wrap(session as unknown as Methods, method, "session." + method, "async-prefix");
        for (const method of ["_preparePromptAndToolLoadout", "_findLastAssistantMessage", "getContextUsage"])
          wrap(session as unknown as Methods, method, "session." + method);
        for (const method of [
          "appendMessage",
          "appendSessionInfo",
          "_appendEntry",
          "_persist",
          "buildSessionProjection",
          "buildSessionContext",
          "getBranch",
          "getEntries",
        ])
          wrap(manager as unknown as Methods, method, "journal." + method);
        const agent = session.agent as unknown as Methods;
        wrap(agent, "prompt", "agent.prompt", "async-prefix");
        wrap(agent, "convertToLlm", "agent.convertToLlm");
        wrap(agent, "transformContext", "agent.transformContext", "async-prefix");
        if (path === "steer" || path === "follow-up") {
          backgroundPrompt = session.prompt("background held request");
          for (let i = 0; i < 100 && !releaseBackground; i++) await new Promise((r) => setTimeout(r, 1));
          if (!releaseBackground) throw new Error("Recording provider was not admitted");
        }
        renderer.renderNow();
        terminal.writes = [];
      } catch (error) {
        await fixture.dispose();
        throw error;
      }
    },
    async action() {
      if (!mode || !session || !manager || actionUsed) throw new Error("Setup required; one action per fixture");
      actionUsed = true;
      const beforeBytes = await stat(manager.getSessionFile()!)
        .then((s) => s.size)
        .catch(() => 0);
      terminal.writes = [];
      observation.begin();
      const actionStartMs = now();
      let sendPromise: Promise<void> | undefined;
      if (path === "normal") {
        // Pi run() is an infinite loop. This one-turn driver uses its identical await
        // getUserInput() -> await session.prompt(input) body, without startup network jobs.
        sendPromise = mode.getUserInput().then((text: string) => session!.prompt(text));
      }
      observation.measure("action.paste-dispatch", "sync", () => terminal.input("\x1b[200~" + message + "\x1b[201~"));
      observation.mark("paste-dispatch-exit");
      observation.measure("action.enter-dispatch", "sync", () =>
        terminal.input(path === "follow-up" ? "\x1b\r" : "\r"),
      );
      observation.mark("enter-dispatch-exit");
      await callbackPromise;
      observation.mark("submit-callback-settled");
      if (sendPromise) {
        await sendPromise;
        observation.mark("session-prompt-settled");
      }
      if (path === "command") {
        observation.commandAcknowledged(manager.getSessionName() ?? "");
      }
      // Do not manually renderNow: wait for the real scheduled frame/write.
      for (let i = 0; i < 100 && !observation.hasAcknowledgmentFrame; i++) await new Promise((r) => setTimeout(r, 2));
      const actionEndMs = now();
      const measured = observation.finish(terminal.writes);
      const afterBytes = await stat(manager.getSessionFile()!)
        .then((s) => s.size)
        .catch(() => 0);
      return {
        fixtureVersion: SEND_FIXTURE_VERSION,
        path,
        journal,
        historyTurns,
        messageBytes: Buffer.byteLength(message),
        messageHash: hash(message),
        historyHash,
        sourceHashes,
        actionStartMs,
        actionEndMs,
        ...measured,
        journalGrowthBytes: afterBytes - beforeBytes,
        requestedProviderDelayMs: options.providerDelayMs ?? 0,
        // Keep the original post-stat write-count snapshot; output is captured before stat.
        outputWrites: terminal.writes.length,
      };
    },
    async dispose() {
      observation.stop();
      releaseBackground?.();
      releaseBackground = undefined;
      if (backgroundPrompt) {
        await backgroundPrompt;
        backgroundPrompt = undefined;
      }
      mode?.stop("none");
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
      session?.dispose();
      if (manager && journal === "bruv-disk") disposeDiskBackedSessionManager(manager);
      mode = undefined;
      session = undefined;
      manager = undefined;
      if (dir) await rm(dir, { recursive: true, force: true });
      dir = undefined;
      started = false;
      if (active === fixture) active = undefined;
    },
  };
  return fixture;
}

// Standalone raw evidence probe. Run in a fresh process for the production disk adapter.
if (import.meta.main) {
  const [path = "normal", turns = "0", bytes = "0", journal = "bruv-disk"] = process.argv.slice(2);
  const message =
    Number(bytes) > 0
      ? "send-probe\n" + "deterministic pasted line\n".repeat(Math.ceil(Number(bytes) / 26))
      : undefined;
  const workload = createSendWorkload({
    path: path as SendPath,
    historyTurns: Number(turns),
    message,
    journal: journal as SendOptions["journal"],
    providerDelayMs: 10,
  });
  try {
    await workload.setup();
    console.log(JSON.stringify(await workload.action(), null, 2));
  } finally {
    await workload.dispose();
  }
}
