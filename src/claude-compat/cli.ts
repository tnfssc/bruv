import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import product from "../../package.json";
import image from "../../runtime-assets/assets/clankolas.png" with { type: "file" };
import template from "../../runtime-assets/export-html/template.html" with { type: "file" };
import highlight from "../../runtime-assets/export-html/vendor/highlight.min.js" with { type: "file" };
import marked from "../../runtime-assets/export-html/vendor/marked.min.js" with { type: "file" };
import metadata from "../../runtime-assets/package.json" with { type: "file" };
import dark from "../../runtime-assets/theme/dark.json" with { type: "file" };
import light from "../../runtime-assets/theme/light.json" with { type: "file" };
import themeSchema from "../../runtime-assets/theme/theme-schema.json" with { type: "file" };
import { scrubRootEnvironmentInPlace } from "../delegation-environment";
import { launchPolicy, nativeStorage, permissionBinding, mcpFactory, scopedSettings } from "./binding";
import { InjectedMcpSession } from "./mcp";
import { loadProfiles } from "../tasks/subagent-profiles";
import { parseConnectorArguments, assertLaunchBindings, type ConnectorArguments } from "./arguments";
import { ClaudeCompatTransport, type TransportOptions, type WireMessage } from "./transport";

export const CONNECTOR_VERSION = "bruv-claude-compat " + product.version;
export const CONNECTOR_HELP = [
  "bruv-claude-compat \u2014 Bruv connector, not Anthropic Claude Code",
  "",
  "Usage:",
  "  bruv-claude-compat --input-format stream-json --output-format stream-json",
  "    --permission-mode bypassPermissions --allow-dangerously-skip-permissions",
  "    [--model provider/id] [--verbose] [--include-partial-messages]",
  "    [--append-system-prompt TEXT] [--no-session-persistence]",
  "  bruv-claude-compat -p --output-format json --json-schema JSON",
  '    [--model provider/id] [--tools ""] [--permission-mode dontAsk]',
  "    [--disable-slash-commands] [--strict-mcp-config] [PROMPT]",
  "  bruv-claude-compat --help | --version",
  "",
  "Stream stdin/stdout are NDJSON; auxiliary stdin is plain text and stdout is one",
  "validated structured_output result. Diagnostics go only to stderr.",
  "BRUV_CLAUDE_COMPAT_HOME selects isolated Bruv connector state (default:",
  "~/.bruv/claude-compat). No CLI state or real Claude history is migrated.",
  "BRUV_CLAUDE_COMPAT_BRUV_PATH selects the normal Bruv binary for child work",
  "(default: sibling bruv). Configure credentials/models in connector state.",
  "Persistent native sessions require an aligned, connector-owned CLAUDE_CONFIG_DIR",
  "(set the same T3 provider homePath). The real default Claude home is refused.",
  "Initialization checks local readiness, never provider access or subscription.",
  "Native permissions, injected MCP and canonical Pi history are bound. Unsupported",
  "Claude-only settings effects fail explicitly; execute is never aliased to Bash.",
  "",
].join("\n");

/** Structural port matches runtime.ts. An injected engine never boots Pi or
 * changes process identity, so launch glue can be tested before integration. */
export interface ConnectorRuntimeOptions {
  cwd: string;
  agentDir: string;
  emit(frame: WireMessage): void | Promise<void>;
  model?: string;
  appendSystemPrompt?: string[];
  auxiliary?: boolean;
  permissionMode?: string;
  executablePath?: string;
  request?: ClaudeCompatTransport["request"];
  configDir?: string;
  projectKey?: string;
  diagnostic?(error: unknown): void;
}
export interface ConnectorRuntime {
  onUser: TransportOptions["onUser"];
  controls: TransportOptions["controls"];
  close(): Promise<void>;
  runAuxiliary(text: string, schema: Record<string, unknown>): Promise<WireMessage>;
}
export type RuntimeFactory = (options: ConnectorRuntimeOptions, args: ConnectorArguments) => Promise<ConnectorRuntime>;
export interface ConnectorIO {
  input: Readable;
  output: Writable;
  stderr: Writable;
  cwd: string;
  env: NodeJS.ProcessEnv;
  home: string;
  signals: { on(event: string, listener: () => void): unknown; off(event: string, listener: () => void): unknown };
}

async function bootstrap(agentDir: string) {
  const root = join(agentDir, "runtime", product.version);
  const assets: Array<[string, string]> = [
    [metadata as unknown as string, "package.json"],
    [image, "assets/clankolas.png"],
    [dark as unknown as string, "theme/dark.json"],
    [light as unknown as string, "theme/light.json"],
    [themeSchema as unknown as string, "theme/theme-schema.json"],
    [template as unknown as string, "export-html/template.html"],
    [highlight, "export-html/vendor/highlight.min.js"],
    [marked, "export-html/vendor/marked.min.js"],
  ];
  for (const [source, relative] of assets) {
    const destination = join(root, relative);
    await mkdir(dirname(destination), { recursive: true });
    try {
      await writeFile(destination, await readFile(source), { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  process.title = "bruv-claude-compat";
  process.env.AI_AGENT = "bruv";
  process.env.PI_CODING_AGENT = "true";
  process.env.BRUV_CODING_AGENT_DIR = agentDir;
  process.env.PI_PACKAGE_DIR = root;
  process.env.PI_SKIP_VERSION_CHECK = "1";
  const { registerBunOAuthFlows } = await import("@earendil-works/pi-ai/bun-oauth");
  registerBunOAuthFlows();
  const { assertBruvPiHost } = await import("../pi-host");
  assertBruvPiHost();
}

const productionRuntime: RuntimeFactory = async (options, args) => {
  if (args.mode === "stream" && !args.noPersistence && !options.configDir)
    throw new Error(
      "Persistent native sessions require an explicit aligned CLAUDE_CONFIG_DIR (configure T3 provider homePath)",
    );
  if (args.mode === "stream" && !args.noPersistence && options.configDir === resolve(homedir(), ".claude"))
    throw new Error("Refusing to write the default Claude home; select a connector-owned native history home");
  await access(options.executablePath!);
  await bootstrap(options.agentDir);
  const { createClaudeCompatRuntime } = await import("./runtime");
  const { policy, authorize, setMode } = permissionBinding(args, options.request!);
  const settings = await scopedSettings(args, options.cwd, options.agentDir);
  const profilesPath = join(options.agentDir, "subagents.json");
  const profiles = await loadProfiles(profilesPath);
  const storage =
    args.mode === "auxiliary"
      ? undefined
      : await nativeStorage(args, {
          cwd: options.cwd,
          agentDir: options.agentDir,
          configDir: options.configDir ?? join(options.agentDir, "native-history"),
          projectKey: options.projectKey,
        });
  for (const directory of args.addDirs) await access(resolve(options.cwd, directory));
  let runtime: Awaited<ReturnType<typeof createClaudeCompatRuntime>> | undefined;
  // The app-owned server is identified by the credential-bearing native injection,
  // never by MCP annotations or a model supplied name. The server remains the
  // authority for its active run/provider, credentials and task lifecycle.
  const appServer = args.mcpConfig?.mcpServers && (args.mcpConfig.mcpServers as Record<string, any>)["t3-code"];
  const appOwnedServers =
    appServer?.type === "http" && /^Bearer \S+$/.test(appServer.headers?.Authorization ?? "") ? ["t3-code"] : [];
  let appWorker:
    | {
        type: "normal";
        target: { providerInstanceId: string; model: string; options: unknown[] };
        runtimeMode: string;
        interactionMode: string;
      }
    | undefined;
  try {
    const value = JSON.parse(await readFile(join(options.agentDir, "native-app-worker.json"), "utf8"));
    if (
      value.type !== "normal" ||
      !value.target ||
      typeof value.target.providerInstanceId !== "string" ||
      !value.target.providerInstanceId ||
      typeof value.target.model !== "string" ||
      !Array.isArray(value.target.options) ||
      !["approval-required", "auto-accept-edits", "auto", "full-access"].includes(value.runtimeMode) ||
      !["default", "plan"].includes(value.interactionMode)
    )
      throw new Error("Invalid explicit native app normal worker profile");
    appWorker = value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const prepareAppCall = (call: import("./permissions").PermissionRequest) => {
    if (call.owner !== "app_owned" || !call.toolName.endsWith("__delegate_task")) return call;
    if (
      !appWorker ||
      !profiles.normal.model ||
      !profiles.normal.thinking ||
      appWorker.target.model !== profiles.normal.model
    )
      throw new Error(
        "App delegation requires explicit normal model/thinking and matching native-app-worker.json target/options",
      );
    if (call.input.type === "orchestrator" || call.input.profile === "orchestrator")
      throw new Error("Native app delegation only permits non-orchestrator workers");
    return {
      ...call,
      input: {
        ...call.input,
        target: structuredClone(appWorker.target),
        runtimeMode: appWorker.runtimeMode,
        interactionMode: appWorker.interactionMode,
      },
    };
  };
  const mcp = args.mcpConfig
    ? await InjectedMcpSession.open(args.mcpConfig, {
        cwd: options.cwd,
        appOwnedServers,
        selectedTools: policy.tools,
        policy: {
          authorizeServer: async () => true,
          authorizeTool: async (call) => {
            const actual = prepareAppCall(call);
            const decision = await authorize(actual);
            return decision.behavior === "allow"
              ? { ...decision, updatedInput: decision.updatedInput ?? actual.input }
              : decision;
          },
          beforeAppOwnedCall: async (call) => {
            if (!runtime || runtime.session.isIdle)
              throw new Error("App-owned MCP requires an active owning model run");
            if (!runtime.session.model) throw new Error("No active provider");
            if (call.toolName.endsWith("__delegate_task")) {
              const admitted = prepareAppCall(call);
              if (
                JSON.stringify(call.input.target) !== JSON.stringify(admitted.input.target) ||
                call.input.runtimeMode !== admitted.input.runtimeMode ||
                call.input.interactionMode !== admitted.input.interactionMode
              )
                throw new Error("Human-updated app delegation must retain the configured normal worker profile");
              // Native server owns admission and returns its real task ID. No Bruv job is minted.
            }
          },
        },
      })
    : undefined;
  try {
    runtime = await createClaudeCompatRuntime({
      ...options,
      settingsManager: settings,
      permissionMode: policy.mode,
      authorizeTool: authorize,
      changePermissionMode: setMode,
      mcp,
      extensionFactories: mcp ? [{ name: "bruv-native-mcp", factory: mcpFactory(mcp), hidden: true }] : [],
      tools: policy.tools ?? ["execute", ...(mcp?.tools().map((t) => t.name) ?? [])],
      disableHooks: policy.disableHooks,
      disableSlashCommands: args.disableSlashCommands,
      thinkingLevel: policy.thinking as any,
      thinkingDisplay: policy.thinkingDisplay,
      ...(process.env.BRUV_CLAUDE_COMPAT_LOCAL_AUDIO_HOST
        ? { localAudio: { host: process.env.BRUV_CLAUDE_COMPAT_LOCAL_AUDIO_HOST } }
        : {}),
      profilesPath,
      ...(storage
        ? {
            sessionManager: storage.manager,
            nativeSessionId: storage.sessionId,
            history: storage.history,
            historyParentUuid: storage.parentUuid,
          }
        : {}),
    });
    return runtime;
  } catch (error) {
    await mcp?.close();
    throw error;
  }
};

function detail(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    if ("error" in error && typeof error.error === "string") return error.error;
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return String(error);
}
async function write(output: Writable, text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => output.write(text, (error) => (error ? reject(error) : resolve())));
}

export async function runConnector(
  argv: string[],
  factory: RuntimeFactory = productionRuntime,
  io: ConnectorIO = {
    input: process.stdin,
    output: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    env: process.env,
    home: homedir(),
    signals: process,
  },
): Promise<number> {
  let runtime: ConnectorRuntime | undefined;
  let transport: ClaudeCompatTransport | undefined;
  const transportBound = Promise.withResolvers<ClaudeCompatTransport>();
  void transportBound.promise.catch(() => {});
  let closing: Promise<void> | undefined;
  let shutdownError: unknown;
  let stopped: "EOF" | "SIGTERM" | "SIGINT" | undefined;
  const close = () => (runtime ? (closing ??= runtime.close()) : Promise.resolve());
  const stop = (reason: "EOF" | "SIGTERM" | "SIGINT") => {
    stopped ??= reason;
    transport?.close(new Error("Connector stopped: " + reason));
    io.input.destroy();
    void close().catch((error) => {
      shutdownError = error;
    });
  };
  const terminate = () => stop("SIGTERM"),
    interrupt = () => stop("SIGINT");
  const eof = () => stop("EOF");
  try {
    const args = parseConnectorArguments(argv);
    if (args.action !== "run") {
      await write(io.output, args.action === "version" ? CONNECTOR_VERSION + "\n" : CONNECTOR_HELP);
      return 0;
    }
    assertLaunchBindings(args);
    // Capture only explicit injected args; strip all root authority before imports
    // can initialize extensions or subprocesses. Normal CLI is unchanged.
    scrubRootEnvironmentInPlace(io.env);
    delete io.env.BRUV_WEB_TASK_EVENTS;
    delete process.env.BRUV_WEB_TASK_EVENTS;
    if (io.env !== process.env) scrubRootEnvironmentInPlace(process.env);
    const agentDir = resolve(io.env.BRUV_CLAUDE_COMPAT_HOME ?? join(io.home, ".bruv", "claude-compat"));
    const normalBinary = resolve(io.env.BRUV_CLAUDE_COMPAT_BRUV_PATH ?? join(dirname(process.execPath), "bruv"));
    io.signals.on("SIGTERM", terminate);
    io.signals.on("SIGINT", interrupt);
    runtime = await factory(
      {
        cwd: io.cwd,
        agentDir,
        model: args.model,
        appendSystemPrompt: args.appendSystemPrompt,
        auxiliary: args.mode === "auxiliary",
        permissionMode: args.mode === "auxiliary" ? "dontAsk" : args.permissionMode,
        executablePath: normalBinary,
        configDir: io.env.CLAUDE_CONFIG_DIR ? resolve(io.env.CLAUDE_CONFIG_DIR) : undefined,
        projectKey: io.env.CLAUDE_CODE_PROJECT_DIR_NAME,
        request: async (request, options) => {
          let abort: (() => void) | undefined;
          try {
            const cancelled = new Promise<never>((_resolve, reject) => {
              if (options?.signal?.aborted) reject(options.signal.reason);
              else if (options?.signal) {
                abort = () => reject(options.signal!.reason);
                options.signal.addEventListener("abort", abort, { once: true });
              }
            });
            const port = transport ?? (await Promise.race([transportBound.promise, cancelled]));
            options?.signal?.throwIfAborted();
            return await port.request(request, options);
          } finally {
            if (abort) options?.signal?.removeEventListener("abort", abort);
          }
        },
        emit: (frame) => {
          if (stopped) return;
          if (args.mode === "auxiliary")
            throw new Error("Auxiliary runtime must return a single result, not emit frames");
          if (frame.type === "stream_event" && !args.partialMessages) return;
          if (!transport) throw new Error("Runtime emitted before transport was bound");
          return transport.send(frame);
        },
        diagnostic: (error) => {
          io.stderr.write("[bruv-claude-compat] " + detail(error) + "\n");
        },
      },
      args,
    );
    if (stopped) {
      await close();
      return stopped === "SIGTERM" ? 143 : 130;
    }
    if (args.mode === "auxiliary") {
      let prompt = args.prompt;
      if (prompt === undefined) {
        const chunks: Buffer[] = [];
        for await (const chunk of io.input) chunks.push(Buffer.from(chunk));
        prompt = Buffer.concat(chunks).toString("utf8");
      }
      if (!prompt.trim()) throw new Error("Auxiliary prompt is empty");
      const result = await runtime.runAuxiliary(prompt, args.schema!);
      if (!stopped) await write(io.output, JSON.stringify(result) + "\n");
    } else {
      transport = new ClaudeCompatTransport({
        input: io.input,
        output: io.output,
        stderr: io.stderr,
        onUser: runtime.onUser,
        controls: runtime.controls,
      });
      transportBound.resolve(transport);
      io.input.on("end", eof);
      try {
        await transport.run();
      } catch (error) {
        if (!stopped) throw error;
      }
    }
    await close();
    if (shutdownError) throw shutdownError;
    return stopped === "SIGTERM" ? 143 : stopped === "SIGINT" ? 130 : 0;
  } catch (error) {
    if (stopped && !shutdownError) {
      try {
        await close();
        return stopped === "SIGTERM" ? 143 : stopped === "SIGINT" ? 130 : 0;
      } catch (shutdown) {
        io.stderr.write("[bruv-claude-compat] shutdown failed: " + detail(shutdown) + "\n");
        return 1;
      }
    }
    io.stderr.write("[bruv-claude-compat] " + detail(error) + "\n");
    return 1;
  } finally {
    transportBound.reject(new Error("Connector closed before native transport binding"));
    io.input.off("end", eof);
    io.signals.off("SIGTERM", terminate);
    io.signals.off("SIGINT", interrupt);
    transport?.close();
    try {
      await close();
    } catch (error) {
      io.stderr.write("[bruv-claude-compat] shutdown failed: " + detail(error) + "\n");
    }
  }
}

if (import.meta.main) process.exitCode = await runConnector(process.argv.slice(2));
