/** Provider-free SDK event mutations + complete Pi frames. Not an execution/provider benchmark. */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { cpus, platform, release, arch } from "node:os";
import { execFileSync } from "node:child_process";
import {
  type ExtensionAPI,
  type ToolDefinition,
  type Theme,
  initTheme,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  ScrollView,
  VStack,
  Input,
  TuiAltScreen,
  getCapabilities,
  setCapabilities,
} from "@earendil-works/pi-tui";
import { registerExecuteTool } from "../../src/typescript/extension";
import { installConversationDensity } from "../../src/ui/conversation-density";
import { installSdkTaskRows } from "../../src/ui/sdk-task-rows";
import { ActivityController } from "../../src/ui/rolling-activity";
import type { TaskRow } from "../../src/ui/task-rows";
import { FakeTerminal } from "./workloads";
import { attachTerminalProfiler, type TerminalFrameSample, type TerminalProfiler } from "./profiler";

const sdkDir = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const themeModule = (await import(pathToFileURL(join(sdkDir, "modes/interactive/theme/theme.js")).href)) as {
  theme: Theme;
};
export const toolShapes = [
  "short",
  "single-line",
  "multiline",
  "ansi",
  "markdown",
  "json",
  "code-preview",
  "failure",
  "artifact-warning",
  "handoff",
  "task-rows",
  "sdk-json-args",
  "png-image",
] as const;
export type ToolShape = (typeof toolShapes)[number];
export const toolStages = [
  "construct",
  "args-stream",
  "args-complete",
  "start",
  "partial",
  "complete",
  "reveal",
  "collapse",
  "error",
] as const;
export type ToolStage = (typeof toolStages)[number];
export type ToolWorkloadOptions = {
  shape: ToolShape;
  historySize?: number;
  columns?: number;
  rows?: number;
  initialArgs?: "empty" | "complete";
};
export type SyncSegment = { name: string; durationMs: number };
export type ToolWork = {
  constructions: number;
  updateArgs: number;
  argsComplete: number;
  starts: number;
  updateResult: number;
  expansions: number;
  documentRenders: number;
  componentRenders: number;
  branchCalls: number;
  branchEntries: number;
  snapshotCalls: number;
  snapshotRows: number;
  renderRequests: number;
};
export type ToolSample = {
  stage: "setup" | ToolStage;
  /** Non-overlapping synchronous mutations. Payload preparation/hashing excluded. */
  segments: SyncSegment[];
  mutationMs: number;
  /** doRender entry/exit, NOT mutation duration; delay is reported by the profiler separately. */
  frames: TerminalFrameSample[];
  renderDrainMs: number;
  output: string;
  screenLines: string[];
  outputBytes: number;
  outputWrites: number;
  outsideFrameOutputBytes: number;
  outsideFrameWriteCount: number;
  outputHash: string;
  screenHash: string;
  renderedDocumentHash: string;
  renderedDocumentLines: number;
  changedRows: number;
  work: ToolWork;
  workHash: string;
  content: {
    hash: string;
    codeBytes: number;
    argsBytes: number;
    resultBytes: number;
    imageBytes: number;
    outputBytes: number;
    resultBlocks: number;
    taskRows: number;
    renderer: "registered-execute" | "sdk-generic";
    imageProcessing: "none" | "synchronous-png-kitty";
  };
};
export type ToolWorkload = {
  name: string;
  version: 1;
  options: Required<ToolWorkloadOptions>;
  content: ToolSample["content"];
  setup(): ToolSample;
  action(stage: ToolStage): ToolSample;
  dispose(): void;
};
let active: ToolWorkload | undefined;
const fingerprint = (text: string) => createHash("sha256").update(text).digest("hex");
const freshWork = (): ToolWork => ({
  constructions: 0,
  updateArgs: 0,
  argsComplete: 0,
  starts: 0,
  updateResult: 0,
  expansions: 0,
  documentRenders: 0,
  componentRenders: 0,
  branchCalls: 0,
  branchEntries: 0,
  snapshotCalls: 0,
  snapshotRows: 0,
  renderRequests: 0,
});

// Valid bounded 256x256 PNG: deterministic decoder/encoding work, no native transcoder or provider.
function png(): string {
  function chunk(type: string, data: Buffer) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const check = Buffer.alloc(4);
    check.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, check]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(256, 0);
  header.writeUInt32BE(256, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc(256 * (1 + 256 * 3));
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256 * 3; x++) pixels[y * 769 + x + 1] = (x * 17 + y * 31) % 256;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}
function payload(shape: ToolShape) {
  let code = 'console.log("tool fixture evidence")';
  let text = "Tool fixture evidence\nSecond bounded line.";
  let details: Record<string, unknown> = { exitCode: 0 };
  const tasks: TaskRow[] =
    shape === "task-rows"
      ? Array.from({ length: 48 }, (_, i) => ({
          id: "row-" + i,
          source: i % 3 === 0 ? "local" : i % 3 === 1 ? "native" : "ssh",
          sourceCallId: "live-call",
          title: "Inspect deterministic module " + i,
          status: i % 7 === 0 ? "failed" : "succeeded",
          terminal: true,
          exitCode: i % 7 === 0 ? 1 : 0,
        }))
      : [];
  switch (shape) {
    case "single-line":
      text = "long-line:" + "x界🙂".repeat(8192);
      break; // 64 KiB UTF-8, one logical line
    case "multiline":
      text = Array.from({ length: 2048 }, (_, i) => "output " + i + " " + "bounded evidence ".repeat(3)).join("\n");
      break;
    case "ansi":
      text = Array.from(
        { length: 1024 },
        (_, i) => "\x1b[31merror " + i + "\x1b[0m \x1b[1mstatus\x1b[0m wide 界🙂",
      ).join("\n");
      break;
    case "markdown":
      text = Array.from(
        { length: 256 },
        (_, i) =>
          "## Evidence " + i + "\n\n- **item** [link](https://example.test)\n\n```ts\nconsole.log(" + i + ")\n```\n",
      ).join("\n");
      break;
    case "json":
      text = JSON.stringify(
        Array.from({ length: 512 }, (_, i) => ({
          id: i,
          title: "evidence",
          nested: { ok: true, values: [i, i + 1, i + 2] },
        })),
        null,
        2,
      );
      break;
    case "code-preview":
      code = Array.from(
        { length: 1024 },
        (_, i) => "const value" + i + " = { index: " + i + ', title: "bounded code preview" };',
      ).join("\n");
      break;
    case "failure":
      text =
        "Error: deterministic tool failure\n" +
        Array.from({ length: 256 }, (_, i) => "    at module" + i + " (fixture.ts:" + i + ":1)").join("\n");
      details.exitCode = 1;
      break;
    case "artifact-warning":
      details = {
        exitCode: 0,
        stdoutLost: true,
        outputArtifactErrors: { stdout: "ENOSPC: deterministic artifact failure" },
        stdoutPath: "/fixture/output/stdout.log",
      };
      break;
    case "handoff":
      details.handoff = "Review the bounded task evidence and choose the next action.";
      break;
    case "task-rows":
      details.taskRows = tasks;
      break;
    case "sdk-json-args":
      code = JSON.stringify(Array.from({ length: 512 }, (_, i) => ({ index: i, label: "generic SDK argument" })));
      break;
  }
  const args = shape === "sdk-json-args" ? { items: JSON.parse(code) } : { label: "Inspect " + shape, code };
  const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [{ type: "text", text }];
  if (shape === "png-image") content.push({ type: "image", data: png(), mimeType: "image/png" });
  const result = { content, details, isError: shape === "failure" };
  const partial = { content: [{ type: "text", text: text.slice(0, Math.min(text.length, 4096)) }], isError: false };
  const error = {
    content: [{ type: "text", text: "Error: deterministic completion failure\n" + text }],
    details: { ...details, exitCode: 1 },
    isError: true,
  };
  return { code, args, result, partial, error, tasks };
}

/** Sequential ownership required: SDK/activity adapters are process-global, restored by dispose. */
export function createToolWorkload(input: ToolWorkloadOptions): ToolWorkload {
  const options = { historySize: 8, columns: 100, rows: 32, initialArgs: "empty" as const, ...input };
  if (!["empty", "complete"].includes(options.initialArgs)) throw new Error("Unknown initialArgs mode");
  if (!toolShapes.includes(options.shape)) throw new Error("Unknown tool shape");
  if (!Number.isInteger(options.historySize) || options.historySize < 0 || options.historySize > 1000)
    throw new Error("historySize must be 0..1000 settled executes");
  if (
    !Number.isInteger(options.columns) ||
    options.columns < 24 ||
    options.columns > 240 ||
    !Number.isInteger(options.rows) ||
    options.rows < 8 ||
    options.rows > 100
  )
    throw new Error("Bounded terminal dimensions required");
  const data = payload(options.shape); // Prebuilt SDK event inputs. Not timed, no network.
  const content: ToolSample["content"] = {
    hash: fingerprint(JSON.stringify({ options, ...data })),
    codeBytes: Buffer.byteLength(data.code),
    argsBytes: Buffer.byteLength(JSON.stringify(data.args)),
    resultBytes: Buffer.byteLength(JSON.stringify(data.result)),
    imageBytes: data.result.content
      .filter((part) => part.type === "image")
      .reduce((sum, part) => sum + Buffer.from(part.data ?? "", "base64").length, 0),
    outputBytes: Buffer.byteLength(
      data.result.content
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n"),
    ),
    resultBlocks: data.result.content.length,
    taskRows: data.tasks.length,
    renderer: options.shape === "sdk-json-args" ? "sdk-generic" : "registered-execute",
    imageProcessing: options.shape === "png-image" ? "synchronous-png-kitty" : "none",
  };
  const cleanups: Array<() => void> = [];
  let terminal: FakeTerminal, tui: TuiAltScreen, chat: Container, scroll: ScrollView, profiler: TerminalProfiler;
  let activity: ActivityController;
  let live: ToolExecutionComponent | undefined;
  let definition: ToolDefinition | undefined;
  let work = freshWork();
  let previous: string[] = [],
    document: string[] = [];
  let stopAnimations = () => {};
  const entries: Array<{
    type: string;
    id: string;
    message: { role: string; content?: Array<{ type: string; id: string }>; toolCallId?: string; details?: unknown };
  }> = [];
  const rows: TaskRow[] = [];
  let ready = false;
  let expanded = false;
  // SDK Kitty IDs use Math.random. One image, no real terminal: freeze only during
  // synchronous fixture calls, restore immediately (never across an await).
  function stableImageId(fn: () => void) {
    if (options.shape !== "png-image") return fn();
    const random = Math.random;
    Math.random = () => 0.25;
    try {
      return fn();
    } finally {
      Math.random = random;
    }
  }
  function measure(segments: SyncSegment[], name: string, fn: () => void) {
    const start = performance.now();
    try {
      stableImageId(fn);
    } finally {
      segments.push({ name, durationMs: performance.now() - start });
    }
  }
  function observe(component: ToolExecutionComponent) {
    const render = component.render;
    component.render = function (width) {
      work.componentRenders++;
      return render.call(this, width);
    };
    return component;
  }
  function construct(id: string, args: unknown, generic = false) {
    work.constructions++;
    return observe(
      new ToolExecutionComponent(
        generic ? "fixture-generic" : "execute",
        id,
        args,
        { showImages: true },
        generic ? undefined : definition,
        tui,
        "/terminal-tool-fixture",
      ),
    );
  }
  function capture(stage: ToolSample["stage"], segments: SyncSegment[]): ToolSample {
    const start = performance.now();
    stableImageId(() => tui.renderNow());
    const renderDrainMs = performance.now() - start;
    // Freeze the real registered preview's timers between actions. No global timer mocks.
    // This agent_end cleanup is OUTSIDE the mutation/frame CPU samples.
    stopAnimations();
    const snapshot = profiler.snapshot();
    const frames = snapshot.frames;
    const screenLines = tui.getScreenLines();
    let changedRows = 0;
    for (let i = 0; i < Math.max(previous.length, screenLines.length); i++)
      if (previous[i] !== screenLines[i]) changedRows++;
    previous = screenLines.slice();
    const output = terminal.takeOutput();
    const counts = { ...work };
    return {
      stage,
      segments,
      mutationMs: segments.reduce((sum, s) => sum + s.durationMs, 0),
      frames,
      renderDrainMs,
      output: output.output,
      screenLines,
      outputBytes: Buffer.byteLength(output.output),
      outputWrites: output.writes,
      outsideFrameOutputBytes: snapshot.outsideFrameOutputBytes,
      outsideFrameWriteCount: snapshot.outsideFrameWriteCount,
      outputHash: fingerprint(output.output),
      screenHash: fingerprint(screenLines.join("\n")),
      renderedDocumentHash: fingerprint(document.join("\n")),
      renderedDocumentLines: document.length,
      changedRows,
      work: counts,
      workHash: fingerprint(JSON.stringify(counts)),
      content,
    };
  }
  const fixture: ToolWorkload = {
    version: 1,
    name: "tools/" + options.shape + "/" + options.historySize,
    options,
    content,
    setup() {
      if (ready || active) throw new Error("Tool fixtures require sequential setup/dispose");
      active = fixture;
      work = freshWork();
      expanded = false;
      const segments: SyncSegment[] = [];
      try {
        measure(segments, "initialize-and-install-adapters", () => {
          const prior = process.env.PI_PACKAGE_DIR;
          delete process.env.PI_PACKAGE_DIR;
          try {
            initTheme("dark", false);
          } finally {
            if (prior !== undefined) process.env.PI_PACKAGE_DIR = prior;
          }
          const caps = getCapabilities();
          setCapabilities({ ...caps, images: options.shape === "png-image" ? "kitty" : null });
          cleanups.push(() => setCapabilities(caps));
          terminal = new FakeTerminal(options.columns, options.rows);
          tui = new TuiAltScreen(terminal, false, undefined, { mouse: false });
          cleanups.push(() => tui.stop());
          const request = tui.requestRender.bind(tui);
          tui.requestRender = (force = false) => {
            work.renderRequests++;
            request(force);
          };
          profiler = attachTerminalProfiler(tui, { capacity: 4 });
          cleanups.push(() => profiler.dispose());
          const listeners = new Map<string, Array<() => void>>();
          registerExecuteTool(
            {
              on: (event: string, callback: () => void) => {
                listeners.set(event, [...(listeners.get(event) ?? []), callback]);
              },
              registerTool: (tool: ToolDefinition) => {
                definition = tool;
              },
            } as unknown as ExtensionAPI,
            undefined,
            undefined,
            () => 0,
          );
          stopAnimations = () => {
            for (const fn of listeners.get("agent_end") ?? []) fn();
          };
          cleanups.push(() => stopAnimations());
          cleanups.push(installConversationDensity());
          cleanups.push(
            installSdkTaskRows(themeModule.theme, () => {
              work.snapshotCalls++;
              work.snapshotRows += rows.length;
              return rows;
            }),
          );
          chat = new Container();
          const render = chat.render;
          chat.render = function (width) {
            work.documentRenders++;
            document = render.call(this, width);
            return document;
          };
        });
        measure(segments, "construct-settled-history", () => {
          for (let i = 0; i < options.historySize; i++) {
            const id = "settled-" + i;
            if (i % 4 === 0) {
              chat.addChild(new UserMessageComponent("Inspect fixture module " + i));
              entries.push({ type: "message", id: "user-" + i, message: { role: "user" } });
            }
            const component = construct(id, { label: "Inspect module " + i, code: 'console.log("settled evidence")' });
            component.markExecutionStarted();
            work.starts++;
            const row: TaskRow = {
              id: "history-task-" + i,
              source: "local",
              sourceCallId: id,
              title: "Module " + i,
              status: "succeeded",
              terminal: true,
              exitCode: 0,
            };
            rows.push(row);
            component.updateResult({
              content: [{ type: "text", text: "Settled fixture evidence" }],
              details: { exitCode: 0, taskRows: [row] },
              isError: false,
            });
            work.updateResult++;
            chat.addChild(component);
            entries.push(
              { type: "message", id, message: { role: "assistant", content: [{ type: "toolCall", id }] } },
              {
                type: "message",
                id: "result-" + id,
                message: { role: "toolResult", toolCallId: id, details: { taskRows: [row] } },
              },
            );
          }
          chat.addChild(new UserMessageComponent("Run the measured tool interaction."));
          entries.push({ type: "message", id: "live-user", message: { role: "user" } });
        });
        measure(segments, "attach-activity-and-layout", () => {
          scroll = new ScrollView(chat, { primary: true, follow: "end", scrollbar: "hidden" });
          activity = new ActivityController({
            chatContainer: chat,
            renderer: tui,
            ui: tui,
            transcriptScrollView: scroll,
            sessionManager: {
              getBranch: () => {
                work.branchCalls++;
                work.branchEntries += entries.length;
                return entries.slice();
              },
              getSessionFile: () => "/terminal-tool-fixture",
            },
          });
          activity.attach();
          cleanups.push(() => activity.dispose());
          const input = new Input({ prompt: "bruv> " });
          tui.setLayoutRoot(
            new VStack([
              { component: scroll, grow: 1, minSize: 1 },
              { component: input, basis: 1, shrink: 0 },
            ]),
          );
          tui.setFocus(input);
          tui.start();
        });
        ready = true;
        return capture("setup", segments);
      } catch (error) {
        fixture.dispose();
        throw error;
      }
    },
    action(stage) {
      if (!ready) throw new Error("Call setup() first");
      if (!toolStages.includes(stage)) throw new Error("Unknown tool stage");
      if (stage === "construct" ? !!live : !live) throw new Error("Construct exactly one live tool before mutations");
      profiler.clear();
      terminal.takeOutput();
      work = freshWork();
      const segments: SyncSegment[] = [];
      switch (stage) {
        case "construct":
          measure(segments, "ToolExecutionComponent.constructor", () => {
            live = construct(
              "live-call",
              options.initialArgs === "complete"
                ? data.args
                : options.shape === "sdk-json-args"
                  ? { items: [] }
                  : { label: "Inspect " + options.shape, code: "" },
              options.shape === "sdk-json-args",
            );
          });
          measure(segments, "publish-tool-and-branch", () => {
            chat.addChild(live!);
            entries.push({
              type: "message",
              id: "live-assistant",
              message: { role: "assistant", content: [{ type: "toolCall", id: "live-call" }] },
            });
          });
          break;
        case "args-stream":
          measure(segments, "ToolExecutionComponent.updateArgs(stream)", () => {
            work.updateArgs++;
            live!.updateArgs(
              options.shape === "sdk-json-args"
                ? { items: data.args.items.slice(0, 256) }
                : { label: "Inspect " + options.shape, code: data.code.slice(0, Math.ceil(data.code.length / 2)) },
            );
          });
          break;
        case "args-complete":
          measure(segments, "ToolExecutionComponent.updateArgs(complete)", () => {
            work.updateArgs++;
            live!.updateArgs(data.args);
          });
          measure(segments, "ToolExecutionComponent.setArgsComplete", () => {
            work.argsComplete++;
            live!.setArgsComplete();
          });
          break;
        case "start":
          measure(segments, "ToolExecutionComponent.markExecutionStarted", () => {
            work.starts++;
            live!.markExecutionStarted();
          });
          break;
        case "partial":
          measure(segments, "ToolExecutionComponent.updateResult(partial)", () => {
            work.updateResult++;
            live!.updateResult(data.partial, true);
          });
          break;
        case "complete":
        case "error":
          measure(segments, "ToolExecutionComponent.updateResult(" + stage + ")", () => {
            work.updateResult++;
            live!.updateResult(stage === "error" ? data.error : data.result, false);
          });
          measure(segments, "publish-result-and-task-snapshot", () => {
            rows.splice(options.historySize, rows.length, ...data.tasks);
            const entry = {
              type: "message",
              id: "live-result",
              message: {
                role: "toolResult",
                toolCallId: "live-call",
                details: stage === "error" ? data.error.details : data.result.details,
              },
            };
            const index = entries.findIndex((entry) => entry.id === "live-result");
            if (index < 0) entries.push(entry);
            else entries[index] = entry;
          });
          break;
        case "reveal":
        case "collapse":
          measure(segments, "ActivityController.sync", () => activity.sync());
          measure(segments, "ActivityController.toggleDetails/withAnchor", () => {
            const group = activity.groups.find((group) => group.tools.includes(live!));
            if (!group) throw new Error("Live activity group not found");
            if (expanded !== (stage === "reveal")) {
              work.expansions++;
              activity.toggleDetails(group, live!);
              expanded = stage === "reveal";
            }
          });
          break;
      }
      measure(segments, "request-following-frame", () => tui.requestRender());
      return capture(stage, segments);
    },
    dispose() {
      while (cleanups.length) cleanups.pop()?.();
      ready = false;
      live = undefined;
      previous = [];
      document = [];
      entries.length = 0;
      rows.length = 0;
      if (active === fixture) active = undefined;
    },
  };
  return fixture;
}

/** A bounded default suite: all shapes at short history, selected scans at scale. No timing gates. */
export function createToolWorkloads(): ToolWorkload[] {
  return [
    ...toolShapes.map((shape) => createToolWorkload({ shape, historySize: 8 })),
    ...(["short", "task-rows", "code-preview"] as const).map((shape) =>
      createToolWorkload({ shape, historySize: 100 }),
    ),
  ];
}

/** Repeat cold lifecycles, never store a growing transcript. CPU clocks are observational only. */
export function runToolProbe(options: ToolWorkloadOptions, repetitions = 3) {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 20)
    throw new Error("repetitions must be 1..20");
  const runs: Array<{ repetition: number; samples: ToolSample[] }> = [];
  for (let repetition = 0; repetition < repetitions; repetition++) {
    const fixture = createToolWorkload(options);
    try {
      const samples = [fixture.setup()];
      const stages =
        options.initialArgs === "complete"
          ? toolStages.filter((stage) => stage !== "args-stream" && stage !== "args-complete")
          : toolStages;
      for (const stage of stages) samples.push(fixture.action(stage));
      runs.push({ repetition, samples });
    } finally {
      fixture.dispose();
    }
  }
  return {
    fixtureVersion: 1,
    options,
    repetitions,
    scope:
      "Prebuilt provider-free SDK event inputs; exclusive synchronous mutation segments + full doRender frames. renderNow drains manually; requestDelayMs is not a scheduler responsiveness result. No network/provider wait. PNG Kitty only; non-PNG transcoding unmeasured.",
    runs,
  };
}

// Standalone evidence writer; does not modify the shared runner/report schema.
if (import.meta.main) {
  const args = process.argv.slice(2);
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (
      !["--shape", "--history", "--repetitions", "--initial-args", "--out"].includes(args[i]!) ||
      args[i + 1] === undefined
    )
      throw new Error(
        "Usage: bun scripts/terminal-perf/tool-workloads.ts --shape single-line --history 8 --repetitions 3 --initial-args empty --out artifacts/terminal-perf/tools/run.json",
      );
    flags.set(args[i]!, args[i + 1]!);
  }
  const options: ToolWorkloadOptions = {
    shape: (flags.get("--shape") ?? "short") as ToolShape,
    historySize: Number(flags.get("--history") ?? 8),
    initialArgs: (flags.get("--initial-args") ?? "empty") as "empty" | "complete",
  };
  const sourceFiles = [
    "scripts/terminal-perf/tool-workloads.ts",
    "scripts/terminal-perf/workloads.ts",
    "scripts/terminal-perf/profiler.ts",
    "src/typescript/extension.ts",
    "src/ui/execution-previews.ts",
    "src/ui/rolling-activity.ts",
    "src/ui/sdk-task-rows.ts",
    "src/ui/task-rows.ts",
    "src/ui/conversation-density.ts",
    "bun.lock",
    "patches/@earendil-works%2Fpi-coding-agent@1.1.0.patch",
    "patches/@earendil-works%2Fpi-tui@1.1.0.patch",
    join(sdkDir, "modes/interactive/components/tool-execution.js"),
  ];
  const sourceHashes: Record<string, string> = {};
  for (const file of sourceFiles) sourceHashes[file] = fingerprint(await Bun.file(file).text());
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const metadata = {
    at: new Date().toISOString(),
    commit: git("rev-parse", "HEAD"),
    dirty: git("status", "--porcelain"),
    bun: Bun.version,
    sdk: "1.1.0",
    machine: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model, cpuCount: cpus().length },
    sourceHashes,
  };
  const result = { metadata, ...runToolProbe(options, Number(flags.get("--repetitions") ?? 3)) };
  const output = flags.get("--out") ?? "artifacts/terminal-perf/tools/run.json";
  await Bun.write(output, JSON.stringify(result, null, 2) + "\n");
  console.log(
    JSON.stringify({
      output,
      options,
      samples: result.runs.reduce((sum, run) => sum + run.samples.length, 0),
      maxMutationMs: Math.max(
        ...result.runs.flatMap((run) =>
          run.samples.filter((sample) => sample.stage !== "setup").map((sample) => sample.mutationMs),
        ),
      ),
      maxFrameMs: Math.max(
        ...result.runs.flatMap((run) =>
          run.samples.flatMap((sample) => sample.frames.map((frame) => frame.durationMs)),
        ),
      ),
    }),
  );
}
