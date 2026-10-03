import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ExtensionFactory, SessionManager as PiSessionManager } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import type { ConnectorArguments } from "./arguments";
import { createPermissionPolicy, type PermissionMode, type PermissionRequest } from "./permissions";
import type { TaskLaunch } from "../tasks/task-manager";

import { InjectedMcpSession, parseInjectedMcpConfig } from "./mcp";

import type { ClaudeCompatTransport } from "./transport";

const nativeNames: Record<string, string> = {
  Bash: "bash",
  Read: "read",
  Edit: "edit",
  Write: "write",
  Grep: "grep",
  Glob: "find",
  LS: "ls",
};
export function toolRules(value?: string): string[] {
  return (value ?? "")
    .split(/[ ,]+/)
    .filter(Boolean)
    .map((rule) => {
      if (rule === "Bash(*)") return "bash";
      if (/[()]/.test(rule)) throw new Error("Unsupported tool rule: " + rule);
      return nativeNames[rule] ?? rule;
    });
}
export function launchPolicy(args: ConnectorArguments) {
  for (const id of [args.sessionId, args.resume, args.resumeAt])
    if (id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      throw new Error("Native session/message ID must be a UUID");
  if (args.sessionId && args.resume) throw new Error("Use --resume or --session-id, not both");
  if (args.mcpConfig) parseInjectedMcpConfig(args.mcpConfig);
  const settings = args.settings ?? {};
  const supported = ["disableAllHooks", "permissions", "env", "alwaysThinkingEnabled", "showThinkingSummaries"];
  for (const key of Object.keys(settings))
    if (!supported.includes(key)) throw new Error("Unsupported --settings effect: " + key);
  if (settings.disableAllHooks !== undefined && settings.disableAllHooks !== true)
    throw new Error("Native hooks are unsupported; disableAllHooks must be true");
  if (settings.alwaysThinkingEnabled !== undefined && typeof settings.alwaysThinkingEnabled !== "boolean")
    throw new Error("alwaysThinkingEnabled must be boolean");
  if (settings.showThinkingSummaries !== undefined && typeof settings.showThinkingSummaries !== "boolean")
    throw new Error("showThinkingSummaries must be boolean");
  const permissions = settings.permissions as Record<string, unknown> | undefined;
  if (permissions && (typeof permissions !== "object" || Array.isArray(permissions)))
    throw new Error("Invalid settings permissions");
  for (const key of Object.keys(permissions ?? {}))
    if (!["allow", "deny", "defaultMode"].includes(key)) throw new Error("Unsupported settings permission: " + key);
  const rules = (key: string) => {
    const value = permissions?.[key];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new Error("Invalid permission rules");
    return value.flatMap((v) => toolRules(v));
  };
  const mode = args.permissionMode ?? permissions?.defaultMode ?? "default";
  if (!["default", "acceptEdits", "dontAsk", "plan", "bypassPermissions"].includes(String(mode)))
    throw new Error("Unsupported permission mode: " + mode);
  if (mode === "bypassPermissions" && !args.allowBypass)
    throw new Error("bypassPermissions requires explicit --allow-dangerously-skip-permissions");
  if (args.permissionPromptTool !== undefined && args.permissionPromptTool !== "stdio")
    throw new Error("Only --permission-prompt-tool stdio is supported");
  if (
    args.settingSources !== undefined &&
    args.settingSources
      .split(",")
      .filter(Boolean)
      .some((s) => !["user", "project", "local"].includes(s))
  )
    throw new Error("Unsupported --setting-sources");
  const env = settings.env as Record<string, unknown> | undefined;
  const disabledEnv: Record<string, string> = {
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    CLAUDE_CODE_AUTO_CONNECT_IDE: "0",
    CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: "1",
  };
  if (env && (typeof env !== "object" || Array.isArray(env))) throw new Error("Invalid settings env");
  for (const [key, value] of Object.entries(env ?? {}))
    if (disabledEnv[key] !== value) throw new Error("Unsupported settings env effect: " + key);
  // No claude.ai/IDE discovery exists in this engine. Injected MCP is the only server source.
  let thinking = args.thinking ?? (settings.alwaysThinkingEnabled === false ? "off" : undefined);
  const adaptiveThinking = thinking === "adaptive" || thinking === "enabled";
  if (adaptiveThinking) thinking = undefined;
  if (thinking === "disabled") thinking = "off";
  const effort = args.effort;
  if (effort !== undefined) {
    if (!["low", "medium", "high", "xhigh", "max"].includes(effort)) throw new Error("Unsupported --effort");
    if (thinking !== undefined && thinking !== "off" && thinking !== effort)
      throw new Error("Conflicting --thinking and --effort levels; Bruv exposes one reasoning level");
    if (thinking === undefined) thinking = effort;
  }
  if (thinking === undefined && (adaptiveThinking || settings.alwaysThinkingEnabled === true)) thinking = "high";
  if (thinking !== undefined && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinking))
    throw new Error("Unsupported --thinking; use a Bruv thinking level");
  const thinkingDisplay = args.thinkingDisplay ?? (settings.showThinkingSummaries === true ? "summarized" : undefined);
  if (thinkingDisplay !== undefined && !["summarized", "omitted"].includes(thinkingDisplay))
    throw new Error("Unsupported --thinking-display");
  if (args.maxThinkingTokens !== undefined)
    throw new Error("--max-thinking-tokens is not supported by the Bruv engine");
  return {
    mode: mode as PermissionMode,
    allowedTools: [...rules("allow"), ...toolRules(args.allowedTools)],
    disallowedTools: [...rules("deny"), ...toolRules(args.disallowedTools)],
    thinking,
    thinkingDisplay,
    disableHooks: settings.disableAllHooks === true,
    tools: args.tools === undefined || args.tools === "default" ? undefined : toolRules(args.tools),
  };
}

export async function nativeStorage(
  args: ConnectorArguments,
  options: { cwd: string; agentDir: string; configDir: string; projectKey?: string },
) {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const { NativeHistory, importNativeHistory, readNativeHistory, nativeHistoryToPi } = await import("./history");
  const sessionId = args.resume ?? args.sessionId ?? randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId))
    throw new Error("Native session ID must be a UUID");
  if (args.resume && args.sessionId) throw new Error("Use --resume or --session-id, not both");
  if (args.noPersistence) {
    if (args.resume || args.resumeAt) throw new Error("Resume requires session persistence");
    return { sessionId, manager: SessionManager.inMemory(options.cwd), history: undefined };
  }
  const directory = join(options.agentDir, "native-sessions");
  const index = join(directory, sessionId + ".json");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let binding: { file: string; cwd: string; configDir: string } | undefined;
  try {
    binding = JSON.parse(await readFile(index, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (binding && !args.resume) throw new Error("Native session already exists; use --resume");
  if (binding && (binding.cwd !== resolve(options.cwd) || binding.configDir !== resolve(options.configDir)))
    throw new Error("Native session home/cwd binding mismatch");
  const location = { ...options, sessionId };
  const imported =
    args.resume && !binding ? await importNativeHistory({ ...location, sessionDir: directory }) : undefined;
  let manager =
    imported?.sessionManager ??
    (binding ? SessionManager.open(binding.file) : SessionManager.create(options.cwd, directory));
  if (!binding && !imported) {
    // Same canonical header-persistence recipe as prepareAgentSession: retain
    // identity even if a new thread closes before its first assistant response.
    const file = manager.getSessionFile()!;
    await writeFile(file, JSON.stringify(manager.getHeader()) + "\n", { flag: "wx", mode: 0o600 });
    manager = SessionManager.open(file);
  }
  const history =
    imported?.history ??
    (manager.getEntries().some((e) => e.type === "custom" && e.customType === "bruv-native-entry-map")
      ? await NativeHistory.resumeImported({ ...location, sourceSessionId: manager.getSessionId() }, manager)
      : await NativeHistory.open({ ...location, sourceSessionId: manager.getSessionId() }));
  let parentUuid: string | undefined;
  if (args.resumeAt) {
    if (!args.resume) throw new Error("--resume-session-at requires --resume");
    const entries = await readNativeHistory(location);
    const checkpoint = entries.find((e) => e.uuid === args.resumeAt);
    if (!checkpoint) throw new Error("Unknown native checkpoint");
    // Validate complete context before changing Pi's leaf. Never reexecute an imported tool.
    nativeHistoryToPi(entries.slice(0, entries.indexOf(checkpoint) + 1), sessionId);
    const mapping =
      imported?.entries ??
      manager
        .getEntries()
        .filter((e) => e.type === "custom" && e.customType === "bruv-native-entry-map")
        .flatMap((e) => (e as any).data.entries);
    const id =
      checkpoint.bruv?.sourceSessionId === manager.getSessionId()
        ? checkpoint.bruv.sourceMessageId
        : mapping.find((e) => e.nativeUuid === args.resumeAt)?.piEntryId;
    if (!id || !manager.getEntry(id)) throw new Error("Checkpoint has no canonical Pi source entry");
    manager.branch(id);
    parentUuid = args.resumeAt;
  }
  if (!binding)
    await writeFile(
      index,
      JSON.stringify({
        file: manager.getSessionFile(),
        cwd: resolve(options.cwd),
        configDir: resolve(options.configDir),
      }),
      { flag: "wx", mode: 0o600 },
    );
  return { sessionId, manager, history, parentUuid };
}

export function permissionBinding(args: ConnectorArguments, request: ClaudeCompatTransport["request"]) {
  const policy = launchPolicy(args);
  const buildPolicy = (mode: PermissionMode) =>
    createPermissionPolicy({
      ...policy,
      mode,
      allowDangerouslySkipPermissions: args.allowBypass,
      canUseTool: async (call) => {
        const response = await request(
          { subtype: "can_use_tool", tool_name: call.toolName, tool_use_id: call.toolUseId, input: call.input },
          { signal: call.signal },
        );
        if (response.behavior === "deny")
          return {
            behavior: "deny",
            message: typeof response.message === "string" ? response.message : "Human denied permission",
          };
        if (response.behavior !== "allow") throw new Error("Invalid native permission response");
        if (response.toolUseID !== undefined && response.toolUseID !== call.toolUseId)
          throw new Error("Permission correlation mismatch");
        const updatedInput = response.updatedInput;
        if (
          updatedInput !== undefined &&
          (!updatedInput || typeof updatedInput !== "object" || Array.isArray(updatedInput))
        )
          throw new Error("Invalid updated permission input");
        return { behavior: "allow", updatedInput: updatedInput as Record<string, unknown> | undefined };
      },
    });
  let authorize = buildPolicy(policy.mode);
  return {
    policy,
    authorize: (call: PermissionRequest) => authorize(call),
    setMode(mode: string) {
      if (!["default", "acceptEdits", "dontAsk", "plan", "bypassPermissions"].includes(mode))
        throw new Error("Unsupported permission mode");
      authorize = buildPolicy(mode as PermissionMode);
    },
  };
}

export function mcpFactory(mcp: InjectedMcpSession): ExtensionFactory {
  return (pi) => {
    for (const tool of mcp.tools())
      pi.registerTool({
        name: tool.name,
        label: tool.name,
        description: tool.description ?? tool.name,
        parameters: tool.inputSchema as TSchema,
        async execute(id, input, signal) {
          const result = await mcp.callTool(tool.name, input as Record<string, unknown>, { toolUseId: id, signal });
          if (result.isError) throw new Error("MCP tool reported an error");
          return {
            content: result.content.flatMap<
              import("@earendil-works/pi-ai").TextContent | import("@earendil-works/pi-ai").ImageContent
            >((block) =>
              block.type === "text" && typeof block.text === "string"
                ? [{ type: "text" as const, text: block.text }]
                : block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string"
                  ? [{ type: "image" as const, data: block.data, mimeType: block.mimeType }]
                  : [{ type: "text" as const, text: JSON.stringify(block) }],
            ),
            details: {},
          };
        },
      });
  };
}

export async function scopedSettings(args: ConnectorArguments, cwd: string, agentDir: string) {
  const { SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const settings = SettingsManager.create(cwd, agentDir);
  if (args.settingSources === undefined) return settings;
  const sources = args.settingSources.split(",");
  return SettingsManager.inMemory(
    {
      ...(sources.includes("user") ? settings.getGlobalSettings() : {}),
      ...(sources.includes("project") || sources.includes("local") ? settings.getProjectSettings() : {}),
      cacheWarming: "off",
    },
    { projectTrusted: settings.isProjectTrusted() },
  );
}

// JobService builds ordinary CLI child arguments with process.execPath. In the
// dedicated native binary that path is the connector, not the normal CLI. Route
// only real local agent launches belonging to this canonical Pi owner. Keep the
// existing manager, IDs, profile resolution, scheduling and cancellation intact.
const childExecutables = new Map<PiSessionManager, string>();
let restoreChildLaunches: (() => void) | undefined;
export async function bindNativeChildExecutable(manager: PiSessionManager, executable: string): Promise<() => void> {
  const { TaskManager } = await import("../tasks/task-manager");
  const { sessionIdentity } = await import("../session/identity");
  childExecutables.set(manager, executable);
  if (!restoreChildLaunches) {
    const spawn = TaskManager.prototype.spawn;
    const activate = TaskManager.prototype.activatePreparedAgent;
    const route = <T extends Pick<TaskLaunch, "command" | "agent">>(launch: T): T => {
      if (launch.command !== process.execPath || !launch.agent?.parentSessionFile) return launch;
      for (const [owner, binary] of childExecutables)
        if (launch.agent.parentSessionFile === sessionIdentity(owner)?.file) return { ...launch, command: binary };
      return launch;
    };
    TaskManager.prototype.spawn = function (launch) {
      return spawn.call(this, launch.kind === "agent" ? route(launch) : launch);
    };
    TaskManager.prototype.activatePreparedAgent = function (id, launch) {
      return activate.call(this, id, route(launch));
    };
    restoreChildLaunches = () => {
      TaskManager.prototype.spawn = spawn;
      TaskManager.prototype.activatePreparedAgent = activate;
    };
  }
  return () => {
    childExecutables.delete(manager);
    if (!childExecutables.size) {
      restoreChildLaunches?.();
      restoreChildLaunches = undefined;
    }
  };
}
