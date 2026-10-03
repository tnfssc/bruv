import { join, resolve } from "node:path";
import type { Api, ImageContent, Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionFactory,
  type InlineExtension,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";
import bruvPackage from "../../package.json";
import { T3_MCP_BEARER_ENV, T3_MCP_URL_ENV } from "../delegation-environment";
import { currentMainOwner } from "../live/main-owner";
import { assertBruvPiHost } from "../pi-host";
import { withBruvSystemPrompt } from "../system-prompt";
import { type CompatFrame, createClaudeCompatFrontend } from "./frontend";

export interface CompatUserMessage {
  type: "user";
  message: { role: "user"; content: string | unknown[]; [key: string]: unknown };
  parent_tool_use_id: string | null;
  uuid?: string;
  session_id?: string;
  [key: string]: unknown;
}
export interface CompatControlRequest {
  type: "control_request";
  request_id: string;
  request: { subtype: string; [key: string]: unknown };
}
export type CompatControlHandler = (
  message: CompatControlRequest,
  signal: AbortSignal,
) => Promise<Record<string, unknown>>;
export interface ClaudeCompatRuntimeOptions {
  cwd: string;
  agentDir: string;
  emit(frame: CompatFrame): void | Promise<void>;
  /** Exact provider/id as advertised by initialize. No native Claude aliases. */
  model?: string;
  modelRuntime?: ModelRuntime;
  settingsManager?: SettingsManager;
  sessionManager?: SessionManager;
  /** Parent-retained native session UUID mapped to this canonical Pi session. */
  nativeSessionId?: string;
  appendSystemPrompt?: string[];
  /** Parent-owned protocol integrations (e.g. external MCP), loaded by the same Pi runtime. */
  extensionFactories?: InlineExtension[];
  /** Exact Pi tool names; defaults to Bruv execute. Auxiliary always uses an empty allowlist. */
  tools?: string[];
  /** Isolated, in-memory, tool-free session for native -p JSON generation. */
  auxiliary?: boolean;
  /** Only bypassPermissions is implemented; other policies need a real tool permission gate. */
  permissionMode?: string;
  /** Owning Bruv binary used by execute and child launch (defaults to process.execPath). */
  executablePath?: string;
  diagnostic?(error: unknown): void;
}
export interface ClaudeCompatRuntime {
  session: AgentSession;
  onUser(message: CompatUserMessage, signal: AbortSignal): Promise<void>;
  controls: Record<string, CompatControlHandler>;
  close(): Promise<void>;
  runAuxiliary(text: string, schema: Record<string, unknown>): Promise<CompatFrame>;
}

function parseInput(content: string | unknown[]): { text: string; images: ImageContent[] } {
  if (typeof content === "string") return { text: content, images: [] };
  const texts: string[] = [],
    images: ImageContent[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") throw new Error("Unsupported user content block");
    const p = raw as Record<string, unknown>;
    const source = p.source && typeof p.source === "object" ? (p.source as Record<string, unknown>) : undefined;
    if (p.type === "text" && typeof p.text === "string") texts.push(p.text);
    else if (
      p.type === "image" &&
      source?.type === "base64" &&
      typeof source.data === "string" &&
      typeof source.media_type === "string"
    )
      images.push({ type: "image", data: source.data, mimeType: source.media_type });
    else throw new Error("Unsupported user content block: " + String(p.type));
  }
  return { text: texts.join("\n"), images };
}

/** Creates one actual Pi session. initialize is local readiness, never a provider access probe. */
export async function createClaudeCompatRuntime(options: ClaudeCompatRuntimeOptions): Promise<ClaudeCompatRuntime> {
  assertBruvPiHost();
  if (
    process.env[T3_MCP_URL_ENV] !== undefined ||
    process.env[T3_MCP_BEARER_ENV] !== undefined ||
    process.env.BRUV_WEB_TASK_EVENTS === "1"
  )
    throw new Error(
      "Legacy patched-T3 bridge environment must be removed before creating the Claude-compatible runtime",
    );
  if (
    options.permissionMode &&
    options.permissionMode !== "bypassPermissions" &&
    !(options.auxiliary && options.permissionMode === "dontAsk")
  )
    throw new Error("Unsupported permission mode: " + options.permissionMode);
  const settings =
    options.settingsManager ??
    (options.auxiliary
      ? SettingsManager.inMemory({ cacheWarming: "off" }, { projectTrusted: false })
      : SettingsManager.create(options.cwd, options.agentDir));
  const models =
    options.modelRuntime ??
    (await ModelRuntime.create({
      authPath: join(options.agentDir, "auth.json"),
      modelsPath: join(options.agentDir, "models.json"),
      refreshOnCreate: false,
      allowModelNetwork: false,
    }));
  // This refreshes local availability/auth facts, not provider models or access.
  // refreshOnCreate:false otherwise leaves ModelRuntime.hasConfiguredAuth empty.
  await models.getAvailable();
  const resolveModel = (key: string): Model<Api> => {
    const separator = key.indexOf("/");
    if (separator < 1) throw new Error("Model must be an exact provider/id, not a Claude alias: " + key);
    const model = models.getModel(key.slice(0, separator), key.slice(separator + 1));
    if (!model) throw new Error("Unknown configured model: " + key);
    return model;
  };
  const configured =
    settings.getDefaultProvider() && settings.getDefaultModel()
      ? settings.getDefaultProvider() + "/" + settings.getDefaultModel()
      : undefined;
  const initialModel = options.model
    ? resolveModel(options.model)
    : configured
      ? resolveModel(configured)
      : models.getAllModels().find((m): m is Model<Api> => m.type === "chat" && models.hasConfiguredAuth(m.provider));
  if (!initialModel)
    throw new Error("No configured Bruv model. Configure a provider/model before starting the connector.");
  // Missing auth remains an initialize error, not a successful account:{} auth indicator.
  const readiness = () => {
    const selected = session.model;
    if (!selected || !models.hasConfiguredAuth(selected.provider))
      throw new Error("No configured authentication for " + (selected?.provider ?? initialModel.provider));
    const auth = models.getProviderAuthStatus(selected.provider);
    return {
      provider: selected.provider,
      model: selected.id,
      configured: true,
      source: auth.source,
      access_verified: false,
    };
  };
  const { installDiskBackedSessionManager } = await import("../history/session-manager");
  installDiskBackedSessionManager();
  const manager = options.auxiliary
    ? SessionManager.inMemory(options.cwd)
    : (options.sessionManager ??
      SessionManager.create(
        options.cwd,
        join(
          options.agentDir,
          "sessions",
          "--" +
            resolve(options.cwd)
              .replace(/^[/\\]/, "")
              .replace(/[/\\:]/g, "-") +
            "--",
        ),
      ));
  let session!: AgentSession;
  const frontend = createClaudeCompatFrontend({
    emit: options.emit,
    auxiliary: options.auxiliary,
    diagnostic: options.diagnostic,
    initialization: () => ({
      cwd: options.cwd,
      tools: session.getActiveToolNames(),
      mcp_servers: [],
      model: session.model!.provider + "/" + session.model!.id,
      permissionMode: "bypassPermissions",
      slash_commands: session.extensionRunner.getRegisteredCommands().map((c) => c.invocationName),
      skills: loader.getSkills().skills.map((s) => s.name),
      plugins: [],
      claude_code_version: "bruv/" + bruvPackage.version,
      bruv: { engine: "pi", provider_access_verified: false },
    }),
    sessionId: () => options.nativeSessionId ?? session.sessionId,
    model: () => (session.model ? session.model.provider + "/" + session.model.id : (options.model ?? "")),
  });
  let factories: { name: string; factory: ExtensionFactory; hidden: boolean }[] = [];
  if (!options.auxiliary) {
    const [{ default: tasks }, { default: state }, { default: live }, { default: remote }] = await Promise.all([
      import("../agent/extension"),
      import("../herdr-agent-state"),
      import("../live/extension"),
      import("../remote/extension"),
    ]);
    factories = [
      { name: "bruv-tools", factory: (pi) => tasks(pi, { executablePath: options.executablePath }), hidden: true },
      { name: "bruv-herdr-agent-state", factory: state, hidden: true },
      { name: "bruv-live", factory: live, hidden: true },
      { name: "bruv-remote", factory: remote, hidden: true },
    ];
  }
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager: settings,
    noExtensions: options.auxiliary,
    noSkills: options.auxiliary,
    noPromptTemplates: options.auxiliary,
    noThemes: true,
    noContextFiles: options.auxiliary,
    systemPrompt: options.auxiliary
      ? "Answer the user's request. Return only JSON matching the requested schema."
      : withBruvSystemPrompt([], {
          cwd: options.cwd,
          agentDir: options.agentDir,
          projectTrusted: settings.isProjectTrusted(),
        })[1],
    appendSystemPrompt: options.appendSystemPrompt,
    extensionFactories: [
      ...factories,
      ...(options.auxiliary ? [] : (options.extensionFactories ?? [])),
      { name: "bruv-claude-compat-frontend", factory: frontend.factory, hidden: true },
    ],
  });
  await loader.reload();
  ({ session } = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    modelRuntime: models,
    model: initialModel,
    settingsManager: settings,
    sessionManager: manager,
    resourceLoader: loader,
    tools: options.auxiliary ? [] : (options.tools ?? ["execute"]),
  }));
  const unsubscribe = session.subscribe(frontend.onEvent);
  let closed = false,
    closePromise: Promise<void> | undefined,
    initialized = false;
  let admission = Promise.resolve();
  let interruptVersion = 0;
  const checkOpen = () => {
    if (closed) throw new Error("Connector session is closed");
  };
  async function close() {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      frontend.interrupt();
      currentMainOwner(session.sessionManager)?.stopForeground();
      // A prompt can still be in asynchronous Pi preflight before isStreaming.
      // Drain admission; the closed check below prevents a late model run.
      await admission;
      session.clearQueue();
      await session.abort();
      try {
        await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      } finally {
        unsubscribe();
        session.dispose();
      }
      await frontend.flush();
    })();
    return closePromise;
  }
  try {
    await session.bindExtensions({
      // RPC is Pi's persistent non-terminal lifecycle; print/json wait on background work.
      mode: options.auxiliary ? "print" : "rpc",
      uiContext: frontend.headlessUI(session.extensionRunner.createContext().ui),
      abortHandler: () => {
        currentMainOwner(session.sessionManager)?.stopForeground();
        void session.abort();
      },
      shutdownHandler: () => {
        void close().catch(options.diagnostic ?? (() => {}));
      },
      onError: (error) => {
        options.diagnostic?.(error);
        frontend.fail(error.error);
      },
    });
  } catch (error) {
    await close();
    throw error;
  }

  const controls: Record<string, CompatControlHandler> = {
    initialize: async () => {
      checkOpen();
      const ready = readiness();
      initialized = true;
      return {
        commands: session.extensionRunner
          .getRegisteredCommands()
          .map((c) => ({ name: c.invocationName, description: c.description ?? "", argumentHint: "" })),
        models: models
          .getAllModels()
          .filter((m): m is Model<Api> => m.type === "chat" && models.hasConfiguredAuth(m.provider))
          .map((m) => ({
            value: m.provider + "/" + m.id,
            displayName: m.name + " (" + m.provider + ")",
            description: "Bruv configured model; provider access unverified",
          })),
        // Never report Anthropic subscription/account identity for non-Claude engines.
        account: {},
        bruv: { engine: "pi", readiness: ready },
      };
    },
    get_usage: async () => {
      checkOpen();
      return { rate_limits_available: false, rate_limits: {}, total_cost_usd: session.getSessionStats().cost };
    },
    interrupt: async () => {
      checkOpen();
      interruptVersion++;
      frontend.interrupt();
      await admission;
      session.clearQueue();
      currentMainOwner(session.sessionManager)?.stopForeground();
      await session.abort();
      await frontend.flush();
      return {};
    },
    set_model: async (message) => {
      checkOpen();
      if (!session.isIdle) throw new Error("Cannot change model during a running turn; interrupt first");
      if (typeof message.request.model !== "string") throw new Error("set_model requires an exact model ID");
      const model = resolveModel(message.request.model);
      if (!models.hasConfiguredAuth(model.provider))
        throw new Error("No configured authentication for " + model.provider);
      await session.setModel(model);
      return {};
    },
  };
  async function onUser(message: CompatUserMessage, signal: AbortSignal) {
    checkOpen();
    if (!initialized) throw new Error("initialize must succeed before user input");
    if (message.session_id && message.session_id !== (options.nativeSessionId ?? session.sessionId))
      throw new Error("User session_id does not match the owning Bruv session");
    if (message.parent_tool_use_id != null) throw new Error("Child user input is unsupported on the root connector");
    const { text, images } = parseInput(message.message.content);
    if (signal.aborted) throw signal.reason;
    // Serialize only Pi admission/preflight, never model turns or a second user queue.
    const requestVersion = interruptVersion;
    const previous = admission;
    let accepted!: () => void;
    admission = new Promise<void>((resolve) => {
      accepted = resolve;
    });
    await previous;
    let run: Promise<unknown>;
    let handled = false;
    const checkpoint = frontend.checkpoint();
    const cancel = () => {
      frontend.interrupt();
      currentMainOwner(session.sessionManager)?.stopForeground();
      void session.abort();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      checkOpen();
      readiness();
      if (signal.aborted) throw signal.reason;
      if (message.priority === "now" && session.isStreaming) {
        // Genuine Pi steering (not cancel + fresh prompt, not a second scheduling authority).
        run = session.steer(text, images);
        void run.then(accepted, accepted);
      } else {
        run = session.prompt(text, {
          images,
          source: "rpc",
          streamingBehavior: "followUp",
          preflightResult: (disposition) => {
            handled = disposition === "handled";
            accepted();
            checkOpen();
            if (requestVersion !== interruptVersion) throw new Error("Interrupted during prompt admission");
            if (signal.aborted) throw signal.reason;
          },
        });
        void run.then(accepted, accepted);
      }
      await run;
      if (handled) frontend.commandHandled(checkpoint);
      await frontend.flush();
    } catch (error) {
      frontend.fail(error);
      await frontend.flush();
    } finally {
      accepted();
      signal.removeEventListener("abort", cancel);
    }
  }
  let auxiliaryUsed = false;
  async function runAuxiliary(text: string, schema: Record<string, unknown>) {
    checkOpen();
    if (!options.auxiliary) throw new Error("Auxiliary requests require an isolated auxiliary runtime");
    if (auxiliaryUsed) throw new Error("Auxiliary runtime is single-use");
    auxiliaryUsed = true;
    readiness();
    const validator = Compile(schema as TSchema);
    await session.prompt(text + "\n\nReturn only JSON matching this JSON Schema:\n" + JSON.stringify(schema), {
      expandPromptTemplates: false,
      source: "rpc",
    });
    if (frontend.error()) throw new Error(frontend.error());
    const output = JSON.parse(frontend.text());
    if (!validator.Check(output))
      throw new Error(
        "Model output does not satisfy the requested JSON schema: " +
          validator
            .Errors(output)
            .map((e) => e.message)
            .join("; "),
      );
    return frontend.result(output);
  }
  return { session, onUser, controls, close, runAuxiliary };
}
