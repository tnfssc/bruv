/** Independent provider-free navigation probes. No renderNow(): inputs use Pi's scheduler. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  AssistantMessageComponent,
  UserMessageComponent,
  ToolExecutionComponent,
  createBashToolDefinition,
  SessionManager,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import { KeybindingsManager } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { Container, ScrollView, TuiAltScreen, VStack, getKeybindings, type Component } from "@earendil-works/pi-tui";
import * as themeModule from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { CompactEditor } from "../../src/ui/editor";
import { renderCompactFooter } from "../../src/ui/footer";
import { TaskMonitorPanel } from "../../src/ui/task-monitor";
import type { TaskMonitorSource, MonitorTask } from "../../src/tasks/task-monitor-source";
import { LiveWaveform } from "../../src/live/waveform";
import {
  installDiskBackedSessionManager,
  disposeDiskBackedSessionManager,
  getDiskBackedEntryMetadata,
} from "../../src/history/session-manager";
import { attachTerminalProfiler, type TerminalFrameSample } from "./profiler";

import { createNavigationHistory } from "./navigation-history";
import { runOfflineNavigationSdkProbe } from "./navigation-sdk-probe";
import { NavigationTerminal } from "./navigation-terminal";

// Public entrypoint for both probes; the scheduled component owner below does not own SDK teardown.
export { createNavigationHistory } from "./navigation-history";
export { runOfflineNavigationSdkProbe } from "./navigation-sdk-probe";

export const navigationModes = [
  "scroll-page",
  "scroll-wheel",
  "search",
  "tool-detail",
  "editor-expand",
  "editor-paste",
  "resize",
  "mouse-selection",
  "task-picker",
  "theme",
  "footer",
  "live-wave",
  "session-reopen",
  "branch-switch",
] as const;
export type NavigationMode = (typeof navigationModes)[number];
export type SyncSegment = { name: string; durationMs: number; startedAtMs: number };
export type NavigationSample = {
  mode: NavigationMode;
  size: number;
  iteration: number;
  /** Each actual sync call is measured independently; no awaited time included. */
  segments: SyncSegment[];
  /** Entire synchronous action callback, including fixture dispatch overhead. */
  synchronousMs: number;
  observedSegmentMs: number;
  /** Action entry to last observed frame return, includes waiting; NOT CPU duration. */
  actionToFrameCompleteMs: number;
  /** Action RETURN to frame ENTRY; excludes dispatch/mutation CPU. Null for inline frames. */
  schedulerDelayMs: number | null;
  frames: TerminalFrameSample[];
  work: {
    inputDispatches: number;
    documentRenders: number;
    componentRenders: number;
    branchCalls: number;
    branchEntries: number;
    materializedMessages: number;
    historyBytes: number;
  };
  contentHash: string;
  screenHash: string;
  outputHash: string;
  changedRows: number;
  outputBytes: number;
  outputWrites: number;
  state: {
    scrollTop: number;
    editorTextHash: string;
    editorCharacters: number;
    editorLines: number;
    searchMatches: number;
    hasSelection: boolean;
    toolExpanded: boolean;
    leafId: string | null;
    diskBacked: boolean;
  };
};
export type NavigationOptions = {
  modes?: readonly NavigationMode[];
  sizes?: readonly number[];
  columns?: number;
  rows?: number;
  pasteCharacters?: number;
  toolOutputLines?: number;
};
export type NavigationWorkload = {
  name: string;
  mode: NavigationMode;
  size: number;
  /** Measures real scheduled cold render; setup/mount work is deliberately NOT timed. */
  setup(): Promise<NavigationSample>;
  step(): Promise<NavigationSample>;
  dispose(): void;
};
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const timestamp = 1700000000000;

let active: NavigationWorkload | undefined;
function createNavigationWorkload(mode: NavigationMode, size: number, options: NavigationOptions): NavigationWorkload {
  let terminal: NavigationTerminal;
  let tui: TuiAltScreen;
  let document: Container;
  let scroll: ScrollView;
  let editor: CompactEditor;
  let tool: ToolExecutionComponent;
  let panel: TaskMonitorPanel | undefined;
  let overlay: ReturnType<TuiAltScreen["showOverlay"]> | undefined;
  let profiler: ReturnType<typeof attachTerminalProfiler>;
  let history: ReturnType<typeof createNavigationHistory>;
  let manager: SessionManager;
  let iteration = 0;
  let previous: string[] = [];
  let segments: SyncSegment[] = [];
  let work: NavigationSample["work"];
  let frameDone: (() => void) | undefined;
  let frameFailed: ((error: unknown) => void) | undefined;
  let lastFrameReturn = 0;
  let actionStarted = 0;
  let actionReturned = 0;
  let mounted = false;
  // themeModule.theme is a live proxy, not the concrete instance stored globally.
  // Saving that export and restoring it makes the proxy point to itself.
  const themeKey = Symbol.for("@earendil-works/pi-coding-agent:theme");
  const legacyThemeKey = Symbol.for("@mariozechner/pi-coding-agent:theme");
  let priorTheme: unknown;
  let hadPriorTheme = false;
  const changeTheme = (name: string) => {
    // Ignore bruv host asset override; source uses pinned SDK assets, compiled probes
    // require SDK theme/*.json beside the executable (documented in feature wisdom).
    const prior = process.env.PI_PACKAGE_DIR;
    delete process.env.PI_PACKAGE_DIR;
    try {
      const result = themeModule.setTheme(name, false);
      if (!result.success) throw new Error(result.error);
    } finally {
      if (prior !== undefined) process.env.PI_PACKAGE_DIR = prior;
    }
  };
  let wave = new LiveWaveform();
  let expanded = false;
  const pcm = Buffer.alloc(384, 70);
  const statuses = new Map<string, string>();
  const columns = options.columns ?? 80,
    rows = options.rows ?? 24;
  const reset = () => {
    segments = [];
    work = {
      inputDispatches: 0,
      documentRenders: 0,
      componentRenders: 0,
      branchCalls: 0,
      branchEntries: 0,
      materializedMessages: 0,
      historyBytes: history.bytes,
    };
    terminal.writes = [];
    profiler.clear();
  };
  const sync = <T>(name: string, fn: () => T): T => {
    const start = performance.now();
    try {
      return fn();
    } finally {
      segments.push({ name, startedAtMs: start, durationMs: performance.now() - start });
    }
  };
  const send = (data: string) =>
    sync("terminal.input", () => {
      work.inputDispatches++;
      terminal.send(data);
    });
  const add = (component: Component) => {
    const render = component.render.bind(component);
    component.render = (width) => {
      work.componentRenders++;
      return render(width);
    };
    document.addChild(component);
  };
  const populate = () => {
    work.branchCalls++;
    const branch = manager.getBranch();
    work.branchEntries += branch.length;
    document.clear();
    for (const entry of branch) {
      if (entry.type !== "message") continue;
      const message = entry.message;
      work.materializedMessages++;
      if (message.role === "user")
        add(
          new UserMessageComponent(
            typeof message.content === "string"
              ? message.content
              : message.content
                  .filter((c) => c.type === "text")
                  .map((c) => c.text)
                  .join("\n"),
          ),
        );
      else if (message.role === "assistant") add(new AssistantMessageComponent(message));
    }
    tool = new ToolExecutionComponent(
      "bash",
      "navigation-tool",
      { command: "printf navigation" },
      undefined,
      createBashToolDefinition(history.root),
      tui,
      history.root,
    );
    tool.setArgsComplete();
    tool.markExecutionStarted();
    tool.updateResult(
      {
        content: [
          {
            type: "text",
            text: Array.from({ length: options.toolOutputLines ?? 30 }, (_, i) => "tool output " + i + " needle").join(
              "\n",
            ),
          },
        ],
        isError: false,
      },
      false,
    );
    add(tool);
  };
  // Promise completion comes from the real doRender RETURN, never an arbitrary sleep/renderNow.
  const scheduled = async (action: () => void): Promise<NavigationSample> => {
    reset();
    const start = performance.now();
    actionStarted = start;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const done = new Promise<void>((resolve, reject) => {
      frameDone = resolve;
      frameFailed = reject;
      timeout = setTimeout(() => {
        frameDone = undefined;
        reject(new Error("No scheduled frame for " + mode));
      }, 2000);
    });
    try {
      action();
      actionReturned = performance.now();
      await done;
      return sample(performance.now() - start);
    } finally {
      clearTimeout(timeout);
      frameDone = undefined;
      frameFailed = undefined;
    }
  };
  const sample = (_elapsed: number): NavigationSample => {
    const screen = [...((tui as unknown as { previousScreen: string[] }).previousScreen ?? [])];
    const output = terminal.writes.join("");
    const changedRows = Array.from({ length: Math.max(previous.length, screen.length) }, (_, i) => i).filter(
      (i) => previous[i] !== screen[i],
    ).length;
    previous = screen;
    const frames = profiler.snapshot().frames;
    return {
      mode,
      size,
      iteration,
      segments: [...segments],
      synchronousMs: actionReturned - actionStarted,
      observedSegmentMs: segments.reduce((sum, s) => sum + s.durationMs, 0),
      actionToFrameCompleteMs: frames.length ? lastFrameReturn - actionStarted : _elapsed,
      schedulerDelayMs:
        frames[0] && frames[0].startedAtMs >= actionReturned ? frames[0].startedAtMs - actionReturned : null,
      frames,
      work: { ...work },
      contentHash: hash(
        JSON.stringify({
          history: history.contentHash,
          mode,
          size,
          columns,
          rows,
          pasteCharacters: options.pasteCharacters ?? 1024,
          toolLines: options.toolOutputLines ?? 30,
          taskRows: Math.max(2, size),
        }),
      ),
      screenHash: hash(screen.join("\n")),
      outputHash: hash(output),
      changedRows,
      outputBytes: Buffer.byteLength(output),
      outputWrites: terminal.writes.length,
      state: {
        scrollTop: scroll.scrollTop,
        editorTextHash: hash(editor.getExpandedText()),
        editorCharacters: editor.getExpandedText().length,
        editorLines: editor.getExpandedText().split("\n").length,
        searchMatches: (tui as unknown as { activeSearch?: { matches: unknown[] } }).activeSearch?.matches.length ?? 0,
        hasSelection: tui.hasActiveSelection(),
        toolExpanded: expanded,
        leafId: manager.getLeafId(),
        diskBacked: getDiskBackedEntryMetadata(manager) !== undefined,
      },
    };
  };
  const fixture: NavigationWorkload = {
    name: "navigation/" + mode + "/" + size,
    mode,
    size,
    async setup() {
      if (active) throw new Error("Navigation workloads must run sequentially");
      active = fixture;
      try {
        statuses.clear();
        wave = new LiveWaveform();
        expanded = false;
        const globals = globalThis as typeof globalThis & Record<symbol, unknown>;
        priorTheme = globals[themeKey];
        hadPriorTheme = Object.hasOwn(globals, themeKey);
        changeTheme("dark");
        installDiskBackedSessionManager(); // Production process-wide adapter, intentionally irreversible.
        history = createNavigationHistory(size);
        manager = SessionManager.open(history.file);
        manager.branch(history.primaryLeaf);
        terminal = new NavigationTerminal(columns, rows);
        tui = new TuiAltScreen(terminal, false, undefined, { mouse: true });
        document = new Container();
        const render = document.render.bind(document);
        document.render = (width) => {
          work.documentRenders++;
          return render(width);
        };
        scroll = new ScrollView(document, { follow: "end", primary: true, scrollbar: "hidden" });
        editor = new CompactEditor(
          tui,
          {
            borderColor: (text) => themeModule.theme.fg("dim", text),
            selectList: {
              selectedPrefix: (text) => themeModule.theme.fg("accent", text),
              selectedText: (text) => text,
              description: (text) => text,
              scrollInfo: (text) => text,
              noMatch: (text) => text,
            },
          },
          KeybindingsManager.create(history.root),
        );
        // Footer display cwd is synthetic and stable; history/context methods delegate to the real current disk manager.
        const footerManager = new Proxy(manager, {
          get(_target, key) {
            if (key === "getCwd") return () => "/offline-navigation";
            const value = Reflect.get(manager, key);
            return typeof value === "function" ? value.bind(manager) : value;
          },
        });
        const footerContext = {
          sessionManager: footerManager,
          getContextUsage: () => ({ percent: 1 }),
          model: { id: "offline" },
        } as unknown as ExtensionContext;
        const footerData = {
          getGitBranch: () => "main",
          getExtensionStatuses: () => statuses,
        } as unknown as ReadonlyFooterDataProvider;
        const footer: Component = {
          invalidate() {},
          render: (width) => {
            work.componentRenders++;
            return renderCompactFooter(footerContext, footerData, themeModule.theme, width);
          },
        };
        tui.setLayoutRoot(
          new VStack([
            { component: scroll, grow: 1, basis: 0, minSize: 0 },
            { component: editor, basis: "auto", shrink: 0 },
            { component: footer, basis: "auto", shrink: 0 },
          ]),
        );
        tui.setFocus(editor);
        profiler = attachTerminalProfiler(tui, {
          capacity: 64,
          observe: [{ target: document, method: "render", name: "navigation.document" }],
        });
        const target = tui as unknown as { doRender: () => void };
        const doRender = target.doRender.bind(tui);
        target.doRender = () => {
          try {
            doRender();
            lastFrameReturn = performance.now();
            frameDone?.();
          } catch (error) {
            if (frameFailed) frameFailed(error);
            else throw error;
          }
        };
        reset();
        populate();
        iteration = 0;
        previous = [];
        mounted = true;
        return await scheduled(() => tui.start());
      } catch (error) {
        fixture.dispose();
        throw error;
      }
    },
    async step() {
      if (!mounted) throw new Error("setup() required");
      iteration++;
      return scheduled(() => {
        switch (mode) {
          case "scroll-page":
            send(iteration % 2 ? "\x1b[5~" : "\x1b[6~");
            break;
          case "scroll-wheel":
            send(iteration % 2 ? "\x1b[<64;5;5M" : "\x1b[<65;5;5M");
            break;
          case "search":
            if (iteration % 3 === 1) {
              send("\x1b[102;6u");
              send("needle");
            } else if (iteration % 3 === 2) send("\r");
            else send("\x1b");
            break;
          case "tool-detail":
            sync("ToolExecutionComponent.setExpanded", () => {
              expanded = iteration % 2 === 1;
              tool.setExpanded(expanded);
            });
            tui.requestRender();
            break;
          case "editor-expand":
            send(iteration % 2 ? "alpha" : "beta");
            send("\x1b[13;2u");
            break;
          case "editor-paste": {
            const unit = "paste needle " + iteration + "\n";
            const characters = options.pasteCharacters ?? 1024;
            send("\x1b[200~" + unit.repeat(Math.ceil(characters / unit.length)).slice(0, characters) + "\x1b[201~");
            break;
          }
          case "resize":
            sync("terminal.resize", () => {
              terminal.columns = iteration % 2 ? Math.max(20, columns - 17) : columns;
              terminal.rows = iteration % 2 ? Math.max(8, rows - 3) : rows;
              terminal.resize?.();
            });
            break;
          case "mouse-selection":
            send(iteration % 2 ? "\x1b[<0;3;2M" : "\x1b[<0;30;2M");
            send("\x1b[<32;40;4M");
            send("\x1b[<0;40;4m");
            break;
          case "task-picker":
            if (!panel) {
              sync("TaskMonitorPanel.mount", () => {
                const tasks = Array.from(
                  { length: Math.max(2, size) },
                  (_, i) =>
                    ({
                      id: "fixture-task-" + i,
                      kind: "command",
                      status: "running",
                      command: "offline task " + i,
                      startedAt: "2100-01-01T00:00:00.000Z",
                      baseOffset: 0,
                      outputEnd: 24,
                      timedOut: false,
                      cwd: "/offline-navigation",
                      monitorIdentity: "fixture-" + i,
                    }) satisfies MonitorTask,
                );
                const source: TaskMonitorSource = {
                  list: () => tasks,
                  inspect: (id) => ({ output: "bounded fixture output " + id }),
                  subscribe: () => () => {},
                  kill: () => {
                    throw new Error("Read-only fixture");
                  },
                };
                panel = new TaskMonitorPanel(
                  source,
                  themeModule.theme,
                  getKeybindings(),
                  () => {
                    overlay?.hide();
                  },
                  () => tui.requestRender(),
                  () => terminal.rows,
                );
                overlay = tui.showOverlay(panel, { width: "90%", maxHeight: "90%" });
              });
            } else {
              send(iteration % 2 ? "i" : "\x1b[B");
            }
            break;
          case "theme":
            sync("theme.setTheme+invalidate", () => {
              changeTheme(iteration % 2 ? "light" : "dark");
              tui.invalidate();
              tui.requestRender(true);
            });
            break;
          case "footer":
            sync("footer.statusMutation", () => {
              statuses.set("bruv-tasks", iteration + " tasks running");
              statuses.set("bruv-questions", iteration + " questions pending");
              tui.requestRender();
            });
            break;
          case "live-wave":
            sync("LiveWaveform.capture+tick+footer", () => {
              wave.capture(pcm);
              statuses.set("bruv-live", "live " + wave.tick(false, timestamp + iteration * 80));
              tui.requestRender();
            });
            break;
          case "session-reopen":
            sync("SessionManager.open+branch+rebuild", () => {
              disposeDiskBackedSessionManager(manager);
              manager = SessionManager.open(history.file);
              manager.branch(iteration % 2 ? history.alternateLeaf : history.primaryLeaf);
              populate();
              tui.requestRender();
            });
            break;
          case "branch-switch":
            sync("SessionManager.branch+rebuild", () => {
              manager.branch(iteration % 2 ? history.alternateLeaf : history.primaryLeaf);
              populate();
              tui.requestRender();
            });
            break;
        }
      });
    },
    dispose() {
      panel?.dispose();
      panel = undefined;
      overlay = undefined;
      // afterTerminalStop can render content outside doRender. Not included in frame evidence.
      if (mounted) tui.stop();
      profiler?.dispose();
      if (manager) disposeDiskBackedSessionManager(manager);
      history?.dispose();
      const globals = globalThis as typeof globalThis & Record<symbol, unknown>;
      if (hadPriorTheme) {
        themeModule.setThemeInstance(priorTheme as Parameters<typeof themeModule.setThemeInstance>[0]);
      } else {
        delete globals[themeKey];
        delete globals[legacyThemeKey];
      }
      priorTheme = undefined;
      hadPriorTheme = false;
      mounted = false;
      if (active === fixture) active = undefined;
    },
  };
  return fixture;
}

export function createNavigationWorkloads(options: NavigationOptions = {}): NavigationWorkload[] {
  const sizes = options.sizes ?? [4];
  for (const size of sizes) if (!Number.isInteger(size) || size < 1) throw new Error("sizes must be positive integers");
  return sizes.flatMap((size) =>
    (options.modes ?? navigationModes).map((mode) => createNavigationWorkload(mode, size, options)),
  );
}

export async function runNavigationProbe(options: NavigationOptions & { samples?: number } = {}) {
  const results: Array<{ name: string; cold: NavigationSample; samples: NavigationSample[] }> = [];
  for (const fixture of createNavigationWorkloads(options)) {
    try {
      const cold = await fixture.setup();
      const samples: NavigationSample[] = [];
      for (let i = 0; i < (options.samples ?? 3); i++) samples.push(await fixture.step());
      results.push({ name: fixture.name, cold, samples });
    } finally {
      fixture.dispose();
    }
  }
  return {
    fixtureVersion: "navigation-v1",
    scope: "scheduled Pi fullscreen dispatcher/component/disk-manager seams; NOT InteractiveMode lifecycle",
    options,
    results,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  const options = {
    sizes: args.includes("--sizes") ? value("--sizes")!.split(",").map(Number) : [4],
    modes: args.includes("--modes") ? (value("--modes")!.split(",") as NavigationMode[]) : undefined,
    samples: args.includes("--samples") ? Number(value("--samples")) : 3,
    pasteCharacters: args.includes("--paste-characters") ? Number(value("--paste-characters")) : 1024,
    toolOutputLines: args.includes("--tool-output-lines") ? Number(value("--tool-output-lines")) : 30,
  };
  for (const mode of options.modes ?? []) if (!navigationModes.includes(mode)) throw new Error("Unknown mode " + mode);
  const evidence =
    args.includes("--sdk") || args.includes("--interactive-sdk")
      ? await runOfflineNavigationSdkProbe(options.sizes[0], { interactive: args.includes("--interactive-sdk") })
      : await runNavigationProbe(options);
  const sourceFiles = [
    "scripts/terminal-perf/navigation-workloads.ts",
    "scripts/terminal-perf/navigation-history.ts",
    "scripts/terminal-perf/navigation-terminal.ts",
    "scripts/terminal-perf/navigation-sdk-probe.ts",
    "src/ui/editor.ts",
    "src/ui/footer.ts",
    "src/ui/task-monitor.ts",
    "src/live/waveform.ts",
    "src/history/session-manager.ts",
    "scripts/terminal-perf/profiler.ts",
    "bun.lock",
    "node_modules/@earendil-works/pi-tui/package.json",
    ...[
      "tui.js",
      "tui-alt-screen.js",
      "layout.js",
      "components/scroll-view.js",
      "components/editor.js",
      "keybindings.js",
    ].map((path) => "node_modules/@earendil-works/pi-tui/dist/" + path),
    "node_modules/@earendil-works/pi-coding-agent/package.json",
    ...[
      "modes/interactive/interactive-mode.js",
      "modes/interactive/components/session-selector.js",
      "modes/interactive/components/tree-selector.js",
      "core/agent-session.js",
      "core/agent-session-runtime.js",
      "core/session-manager.js",
      "core/tools/renderers/bash.js",
      "modes/interactive/components/tool-execution.js",
      "modes/interactive/theme/dark.json",
      "modes/interactive/theme/light.json",
    ].map((path) => "node_modules/@earendil-works/pi-coding-agent/dist/" + path),
  ];
  const fingerprints = Object.fromEntries(
    sourceFiles.map((path) => {
      try {
        return [path, hash(readFileSync(path))];
      } catch {
        return [path, "unavailable (compiled probe outside repo)"];
      }
    }),
  );
  const git = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stderr: "ignore" });
  const report = {
    createdAt: new Date().toISOString(),
    bun: Bun.version,
    executable: process.execPath,
    entrypoint: import.meta.path,
    gitRevision: git.exitCode === 0 ? git.stdout.toString().trim() : null,
    fingerprints,
    ...evidence,
  };
  const text = JSON.stringify(report, null, 2) + "\n";
  if (args.includes("--out")) writeFileSync(value("--out")!, text);
  else console.log(text);
}
