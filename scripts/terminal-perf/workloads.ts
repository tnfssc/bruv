/** Bounded, provider-free fixtures for pi-tui 1.1.0's full layout/diff/write path. */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  initTheme,
  type Theme,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  Input,
  ScrollView,
  type Terminal,
  TuiAltScreen,
  VStack,
} from "@earendil-works/pi-tui";
import { installConversationDensity } from "../../src/ui/conversation-density";
import {
  completionPreview,
  executeInputPreview,
  executeOutputPreview,
  type ExecutePreviewState,
} from "../../src/ui/execution-previews";
import { ActivityController } from "../../src/ui/rolling-activity";
import { installSdkTaskRows } from "../../src/ui/sdk-task-rows";
import type { TaskRow } from "../../src/ui/task-rows";

// The SDK does not export its current Theme instance. Resolve the pinned package,
// not a second copy of it; actual SDK components and Bruv previews share this theme.
const sdkDirectory = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const themeModule = (await import(pathToFileURL(join(sdkDirectory, "modes/interactive/theme/theme.js")).href)) as {
  theme: Theme;
};

export const workloadModes = ["input", "animation", "streaming", "resize", "scrollback", "task-update"] as const;
export type WorkloadMode = (typeof workloadModes)[number];
export type WorkloadOptions = {
  /** Number of settled executes AND typed tasks, not number of visible rows. */
  sizes?: readonly number[];
  modes?: readonly WorkloadMode[];
  columns?: number;
  rows?: number;
  /** Runs before start/first render so a profiler can capture the cold frame. */
  onTuiReady?: (tui: TuiAltScreen, document: Container) => void;
};
export type WorkCounts = {
  frames: number;
  documentRenders: number;
  documentLines: number;
  componentRenders: number;
  componentLines: number;
  branchCalls: number;
  branchEntries: number;
  snapshotCalls: number;
  snapshotRows: number;
  renderRequests: number;
};
export type WorkloadSample = {
  iteration: number;
  mutations: number;
  outputBytes: number;
  outputWrites: number;
  outputHash: string;
  screenHash: string;
  screenChanged: boolean;
  changedRows: number;
  /** Only the current frame's terminal writes; no ever-growing transcript. */
  output: string;
  work: WorkCounts;
};
export type TerminalWorkload = {
  name: string;
  mode: WorkloadMode;
  size: number;
  description: string;
  /** Prototype adapters are process-global. Set up/run/dispose ONE fixture at a time. */
  setup(): WorkloadSample;
  /** Mutates fixture state and calls TuiAltScreen.renderNow(), never isolated render(). */
  step(): WorkloadSample;
  dispose(): void;
};

/** Captures ANSI output and supplies real TUI input/resize callbacks, never touches stdio. */
export class FakeTerminal implements Terminal {
  kittyProtocolActive = false;
  private onInput?: (data: string) => void;
  private onResize?: () => void;
  private writes: string[] = [];
  constructor(
    public columns = 100,
    public rows = 32,
  ) {}
  start(onInput: (data: string) => void, onResize: () => void): void {
    this.onInput = onInput;
    this.onResize = onResize;
  }
  stop(): void {
    this.onInput = undefined;
    this.onResize = undefined;
  }
  async drainInput(): Promise<void> {}
  write(data: string): void {
    this.writes.push(data);
  }
  input(data: string): void {
    this.onInput?.(data);
  }
  resize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.onResize?.();
  }
  takeOutput(): { output: string; writes: number } {
    const result = { output: this.writes.join(""), writes: this.writes.length };
    this.writes = [];
    return result;
  }
  moveBy(lines: number): void {
    if (lines) this.write(`\x1b[${Math.abs(lines)}${lines > 0 ? "B" : "A"}`);
  }
  hideCursor(): void {
    this.write("\x1b[?25l");
  }
  showCursor(): void {
    this.write("\x1b[?25h");
  }
  clearLine(): void {
    this.write("\x1b[2K");
  }
  clearFromCursor(): void {
    this.write("\x1b[J");
  }
  clearScreen(): void {
    this.write("\x1b[2J");
  }
  setProgramStatus() {}
  setTitle(title: string): void {
    this.write(`\x1b]0;${title}\x07`);
  }
  setProgress(_active: boolean): void {}
}

const freshWork = (): WorkCounts => ({
  frames: 0,
  documentRenders: 0,
  documentLines: 0,
  componentRenders: 0,
  componentLines: 0,
  branchCalls: 0,
  branchEntries: 0,
  snapshotCalls: 0,
  snapshotRows: 0,
  renderRequests: 0,
});
function hash(text: string): string {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return (value >>> 0).toString(16).padStart(8, "0");
}

let activeWorkload: TerminalWorkload | undefined;
function createWorkload(
  mode: WorkloadMode,
  size: number,
  columns: number,
  rows: number,
  onTuiReady?: (tui: TuiAltScreen, document: Container) => void,
): TerminalWorkload {
  let runtime:
    | {
        terminal: FakeTerminal;
        tui: TuiAltScreen;
        scroll: ScrollView;
        liveTool: ToolExecutionComponent;
        liveRow: TaskRow;
        previewState: ExecutePreviewState;
      }
    | undefined;
  const cleanups: Array<() => void> = [];
  let counts = freshWork();
  let previousScreen: string[] = [];
  let iteration = 0;
  let documentLines = 0;

  // Fixture contents have no adapter or terminal lifetime of their own. setup()
  // installs the global adapters before constructing these SDK components.
  function buildConversation(theme: Theme, tui: TuiAltScreen, taskRows: TaskRow[]) {
    const chat = new Container();
    const entries: Array<{
      type: string;
      id?: string;
      message?: {
        role: string;
        content?: Array<{ type: string; id: string }>;
        toolCallId?: string;
        details?: unknown;
      };
    }> = [];
    const add = (component: Component) => {
      chat.addChild(component);
      // Count calls AFTER SDK adaptation, not instead of its wrapper.
      const render = component.render;
      component.render = function (width) {
        counts.componentRenders++;
        const lines = render.call(this, width);
        counts.componentLines += lines.length;
        return lines;
      };
    };
    const tool = (id: string, label: string, state: ExecutePreviewState) =>
      new ToolExecutionComponent(
        "execute",
        id,
        { label, code: 'console.log("deterministic fixture")' },
        { showImages: false },
        {
          renderShell: "self",
          renderCall: (args, _theme, context) => {
            const call = args as { code: string; label?: string };
            return executeInputPreview(call.code, context.expanded, theme, state, 0, call.label);
          },
          renderResult: (result, options, _theme, context) =>
            executeOutputPreview(result, options.expanded, context.isError, theme, undefined, state),
        },
        tui,
        process.cwd(),
      );
    for (let index = 0; index < size; index++) {
      const callId = `settled-call-${index}`;
      // A new turn every four calls keeps groups realistic while exposing scans
      // across many settled components. All bodies and evidence are bounded.
      if (index % 4 === 0) {
        entries.push({ type: "message", id: `user-${index}`, message: { role: "user" } });
        add(new UserMessageComponent(`Audit module ${index} and preserve its task provenance.`));
        add(
          new AssistantMessageComponent(
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text:
                    "### Module " +
                    index +
                    "\n\nMeasured fixture evidence:\n\n- task ownership retained\n- resize and scrolling retained",
                },
              ],
            } as never,
            false,
          ),
        );
      }
      entries.push({
        type: "message",
        id: `assistant-${index}`,
        message: { role: "assistant", content: [{ type: "toolCall", id: callId }] },
      });
      const row: TaskRow = {
        id: `task-${index}`,
        source: index % 3 === 0 ? "local" : index % 3 === 1 ? "native" : "ssh",
        sourceCallId: callId,
        title: `Check module ${index}`,
        status: index % 11 === 0 ? "failed" : "succeeded",
        terminal: true,
        exitCode: index % 11 === 0 ? 1 : 0,
      };
      taskRows.push(row);
      const settled = tool(callId, `Inspect module ${index}`, {});
      const details = { taskRows: [row], exitCode: row.exitCode, backgroundJobs: [], images: [] };
      settled.markExecutionStarted();
      settled.updateResult({
        content: [{ type: "text", text: `Fixture output ${index}\nTwo bounded evidence lines.` }],
        details,
        isError: row.status === "failed",
      });
      add(settled);
      entries.push({
        type: "message",
        id: `result-${index}`,
        message: { role: "toolResult", toolCallId: callId, details },
      });
      if (index % 4 === 0) {
        add(
          new CustomMessageComponent(
            {
              role: "custom",
              customType: "task-complete",
              content: `Recorded module ${index}`,
              details,
              display: true,
            } as never,
            (message, options) =>
              completionPreview(
                message.content,
                options.expanded,
                theme,
                options.outputPad,
                "task-complete",
                message.details,
              ),
          ),
        );
      }
    }
    entries.push({ type: "message", id: "live-user", message: { role: "user" } });
    add(new UserMessageComponent("Continue the measured terminal fixture."));
    entries.push({
      type: "message",
      id: "live-assistant",
      message: { role: "assistant", content: [{ type: "toolCall", id: "live-call" }] },
    });
    const previewState: ExecutePreviewState = { spinnerFrame: 0 };
    const liveTool = tool("live-call", "Measure live output", previewState);
    liveTool.markExecutionStarted();
    const liveRow: TaskRow = {
      id: "live-task",
      source: "native",
      sourceCallId: "live-call",
      title: "Live measured task",
      status: "running",
      terminal: false,
    };
    if (mode === "task-update") {
      taskRows.push(liveRow);
      liveTool.updateResult(
        {
          content: [{ type: "text", text: "Live task evidence" }],
          details: { taskRows: [liveRow] },
          isError: false,
        },
        true,
      );
    } else if (mode === "streaming") {
      liveTool.updateResult({ content: [{ type: "text", text: "stream chunk 0" }], isError: false }, true);
      liveTool.setExpanded(true);
    } else {
      // Exercise the real execute preview spinner, advanced manually (no timers).
      liveTool.setExpanded(mode !== "animation");
    }
    add(liveTool);
    // Collapsed rolling headers do not expose the execute spinner. Keep the
    // animation call native: its own group remains collapsed but rendered
    // through a direct SDK component after the historical rolling document.
    if (mode === "animation") chat.removeChild(liveTool);
    return { chat, entries, liveTool, liveRow, previewState };
  }

  // The cold screen is compared with [], then each step with the preceding screen.
  // Drain writes only here so every sample has the same bounded output boundary.
  function captureFrame(tui: TuiAltScreen, terminal: FakeTerminal, mutations: number): WorkloadSample {
    counts.frames++;
    const screen = tui.getScreenLines();
    let changedRows = 0;
    for (let row = 0; row < Math.max(previousScreen.length, screen.length); row++)
      if (previousScreen[row] !== screen[row]) changedRows++;
    previousScreen = screen;
    const { output, writes } = terminal.takeOutput();
    return {
      iteration,
      mutations,
      outputBytes: Buffer.byteLength(output),
      outputWrites: writes,
      outputHash: hash(output),
      screenHash: hash(screen.join("\n")),
      screenChanged: changedRows > 0,
      changedRows,
      output,
      work: { ...counts },
    };
  }
  const fixture: TerminalWorkload = {
    name: `long-thread/${mode}/${size}`,
    mode,
    size,
    description:
      size +
      " settled executes with typed local/native/SSH task rows, real SDK messages, rolling activity and density; " +
      mode +
      " frame",
    setup() {
      if (runtime || activeWorkload) throw new Error("Terminal workloads must be set up and disposed sequentially");
      activeWorkload = fixture;
      try {
        const priorPackageDir = process.env.PI_PACKAGE_DIR;
        delete process.env.PI_PACKAGE_DIR;
        try {
          initTheme("dark", false);
        } finally {
          if (priorPackageDir !== undefined) process.env.PI_PACKAGE_DIR = priorPackageDir;
        }
        const theme = themeModule.theme;
        const terminal = new FakeTerminal(columns, rows);
        const tui = new TuiAltScreen(terminal, false, undefined, { mouse: false });
        cleanups.push(() => tui.stop());
        // Public renderNow() synchronously drains scheduled requests. Tracking requests
        // separately distinguishes a real rendered frame from scheduler/no-op timing.
        const requestRender = tui.requestRender.bind(tui);
        tui.requestRender = (force = false) => {
          counts.renderRequests++;
          requestRender(force);
        };
        const taskRows: TaskRow[] = [];
        cleanups.push(installConversationDensity());
        cleanups.push(
          installSdkTaskRows(theme, () => {
            counts.snapshotCalls++;
            counts.snapshotRows += taskRows.length;
            return taskRows;
          }),
        );
        const { chat, entries, liveTool, liveRow, previewState } = buildConversation(theme, tui, taskRows);
        const scroll = new ScrollView(chat, { primary: true, follow: "end", scrollbar: "hidden" });
        const input = new Input({ prompt: "bruv> " });
        const activity = new ActivityController({
          chatContainer: chat,
          renderer: tui,
          ui: tui,
          transcriptScrollView: scroll,
          sessionManager: {
            getBranch: () => {
              counts.branchCalls++;
              counts.branchEntries += entries.length;
              return entries.slice();
            },
            getSessionFile: () => "/terminal-perf-fixture",
          },
        });
        activity.attach();
        cleanups.push(() => activity.dispose());
        const renderChat = chat.render;
        chat.render = function (width) {
          counts.documentRenders++;
          const lines = renderChat.call(this, width);
          counts.documentLines += lines.length;
          documentLines = lines.length;
          return lines;
        };
        const root = new VStack([
          { component: scroll, grow: 1, minSize: 1 },
          ...(mode === "animation" ? [{ component: liveTool, basis: "auto" as const, shrink: 0 }] : []),
          { component: input, basis: 1, shrink: 0 },
        ]);
        tui.setLayoutRoot(root);
        tui.setFocus(input);
        counts = freshWork();
        iteration = 0;
        onTuiReady?.(tui, chat);
        tui.start();
        tui.renderNow();
        const mount = captureFrame(tui, terminal, 0);
        counts = freshWork();
        runtime = { terminal, tui, scroll, liveTool, liveRow, previewState };
        return mount;
      } catch (error) {
        fixture.dispose();
        throw error;
      }
    },
    step() {
      if (!runtime) throw new Error("Call workload.setup() before step()");
      const { terminal, tui, scroll, liveTool, liveRow, previewState } = runtime;
      counts = freshWork();
      iteration++;
      switch (mode) {
        case "input":
          terminal.input("\x15"); // Ctrl-U, bounded input via the actual TUI dispatcher.
          terminal.input(String.fromCharCode(97 + (iteration % 26)));
          break;
        case "animation":
          previewState.spinnerFrame = iteration % 10;
          liveTool.invalidate();
          break;
        case "streaming":
          liveTool.updateResult(
            {
              content: [
                {
                  type: "text",
                  text: Array.from({ length: 8 }, (_, line) => `stream chunk ${iteration} line ${line}`).join("\n"),
                },
              ],
              isError: false,
            },
            true,
          );
          break;
        case "resize":
          terminal.resize(iteration % 2 ? columns - 11 : columns, iteration % 2 ? rows - 3 : rows);
          break;
        case "scrollback":
          scroll.scrollTo(iteration % 2 ? 0 : Math.max(0, documentLines - rows + 1));
          break;
        case "task-update":
          liveRow.status = iteration % 2 ? "succeeded" : "running";
          liveRow.terminal = iteration % 2 === 1;
          liveRow.title = `Live measured task ${iteration}`;
          liveTool.updateResult(
            {
              content: [{ type: "text", text: "Live task evidence" }],
              details: { taskRows: [liveRow] },
              isError: false,
            },
            true,
          );
          break;
      }
      tui.renderNow();
      return captureFrame(tui, terminal, mode === "input" ? 2 : 1);
    },
    dispose() {
      while (cleanups.length) cleanups.pop()?.();
      runtime = undefined;
      previousScreen = [];
      if (activeWorkload === fixture) activeWorkload = undefined;
    },
  };
  return fixture;
}

export function createWorkloads(options: WorkloadOptions = {}): TerminalWorkload[] {
  const sizes = options.sizes ?? [100, 500, 1000];
  const modes = options.modes ?? workloadModes;
  const columns = options.columns ?? 100;
  const rows = options.rows ?? 32;
  if (!Number.isInteger(columns) || columns < 24 || !Number.isInteger(rows) || rows < 8)
    throw new Error("Terminal dimensions must be integer columns >= 24 and rows >= 8");
  if (sizes.some((size) => !Number.isInteger(size) || size < 1))
    throw new Error("Workload sizes must be positive integers");
  if (modes.some((mode) => !workloadModes.includes(mode))) throw new Error("Unknown terminal workload mode");
  return sizes.flatMap((size) => modes.map((mode) => createWorkload(mode, size, columns, rows, options.onTuiReady)));
}
