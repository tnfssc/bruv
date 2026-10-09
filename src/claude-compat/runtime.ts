import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { join, resolve } from "node:path";
import type { Api, ImageContent, Message, Model } from "@earendil-works/pi-ai";
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
import { bindNativeChildExecutable } from "./binding";
import { createClaudeCompatCommands } from "./commands";
import { type CompatFrame, createClaudeCompatFrontend } from "./frontend";
import type { NativeHistory } from "./history";
import { createClaudeCompatHumanControls } from "./human-controls";
import { COMPAT_PROTOCOL_VERSION } from "./launch";
import { createClaudeCompatLiveFrontend } from "./live-frontend";
import type { InjectedMcpSession } from "./mcp";
import { nativeAssistantCost, nativeAssistantUsage } from "./message-usage";
import type { PermissionDecision, PermissionRequest } from "./permissions";
import { bindNativeTasks } from "./task-binding";
import { writeNativeChildFrame } from "./task-child-journal";
import type { ClaudeCompatTransport } from "./transport";

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
  request?: ClaudeCompatTransport["request"];
  /** Explicit operator grant for this host; a separate human consent is still required. */
  localAudio?: { host: string };
  authorizeTool?: (request: PermissionRequest) => Promise<PermissionDecision>;
  mcp?: InjectedMcpSession;
  changePermissionMode?: (mode: string) => void;
  history?: NativeHistory;
  historyParentUuid?: string;
  disableHooks?: boolean;
  disableSlashCommands?: boolean;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  thinkingDisplay?: string;
  /** Official host --settings fastMode: explicit user premium-tier opt-in. */
  fastMode?: boolean;
  profilesPath?: string;
  /** The actual enforced policy, not a readiness label. */
  permissionMode?: string;
  /** Owning Bruv binary used by execute and child launch (defaults to process.execPath). */
  executablePath?: string;
  /** Fatal frontend delivery failure; the owning transport must close. */
  onOutputError?(error: unknown): void;
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

function nativeContent(content: unknown): unknown[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.map((p) =>
    p.type === "toolCall"
      ? { type: "tool_use", id: p.id, name: p.name, input: p.arguments }
      : p.type === "image"
        ? { type: "image", source: { type: "base64", data: p.data, media_type: p.mimeType } }
        : p.type === "thinking"
          ? {
              type: "thinking",
              thinking: p.thinking,
              ...(p.thinkingSignature ? { signature: p.thinkingSignature } : {}),
            }
          : p,
  );
}

/** Root history and child frames share the same Pi-to-native message body. */
function nativeMessage(
  message: AgentMessage,
): { role: "user" | "assistant"; content: unknown[]; model?: string } | undefined {
  switch (message.role) {
    case "user":
      return { role: "user", content: nativeContent(message.content) };
    case "assistant":
      return {
        role: "assistant",
        content: nativeContent(message.content),
        model: message.provider + "/" + message.model,
      };
    case "toolResult":
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId,
            content: nativeContent(message.content),
            is_error: message.isError,
          },
        ],
      };
    default:
      return undefined;
  }
}

/** Mirror canonical appends in order; the returned drain reports the first write failure. */
function mirrorNativeHistory(
  manager: SessionManager,
  history: NativeHistory,
  messageUuid: (message: object) => string,
  parentUuid: string | undefined,
): () => Promise<void> {
  let pending: Promise<unknown> = Promise.resolve();
  let failure: unknown;
  const append = manager.appendMessage.bind(manager);
  manager.appendMessage = (message: Message) => {
    const entryId = append(message);
    const native = nativeMessage(message);
    if (native) {
      const uuid = messageUuid(message);
      const parent = parentUuid;
      parentUuid = uuid;
      pending = pending
        .then(() =>
          history.append({
            sourceMessageId: entryId,
            type: native.role,
            message: {
              ...native,
              ...(message.role === "assistant" ? { id: uuid, usage: nativeAssistantUsage(message) } : {}),
            },
            ...(message.role === "assistant" ? nativeAssistantCost(message) : {}),
            timestamp: new Date(message.timestamp).toISOString(),
            uuid,
            ...(parent === undefined ? {} : { parentUuid: parent }),
          }),
        )
        .catch((error) => {
          failure ??= error;
        });
    }
    return entryId;
  };
  return async () => {
    await pending;
    if (failure) throw failure;
  };
}

/** Local-only setup validation. No session, history, task owner, tools or provider request. */
export async function preflightClaudeCompatModel(options: ClaudeCompatRuntimeOptions) {
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
    if (separator < 1)
      throw new Error("Select an exact Bruv provider/id in T3; Claude aliases are not supported: " + key);
    const model = models.getModel(key.slice(0, separator), key.slice(separator + 1));
    if (!model)
      throw new Error("Unknown configured Bruv model; select an exact provider/id from the selected Bruv home: " + key);
    return model;
  };
  const configured =
    settings.getDefaultProvider() && settings.getDefaultModel()
      ? settings.getDefaultProvider() + "/" + settings.getDefaultModel()
      : undefined;
  const initialModel =
    options.model !== undefined ? resolveModel(options.model) : configured ? resolveModel(configured) : undefined;
  if (!initialModel)
    throw new Error(
      "No selected Bruv model. Select an exact provider/id in T3 or configure the default model in the explicitly selected Bruv home.",
    );
  if (!models.hasConfiguredAuth(initialModel.provider))
    throw new Error(
      "No configured authentication for " +
        initialModel.provider +
        ". Configure it with ordinary Bruv in the explicitly selected BRUV_CLAUDE_COMPAT_HOME; do not use T3 Claude login.",
    );
  if (
    options.thinkingDisplay === "summarized" &&
    initialModel.reasoning &&
    !["anthropic-messages", "openai-responses", "openai-codex-responses", "azure-openai-responses"].includes(
      initialModel.api,
    )
  )
    throw new Error("Thinking summaries are unsupported for this reasoning API");
  return { settings, models, initialModel, resolveModel };
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
  const { settings, models, initialModel, resolveModel } = await preflightClaudeCompatModel(options);
  // Recheck local auth at initialize/admission; account:{} is never an auth indicator.
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
  let releaseChildExecutable: (() => void) | undefined;
  const messageIds = new WeakMap<object, string>();
  const messageUuid = (message: object) => {
    let id = messageIds.get(message);
    if (!id) {
      id = randomUUID();
      messageIds.set(message, id);
    }
    return id;
  };
  const flushHistory = options.history
    ? mirrorNativeHistory(manager, options.history, messageUuid, options.historyParentUuid)
    : undefined;
  const human =
    options.request && !options.auxiliary && manager.getSessionFile()
      ? createClaudeCompatHumanControls({ request: options.request, diagnostic: options.diagnostic })
      : undefined;
  const lifetime = new AbortController();
  let toolTurn = new AbortController();
  let session!: AgentSession;
  const frontend = createClaudeCompatFrontend({
    emit: async (frame) => {
      if (frame.type === "result") {
        // End app HTTP leases before publishing idle/result to the owning host.
        await options.mcp?.parkAppOwned();
        await human?.flush();
      }
      await options.emit(frame);
    },
    onOutputError: options.onOutputError,
    messageUuid,
    omitThinking: options.thinkingDisplay === "omitted",
    auxiliary: options.auxiliary,
    diagnostic: options.diagnostic,
    initialization: () => ({
      cwd: options.cwd,
      tools: session.getActiveToolNames(),
      mcp_servers: options.mcp?.status() ?? [],
      model: session.model!.provider + "/" + session.model!.id,
      permissionMode: options.permissionMode ?? "default",
      slash_commands: options.disableSlashCommands ? [] : commands.catalog().map((c) => c.name),
      skills: loader.getSkills().skills.map((s) => s.name),
      plugins: [],
      claude_code_version: COMPAT_PROTOCOL_VERSION,
      bruv: { engine: "pi", version: bruvPackage.version, provider_access_verified: false },
    }),
    sessionId: () => options.nativeSessionId ?? session.sessionId,
    model: () => (session.model ? session.model.provider + "/" + session.model.id : (options.model ?? "")),
  });
  let nativeFast: ReturnType<typeof import("../agent/native-fast-mode").registerNativeFastMode> | undefined;
  let factories: { name: string; factory: ExtensionFactory; hidden: boolean }[] = [];
  if (!options.auxiliary) {
    const [{ default: tasks }, { default: state }, { default: remote }] = await Promise.all([
      import("../agent/extension"),
      import("../herdr-agent-state"),
      import("../remote/extension"),
    ]);
    factories = [
      {
        name: "bruv-tools",
        factory: (pi) =>
          tasks(pi, {
            executablePath: options.executablePath,
            profilesPath: options.profilesPath,
            onNativeFastMode: (control) => {
              nativeFast = control;
            },
            onTaskOwner: (owner) =>
              bindNativeTasks(owner, {
                root: {
                  namespace: "bruv:" + resolve(options.agentDir),
                  sourceSessionId: owner.sourceSessionId,
                  sessionId: options.nativeSessionId ?? manager.getSessionId(),
                },
                emit: (frame) => options.emit({ ...frame }),
                translateChildEntry: ({ entry }) => {
                  const message = entry.message;
                  const native = nativeMessage(
                    message.role === "assistant" && options.thinkingDisplay === "omitted"
                      ? { ...message, content: message.content.filter((part) => part.type !== "thinking") }
                      : message,
                  );
                  if (!native) return [];
                  if (message.role !== "assistant") return [{ type: "user", message: native }];
                  return [
                    {
                      type: "assistant",
                      message: {
                        id: entry.id,
                        type: "message",
                        role: "assistant",
                        model: native.model,
                        content: native.content,
                        stop_reason:
                          message.stopReason === "toolUse"
                            ? "tool_use"
                            : message.stopReason === "length"
                              ? "max_tokens"
                              : "end_turn",
                        stop_sequence: null,
                        usage: nativeAssistantUsage(message),
                      },
                    },
                  ];
                },
                writeChildFrame: (source, frame) => writeNativeChildFrame(options.history, source, frame),
                diagnostic: (message) => options.diagnostic?.(new Error(message)),
              }),
          }),
        hidden: true,
      },
      { name: "bruv-herdr-agent-state", factory: state, hidden: true },
      {
        name: "bruv-live",
        factory: createClaudeCompatLiveFrontend({
          localAudio: options.localAudio,
          humanChoices: !!options.request,
          request: options.request,
          notify: (text, level) => frontend.notice(text, level),
        }).factory,
        hidden: true,
      },
      { name: "bruv-remote", factory: remote, hidden: true },
    ];
  }
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager: settings,
    noExtensions: options.auxiliary || options.disableHooks,
    noSkills: options.auxiliary,
    noPromptTemplates: options.auxiliary,
    noThemes: true,
    noContextFiles: options.auxiliary,
    systemPrompt: options.auxiliary
      ? "Answer the user's request."
      : withBruvSystemPrompt([], {
          cwd: options.cwd,
          agentDir: options.agentDir,
          projectTrusted: settings.isProjectTrusted(),
        })[1],
    appendSystemPrompt: options.appendSystemPrompt,
    extensionFactories: [
      ...factories,
      ...(options.auxiliary ? [] : (options.extensionFactories ?? [])),
      ...(human ? [{ name: "bruv-native-questions", factory: human.factory, hidden: true }] : []),
      {
        name: "bruv-native-permissions",
        hidden: true,
        factory: (pi) => {
          pi.on("before_agent_start", async () => {
            // A task wake can begin the next Pi run before native writes drain.
            // Finish the previous result/lease release before acquiring another.
            if (options.mcp) await frontend.flush();
            await options.mcp?.resumeAppOwned();
          });
          pi.on("agent_start", () => {
            toolTurn = new AbortController();
          });
          pi.on("before_provider_request", (event, ctx) => {
            if (!options.thinkingDisplay || !ctx.model?.reasoning) return;
            const payload = event.payload as Record<string, any>;
            if (
              ctx.model.api === "anthropic-messages" &&
              payload.thinking?.type &&
              payload.thinking.type !== "disabled"
            )
              return { ...payload, thinking: { ...payload.thinking, display: options.thinkingDisplay } };
            if (
              ["openai-responses", "openai-codex-responses", "azure-openai-responses"].includes(ctx.model.api) &&
              payload.reasoning
            )
              return {
                ...payload,
                reasoning: { ...payload.reasoning, summary: options.thinkingDisplay === "summarized" ? "auto" : null },
              };
          });
          pi.on("tool_call", async (event) => {
            if (options.mcp?.tools().some((t) => t.name === event.toolName)) return;
            if (!options.authorizeTool) {
              if (options.permissionMode === "bypassPermissions") return;
              return { block: true, reason: "No native permission gate is bound" };
            }
            const effect =
              event.toolName === "execute"
                ? "arbitrary-typescript"
                : ["read", "grep", "find", "ls"].includes(event.toolName)
                  ? "read-only"
                  : ["edit", "write"].includes(event.toolName)
                    ? "edit"
                    : "other";
            const decision = await options.authorizeTool({
              toolName: event.toolName,
              input: event.input,
              toolUseId: event.toolCallId,
              effect,
              owner: "bruv",
              signal: AbortSignal.any([lifetime.signal, toolTurn.signal]),
            });
            if (decision.behavior === "deny") {
              frontend.denied(event.toolName, event.input, event.toolCallId);
              return { block: true, reason: decision.message };
            }
            if (decision.updatedInput) {
              for (const key of Object.keys(event.input)) delete (event.input as Record<string, unknown>)[key];
              Object.assign(event.input, decision.updatedInput);
            }
          });
        },
      },
      { name: "bruv-claude-compat-frontend", factory: frontend.factory, hidden: true },
    ],
  });
  await loader.reload();
  ({ session } = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    modelRuntime: models,
    model: initialModel,
    thinkingLevel: options.thinkingLevel,
    settingsManager: settings,
    sessionManager: manager,
    resourceLoader: loader,
    tools: options.auxiliary ? [] : (options.tools ?? ["execute"]),
  }));
  const commands = createClaudeCompatCommands({
    session,
    humanControls: human,
    notify: async (text, level) => {
      frontend.notice(text, level);
      await frontend.flush();
    },
  });
  const inboundUserUuids = new WeakMap<object, string | undefined>();
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_start" && event.message.role === "user") {
      if (inboundUserUuids.has(event.message)) frontend.consumeUser(inboundUserUuids.get(event.message));
    }
    frontend.onEvent(event);
  });
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
    lifetime.abort(new Error("Connector closed"));
    toolTurn.abort();
    human?.dispose();
    closePromise = (async () => {
      const errors: unknown[] = [];
      frontend.interrupt();
      currentMainOwner(session.sessionManager)?.stopForeground();
      // An admitted Pi preflight must see closed before it can start a provider call.
      await admission;
      session.clearQueue();
      try {
        await session.abort();
      } catch (error) {
        errors.push(error);
      }
      try {
        await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      } catch (error) {
        errors.push(error);
      }
      unsubscribe();
      session.dispose();
      releaseChildExecutable?.();
      for (const result of await Promise.allSettled([frontend.flush(), options.mcp?.close(), flushHistory?.()]))
        if (result.status === "rejected") errors.push(result.reason);
      if (errors.length) throw new AggregateError(errors, "Connector teardown failed");
    })();
    return closePromise;
  }
  try {
    if (options.executablePath && !options.auxiliary)
      releaseChildExecutable = await bindNativeChildExecutable(manager, options.executablePath);
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

  if (options.fastMode !== undefined) {
    try {
      if (!nativeFast) {
        if (options.fastMode) throw new Error("Native fast mode is unavailable in this runtime");
      } else nativeFast.setWithCostConsent(options.fastMode);
    } catch (error) {
      await close();
      throw error;
    }
  }

  // Bruv's extension installs its ordinary CLI execute-only default at session_start.
  // Native selection belongs to this composition, after those defaults have run.
  const selectedTools = options.auxiliary ? [] : (options.tools ?? ["execute"]);
  const availableTools = new Set(session.getAllTools().map((t) => t.name));
  for (const name of selectedTools)
    if (!availableTools.has(name)) {
      await close();
      throw new Error("Unavailable native tool: " + name);
    }
  session.setActiveToolsByName(selectedTools);

  const controls: Record<string, CompatControlHandler> = {
    initialize: async () => {
      checkOpen();
      const ready = readiness();
      initialized = true;
      return {
        commands: options.disableSlashCommands ? [] : commands.catalog(),
        models: models
          .getAllModels()
          .filter(
            (m): m is Model<Api> => (m.type === "chat" || m.type === undefined) && models.hasConfiguredAuth(m.provider),
          )
          .map((m) => ({
            value: m.provider + "/" + m.id,
            displayName: m.name + " (" + m.provider + ")",
            description: "Bruv configured model; provider access unverified",
          })),
        // Never report Anthropic subscription/account identity for non-Claude engines.
        account: {},
        bruv: { engine: "pi", version: bruvPackage.version, readiness: ready },
      };
    },
    get_usage: async () => {
      checkOpen();
      return { rate_limits_available: false, rate_limits: {}, total_cost_usd: session.getSessionStats().cost };
    },
    interrupt: async () => {
      checkOpen();
      interruptVersion++;
      toolTurn.abort(new Error("Interrupted"));
      human?.interrupt();
      frontend.interrupt();
      await admission;
      session.clearQueue();
      currentMainOwner(session.sessionManager)?.stopForeground();
      await session.abort();
      await frontend.flush();
      return {};
    },
    ...(options.changePermissionMode
      ? {
          set_permission_mode: async (message: CompatControlRequest) => {
            checkOpen();
            if (typeof message.request.mode !== "string") throw new Error("set_permission_mode requires mode");
            options.changePermissionMode!(message.request.mode);
            options.permissionMode = message.request.mode;
            return {};
          },
        }
      : {}),
    apply_flag_settings: async (message) => {
      checkOpen();
      if (!session.isIdle) throw new Error("Cannot change Fast during a running turn; interrupt first");
      const settings = message.request.settings;
      if (
        !settings ||
        typeof settings !== "object" ||
        Array.isArray(settings) ||
        Object.keys(settings).some((key) => key !== "fastMode") ||
        typeof (settings as Record<string, unknown>).fastMode !== "boolean"
      )
        throw new Error("apply_flag_settings supports only boolean fastMode");
      if (!nativeFast) throw new Error("Native fast mode is unavailable in this runtime");
      nativeFast.setWithCostConsent((settings as { fastMode: boolean }).fastMode);
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
    if (
      !options.disableSlashCommands &&
      /^\/bruv(?=[:\s]|$)/.test(typeof message.message.content === "string" ? message.message.content.trim() : "")
    ) {
      if (session.isStreaming) throw new Error("Interrupt the model turn before running a human command");
      // T3 correlates root output to the actual submitted user frame. Human
      // commands bypass Pi prompt admission, so echo that received command here
      // without adding it to model history or inventing a model turn.
      frontend.startCommand(message);
      const checkpoint = frontend.checkpoint();
      await commands.dispatchUserCommand({ ...message, session_id: session.sessionId });
      // A resume command can start a genuine Pi follow-up. Its actual settle
      // event, not the command handler returning, owns that terminal result.
      if (session.isIdle) frontend.commandHandled(checkpoint);
      await frontend.flush();
      return;
    }
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
    // Capture object identity only; the subscriber attributes it when Pi consumes it.
    const onUserMessageCreated = (created: object) => {
      inboundUserUuids.set(created, message.uuid);
      if (message.uuid) messageIds.set(created, message.uuid);
    };
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
        run = session.steer(text, images, { source: "rpc", onUserMessageCreated });
        void run.then(accepted, accepted);
      } else {
        run = session.prompt(text, {
          images,
          source: "rpc",
          streamingBehavior: "followUp",
          onUserMessageCreated,
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
      await flushHistory?.();
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
