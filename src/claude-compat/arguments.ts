import { launchPolicy } from "./binding";
export interface ConnectorArguments {
  action: "help" | "version" | "bruv-version" | "run";
  mode: "stream" | "auxiliary";
  model?: string;
  prompt?: string;
  schema?: Record<string, unknown>;
  appendSystemPrompt: string[];
  partialMessages: boolean;
  verbose: boolean;
  noPersistence: boolean;
  permissionMode?: string;
  allowBypass: boolean;
  permissionPromptTool?: string;
  tools?: string;
  allowedTools?: string;
  disallowedTools?: string;
  disableSlashCommands: boolean;
  settings?: Record<string, unknown>;
  settingSources?: string;
  strictMcp: boolean;
  mcpConfig?: Record<string, unknown>;
  sessionId?: string;
  resume?: string;
  resumeAt?: string;
  addDirs: string[];
  effort?: string;
  thinking?: string;
  thinkingDisplay?: string;
  maxThinkingTokens?: number;
}

function objectJson(value: string, flag: string): Record<string, unknown> {
  let result: unknown;
  try {
    result = JSON.parse(value);
  } catch {
    throw new Error(flag + " requires a JSON object");
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error(flag + " requires a JSON object");
  return result as Record<string, unknown>;
}

/** The native host has no negotiated flag grammar. Parse its concrete launch
 * vocabulary; unsupported semantics are rejected separately, before startup. */
export function parseConnectorArguments(argv: string[]): ConnectorArguments {
  const result: ConnectorArguments = {
    action: "run",
    mode: "stream",
    appendSystemPrompt: [],
    partialMessages: false,
    verbose: false,
    noPersistence: false,
    allowBypass: false,
    disableSlashCommands: false,
    strictMcp: false,
    addDirs: [],
  };
  if (argv.length === 1 && ["--help", "-h", "--version", "-v", "--bruv-version"].includes(argv[0]!)) {
    result.action =
      argv[0] === "--bruv-version" ? "bruv-version" : argv[0] === "--help" || argv[0] === "-h" ? "help" : "version";
    return result;
  }
  let print = false,
    input: string | undefined,
    output: string | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!;
    if (!argument.startsWith("-")) {
      if (!print || result.prompt !== undefined) throw new Error("Unexpected positional argument");
      result.prompt = argument;
      continue;
    }
    const split = argument.indexOf("=");
    const flag = split < 0 ? argument : argument.slice(0, split);
    const inline = split < 0 ? undefined : argument.slice(split + 1);
    if (seen.has(flag) && flag !== "--append-system-prompt" && flag !== "--add-dir" && flag !== "--thinking-display")
      throw new Error("Duplicate option: " + flag);
    seen.add(flag);
    const value = () => {
      if (inline !== undefined) return inline;
      const next = argv[++i];
      if (next === undefined || next.startsWith("--")) throw new Error(flag + " requires a value");
      return next;
    };
    const toggle = () => {
      if (inline !== undefined) throw new Error(flag + " does not take a value");
      return true;
    };
    switch (flag) {
      case "-p":
      case "--print":
        print = toggle();
        break;
      case "--input-format":
        input = value();
        break;
      case "--output-format":
        output = value();
        break;
      case "--verbose":
        result.verbose = toggle();
        break;
      case "--include-partial-messages":
        result.partialMessages = toggle();
        break;
      case "--no-session-persistence":
        result.noPersistence = toggle();
        break;
      case "--allow-dangerously-skip-permissions":
        result.allowBypass = toggle();
        break;
      case "--disable-slash-commands":
        result.disableSlashCommands = toggle();
        break;
      case "--strict-mcp-config":
        result.strictMcp = toggle();
        break;
      case "--model":
        result.model = value();
        if (!/^[^/\s]+\/[^\s]+$/.test(result.model))
          throw new Error("--model requires exact provider/id; Claude aliases are not Bruv models");
        break;
      case "--append-system-prompt":
        result.appendSystemPrompt.push(value());
        break;
      case "--add-dir":
        result.addDirs.push(value());
        break;
      case "--tools":
        result.tools = value();
        break;
      case "--allowedTools":
        result.allowedTools = value();
        break;
      case "--disallowedTools":
        result.disallowedTools = value();
        break;
      case "--permission-mode":
        result.permissionMode = value();
        break;
      case "--permission-prompt-tool":
        result.permissionPromptTool = value();
        break;
      case "--settings":
        result.settings = objectJson(value(), flag);
        break;
      case "--setting-sources":
        result.settingSources = value();
        break;
      case "--mcp-config":
        result.mcpConfig = objectJson(value(), flag);
        break;
      case "--json-schema":
        result.schema = objectJson(value(), flag);
        break;
      case "--session-id":
        result.sessionId = value();
        break;
      case "--resume":
        result.resume = value();
        break;
      case "--resume-session-at":
        result.resumeAt = value();
        break;
      case "--effort":
        result.effort = value();
        break;
      case "--thinking":
        result.thinking = value();
        break;
      case "--thinking-display":
        {
          const display = value();
          if (result.thinkingDisplay !== undefined && result.thinkingDisplay !== display)
            throw new Error("Conflicting --thinking-display options");
          result.thinkingDisplay = display;
        }
        break;
      case "--max-thinking-tokens": {
        const v = value();
        result.maxThinkingTokens = Number(v);
        if (!/^\d+$/.test(v) || !Number.isSafeInteger(result.maxThinkingTokens))
          throw new Error(flag + " requires a nonnegative integer");
        break;
      }
      default:
        throw new Error("Unknown connector option: " + flag);
    }
  }
  if (print && output === "json") {
    result.mode = "auxiliary";
    if (input !== undefined && input !== "text") throw new Error("Auxiliary JSON input must be plain text");
    if (!result.schema) throw new Error("Auxiliary JSON mode requires --json-schema");
  } else {
    if (print || output !== "stream-json" || input !== "stream-json")
      throw new Error(
        "Use --input-format stream-json --output-format stream-json, or -p --output-format json --json-schema JSON",
      );
    if (result.schema) throw new Error("--json-schema is only supported in auxiliary JSON mode");
  }
  return result;
}

/** Every accepted flag must have a real production effect. */
export function assertLaunchBindings(args: ConnectorArguments): void {
  launchPolicy(args);
  if (args.resumeAt && !args.resume) throw new Error("--resume-session-at requires --resume");
  if (args.noPersistence && (args.resume || args.resumeAt)) throw new Error("Resume requires persistence");
  if (args.mode === "auxiliary") {
    if (args.tools !== undefined && args.tools !== "") throw new Error('Auxiliary mode is tool-free; use --tools ""');
    if (args.permissionMode !== undefined && args.permissionMode !== "dontAsk")
      throw new Error("Auxiliary mode supports only dontAsk permissions");
    if (args.partialMessages) throw new Error("Auxiliary mode does not emit partial messages");
    if (args.mcpConfig && Object.keys((args.mcpConfig.mcpServers as object) ?? {}).length)
      throw new Error("Auxiliary mode is tool-free; MCP servers are unsupported");
    if (args.resume || args.sessionId || args.resumeAt)
      throw new Error("Auxiliary mode uses an isolated in-memory session");
  }
}
