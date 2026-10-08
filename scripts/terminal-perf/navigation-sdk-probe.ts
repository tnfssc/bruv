/** Owns the offline SDK runtime, instrumentation guards, and optional InteractiveMode lifetime. */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  InteractiveMode,
  SessionManager,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
  type CreateAgentSessionRuntimeFactory,
  SettingsManager,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { TuiAltScreen } from "@earendil-works/pi-tui";
import {
  installDiskBackedSessionManager,
  disposeDiskBackedSessionManager,
  getDiskBackedEntryMetadata,
} from "../../src/history/session-manager";
import { createNavigationHistory } from "./navigation-history";
import { NavigationTerminal } from "./navigation-terminal";
import { attachTerminalProfiler, type TerminalFrameSample } from "./profiler";

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
type SyncSegment = { name: string; durationMs: number; startedAtMs: number };

/** Real offline AgentSession API probe. Async elapsed is NOT synchronous CPU work. */
export async function runOfflineNavigationSdkProbe(size = 4, options: { interactive?: boolean } = {}) {
  installDiskBackedSessionManager();
  const history = createNavigationHistory(size);
  const manager = SessionManager.open(history.file);
  if (options.interactive) manager.branch(history.primaryLeaf);
  const segments: Array<SyncSegment & { operation: string }> = [];
  let operation = "setup";
  const sync = <T>(name: string, fn: () => T): T => {
    const start = performance.now();
    try {
      return fn();
    } finally {
      segments.push({ name, operation, startedAtMs: start, durationMs: performance.now() - start });
    }
  };
  const elapsed: Array<{ name: string; startedAtMs: number; elapsedMs: number; initialSyncMs: number }> = [];
  let owner: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
  let providerCalls = 0;
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  const forbiddenFetch = () => {
    fetchCalls++;
    throw new Error("Fetch forbidden in offline navigation probe");
  };
  globalThis.fetch = Object.assign(forbiddenFetch, { preconnect: forbiddenFetch });
  let app: InteractiveMode | undefined;
  let appTerminal: NavigationTerminal | undefined;
  const appStages: Array<{
    name: string;
    frames: TerminalFrameSample[];
    screenHash: string;
    outputHash: string;
    outputBytes: number;
  }> = [];
  const captureStage = (name: string) => {
    const renderer = (app as unknown as { renderer: TuiAltScreen }).renderer;
    const output = appTerminal!.writes.join("");
    appStages.push({
      name,
      frames: appProfiler!.snapshot().frames,
      screenHash: hash((renderer as unknown as { previousScreen: string[] }).previousScreen.join("\n")),
      outputHash: hash(output),
      outputBytes: Buffer.byteLength(output),
    });
  };
  let appProfiler: ReturnType<typeof attachTerminalProfiler> | undefined;
  const appInput: Array<{
    name: string;
    durationMs: number;
    schedulerDelayMs: number | null;
    screenHash: string;
    outputHash: string;
    outputBytes: number;
    frames: TerminalFrameSample[];
  }> = [];
  const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = history.root;
  const priorAssetDir = process.env.PI_PACKAGE_DIR;
  if (options.interactive) delete process.env.PI_PACKAGE_DIR;
  const managers = new Set<SessionManager>([manager]);
  const originalOpen = SessionManager.open;
  SessionManager.open = (...args) => sync("SessionManager.open", () => originalOpen(...args));
  const instrumentManager = (target: SessionManager) => {
    managers.add(target);
    for (const name of [
      "setSessionFile",
      "getBranch",
      "buildSessionContext",
      "branch",
      "createBranchedSession",
    ] as const) {
      const original = target[name].bind(target) as (...args: unknown[]) => unknown;
      (target as unknown as Record<string, unknown>)[name] = (...args: unknown[]) =>
        sync("SessionManager." + name, () => original(...args));
    }
  };
  try {
    const modelRuntime = await ModelRuntime.create({
      authPath: join(history.root, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    modelRuntime.stream = modelRuntime.streamSimple = (() => {
      providerCalls++;
      throw new Error("Provider access forbidden in navigation probe");
    }) as typeof modelRuntime.stream;
    const factory: CreateAgentSessionRuntimeFactory = async (input) => {
      instrumentManager(input.sessionManager);
      const services = await createAgentSessionServices({
        cwd: input.cwd,
        agentDir: input.agentDir,
        modelRuntime,
        settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
        resourceLoaderOptions: { noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true },
      });
      const created = await createAgentSessionFromServices({
        services,
        sessionManager: input.sessionManager,
        sessionStartEvent: input.sessionStartEvent,
        model: getModel("anthropic", "claude-sonnet-4-5")!,
        tools: [],
      });
      return { ...created, services, diagnostics: services.diagnostics };
    };
    owner = await createAgentSessionRuntime(factory, {
      cwd: history.root,
      agentDir: history.root,
      sessionManager: manager,
    });
    if (options.interactive) {
      const terminal = new NavigationTerminal(80, 24);
      appTerminal = terminal;
      operation = "InteractiveMode.constructor";
      app = sync(
        operation,
        () => new InteractiveMode(owner!, { terminal, tuiMode: "fullscreen", initialThemeSetting: "dark" }),
      );
      const instance = app as unknown as Record<string, unknown>;
      for (const name of [
        "renderInitialMessages",
        "renderCurrentSessionState",
        "resetExtensionUI",
        "setToolsExpanded",
        "renderWidgets",
      ]) {
        const original = (instance[name] as (...args: unknown[]) => unknown).bind(app);
        instance[name] = (...args: unknown[]) => sync("InteractiveMode." + name, () => original(...args));
      }
      const renderer = instance.renderer as TuiAltScreen;
      appProfiler = attachTerminalProfiler(renderer, { capacity: 128 });
      operation = "InteractiveMode.init";
      const start = performance.now();
      const pending = app.init();
      const initialSyncMs = performance.now() - start;
      await pending;
      elapsed.push({ name: operation, startedAtMs: start, initialSyncMs, elapsedMs: performance.now() - start });
      captureStage(operation);
      // Actual app keybinding and actual app selector entrypoints on a constructed, initialized mode.
      const input = async (name: string, action: () => void) => {
        operation = name;
        appProfiler!.clear();
        terminal.writes = [];
        const start = performance.now();
        sync(name, action);
        const returnedAtMs = performance.now();
        const durationMs = returnedAtMs - start;
        // This wait is only an offline capture drain, NOT scheduler latency or CPU evidence.
        await Bun.sleep(40);
        const frames = appProfiler!.snapshot().frames;
        const output = terminal.writes.join("");
        appInput.push({
          name,
          durationMs,
          schedulerDelayMs:
            frames[0] && frames[0].startedAtMs >= returnedAtMs ? frames[0].startedAtMs - returnedAtMs : null,
          screenHash: hash((renderer as unknown as { previousScreen: string[] }).previousScreen.join("\n")),
          outputHash: hash(output),
          outputBytes: Buffer.byteLength(output),
          frames,
        });
      };
      await input("InteractiveMode.ctrl-o", () => terminal.send("\x0f"));
      await input("InteractiveMode.showSessionSelector", () => (instance.showSessionSelector as () => void).call(app));
      await input("InteractiveMode.session-selector.cancel", () => terminal.send("\x1b"));
      await input("InteractiveMode.showTreeSelector", () => (instance.showTreeSelector as () => void).call(app));
      await input("InteractiveMode.tree-selector.cancel", () => terminal.send("\x1b"));
    }
    // Awaited lifecycle elapsed is not CPU. These sync method spans can overlap (nested calls).
    const call = async (name: string, action: () => Promise<unknown>) => {
      operation = name;
      appProfiler?.clear();
      if (appTerminal) appTerminal.writes = [];
      const start = performance.now();
      const pending = action();
      const initialSyncMs = performance.now() - start;
      const result = await pending;
      elapsed.push({ name, startedAtMs: start, elapsedMs: performance.now() - start, initialSyncMs });
      if (appProfiler) {
        // Capture pending real app renders after lifecycle completion; this drain is not CPU time.
        await Bun.sleep(40);
        captureStage(name);
      }
      if ((result as { cancelled?: boolean }).cancelled) throw new Error(name + " unexpectedly cancelled");
    };
    await call("AgentSession.navigateTree(primary,no-summary)", () =>
      owner!.session.navigateTree(history.primaryLeaf, { summarize: false }),
    );
    await call("AgentSession.navigateTree(alternate,no-summary)", () =>
      owner!.session.navigateTree(history.alternateLeaf, { summarize: false }),
    );
    await call(
      app ? "InteractiveMode.handleResumeSession(disk-file)" : "AgentSessionRuntime.switchSession(disk-file)",
      () =>
        app
          ? (app as unknown as { handleResumeSession(path: string): Promise<unknown> }).handleResumeSession(
              history.file,
            )
          : owner!.switchSession(history.file),
    );
    await call("AgentSessionRuntime.fork(primary,at)", () => owner!.fork(history.primaryLeaf, { position: "at" }));
    operation = "final-context";
    const current = owner.session.sessionManager;
    const context = sync("SessionManager.buildSessionContext(final)", () => current.buildSessionContext());
    return {
      fixtureVersion: options.interactive ? "navigation-interactive-sdk-v1" : "navigation-sdk-v1",
      interactive: options.interactive === true,
      scope: options.interactive
        ? "real initialized InteractiveMode with injected counting terminal and SDK runtime lifecycle; no Bruv extensions/PTY/provider; nested sync spans NOT additive"
        : "real AgentSessionRuntime/AgentSession/services and disk-backed SessionManager, no InteractiveMode/TUI/extension startup; nested sync spans NOT additive",
      size,
      providerCalls,
      fetchCalls,
      appInput,
      appStages,
      appCaptureDrainMs: options.interactive ? 40 : undefined,
      segments,
      elapsed,
      contentHash: history.contentHash,
      contextHash: hash(JSON.stringify(context.messages)),
      messages: context.messages.length,
      leafId: current.getLeafId(),
      historyBytes: history.bytes,
      diskBacked: getDiskBackedEntryMetadata(current) !== undefined,
    };
  } finally {
    operation = "teardown";
    try {
      app?.stop();
      appProfiler?.dispose();
      await owner?.dispose();
    } finally {
      if (options.interactive && priorAssetDir !== undefined) process.env.PI_PACKAGE_DIR = priorAssetDir;
      if (priorAgentDir !== undefined) process.env.PI_CODING_AGENT_DIR = priorAgentDir;
      else delete process.env.PI_CODING_AGENT_DIR;
      globalThis.fetch = originalFetch;
      SessionManager.open = originalOpen;
      for (const manager of managers) disposeDiskBackedSessionManager(manager);
      history.dispose();
    }
  }
}
