import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolResultSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { childAgentEnvironment } from "../delegation-environment";
import { matchesToolRule, type PermissionDecision, type PermissionRequest, type ToolOwner } from "./permissions";

const serverName = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const timeout = z.number().int().positive().optional();
const httpServer = z
  .object({
    type: z.literal("http").optional(),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    timeout,
  })
  .strict();
const stdioServer = z
  .object({
    type: z.literal("stdio").optional(),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    timeout,
  })
  .strict();
const configSchema = z.object({ mcpServers: z.record(serverName, z.union([httpServer, stdioServer])) }).strict();
export type InjectedMcpConfig = z.infer<typeof configSchema>;
export type InjectedMcpServer = InjectedMcpConfig["mcpServers"][string];

/** Only caller-injected config. No global settings discovery or old T3 environment bridge. */
export function parseInjectedMcpConfig(value: unknown): InjectedMcpConfig {
  const result = configSchema.safeParse(value);
  if (!result.success) throw new Error("Invalid injected MCP config (supported transports: http and stdio)");
  for (const server of Object.values(result.data.mcpServers)) {
    if (!("url" in server)) continue;
    let url: URL;
    try {
      url = new URL(server.url);
    } catch {
      throw new Error("Invalid MCP endpoint");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
      throw new Error("MCP endpoint must be HTTP(S), without URL credentials or fragment");
  }
  return result.data;
}

export interface McpSessionPolicy {
  /** Trusted binding decides endpoint/command admission BEFORE any network or process launch. */
  authorizeServer(name: string, server: Readonly<InjectedMcpServer>, signal: AbortSignal): Promise<boolean>;
  /** Discovery and tool selection are not approval. Called on EVERY actual call. */
  authorizeTool(request: PermissionRequest): Promise<PermissionDecision>;
  /** Trusted binding checks active T3 run/provider/normal-worker policy, including updated input. */
  beforeAppOwnedCall?: (request: PermissionRequest) => Promise<void>;
}
export interface McpSessionOptions {
  cwd: string;
  policy: McpSessionPolicy;
  /** Selection independent of allowedTools; absent = all discovered tools, [] = none. */
  selectedTools?: readonly string[];
  /** Binding-supplied trusted ownership, never a model role or a server annotation. */
  appOwnedServers: readonly string[];
  signal?: AbortSignal;
}
export interface InjectedMcpTool {
  name: string;
  serverName: string;
  remoteName: string;
  owner: ToolOwner;
  description?: string;
  inputSchema: Tool["inputSchema"];
  annotations?: Tool["annotations"];
}
type Connection = {
  client: Client;
  transport: Transport;
  timeout: number;
  status: "connecting" | "connected" | "closed" | "close-failed";
  closing?: Promise<void>;
};
export class McpOperationError extends Error {
  constructor(
    readonly code: "connection-failed" | "call-failed" | "permission-denied" | "closed" | "teardown-failed",
    message: string,
  ) {
    super(message);
    this.name = "McpOperationError";
  }
}

/** Owns connection lifetime ONLY. App tasks and Bruv jobs keep their existing distinct owners. */
export class InjectedMcpSession {
  private readonly lifetime = new AbortController();
  private readonly connections = new Map<string, Connection>();
  private readonly registry = new Map<string, InjectedMcpTool>();
  private readonly appHttpServers = new Map<string, InjectedMcpServer>();
  private closed = false;
  private closing?: Promise<void>;
  private resuming?: Promise<void>;
  private unbindAbort?: () => void;
  private constructor(private readonly options: McpSessionOptions) {}

  static async open(config: unknown, options: McpSessionOptions): Promise<InjectedMcpSession> {
    if (!Array.isArray(options.appOwnedServers))
      throw new Error("Trusted binding must explicitly classify app-owned MCP servers");
    const parsed = parseInjectedMcpConfig(config); // Zod clones: caller cannot replace credentials after admission.
    const session = new InjectedMcpSession({
      ...options,
      policy: { ...options.policy },
      selectedTools: options.selectedTools && [...options.selectedTools],
      appOwnedServers: [...(options.appOwnedServers ?? [])],
    });
    if (options.signal) {
      options.signal.throwIfAborted();
      const abort = () => {
        void session.close().catch(() => {});
      };
      options.signal.addEventListener("abort", abort, { once: true });
      session.unbindAbort = () => options.signal?.removeEventListener("abort", abort);
    }
    try {
      for (const [name, server] of Object.entries(parsed.mcpServers)) {
        if ("url" in server && options.appOwnedServers.includes(name)) session.appHttpServers.set(name, server);
        const connection = await session.startConnection(name, server);
        await session.discoverTools(name, connection);
        connection.status = "connected";
      }
      await session.parkAppOwned();
      return session;
    } catch {
      try {
        await session.close();
      } catch {
        throw new McpOperationError(
          "teardown-failed",
          "MCP discovery failed and connection teardown was not fully confirmed",
        );
      }
      // SDK/transport errors can include credential-bearing config; never forward their prose/cause.
      throw new McpOperationError("connection-failed", "Injected MCP discovery failed or was denied");
    }
  }

  private async startConnection(name: string, server: InjectedMcpServer): Promise<Connection> {
    const signal = this.lifetime.signal;
    signal.throwIfAborted();
    if (!(await this.options.policy.authorizeServer(name, structuredClone(server), signal)))
      throw new Error("MCP server denied");
    signal.throwIfAborted();
    const requestTimeout = server.timeout ?? 30_000;
    let transport: Transport;
    if ("url" in server) {
      transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: server.headers, redirect: "error" },
        fetch: (url, init) =>
          fetch(url, {
            ...init,
            redirect: "error",
            signal: AbortSignal.any([
              ...(init?.signal ? [init.signal] : []),
              // Cleanup is part of the owning run. A busy host gets the same
              // configured deadline as its other requests, not a hidden five-second cap.
              AbortSignal.timeout(requestTimeout),
            ]),
          }),
        reconnectionOptions: {
          maxRetries: 0,
          initialReconnectionDelay: 1000,
          maxReconnectionDelay: 1000,
          reconnectionDelayGrowFactor: 1,
        },
      });
    } else {
      const env = Object.fromEntries(
        Object.entries(childAgentEnvironment(server.env ?? {})).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      const stdio = new StdioClientTransport({
        command: server.command,
        args: server.args,
        env,
        cwd: this.options.cwd,
        stderr: "pipe",
      });
      // Drain but never log arbitrary server stderr (may contain tokens/config).
      stdio.stderr?.on("data", () => {});
      transport = stdio;
    }
    const client = new Client({ name: "bruv-claude-compat", version: "1" }, { capabilities: {} });
    const connection: Connection = { client, transport, timeout: requestTimeout, status: "connecting" };
    this.connections.set(name, connection);
    client.onclose = () => {
      connection.status = "closed";
    };
    client.onerror = () => {}; // Errors delivered to the outstanding SDK request, not stdout/stderr.
    await client.connect(transport, { signal, timeout: requestTimeout });
    signal.throwIfAborted();
    return connection;
  }

  /** Populate the tool catalog once; acquiring another app lease does not rediscover tools. */
  private async discoverTools(name: string, connection: Connection): Promise<void> {
    const signal = this.lifetime.signal;
    let cursor: string | undefined;
    do {
      const listed = await connection.client.listTools(cursor ? { cursor } : {}, {
        signal,
        timeout: connection.timeout,
      });
      for (const tool of listed.tools) {
        // The removed patched Bruv task bridge is not a native app delegation surface.
        if (tool.name.startsWith("bruv_task_")) continue;
        const toolName = `mcp__${name}__${tool.name}`;
        if (this.options.selectedTools && !this.options.selectedTools.some((rule) => matchesToolRule(toolName, rule)))
          continue;
        if (this.registry.has(toolName)) throw new Error("Ambiguous MCP tool name");
        this.registry.set(toolName, {
          name: toolName,
          serverName: name,
          remoteName: tool.name,
          owner: this.options.appOwnedServers?.includes(name) ? "app_owned" : "external",
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        });
      }
      cursor = listed.nextCursor;
    } while (cursor !== undefined);
  }

  tools(): InjectedMcpTool[] {
    return this.closed ? [] : structuredClone([...this.registry.values()]);
  }
  status(): { name: string; status: Connection["status"] }[] {
    return [...this.connections].map(([name, connection]) => ({ name, status: connection.status }));
  }

  async callTool(
    name: string,
    input: Record<string, unknown>,
    options: { toolUseId: string; signal?: AbortSignal },
  ): Promise<CallToolResult> {
    if (this.closed) throw new McpOperationError("closed", "MCP session is closed");
    const tool = this.registry.get(name);
    if (!tool) throw new McpOperationError("permission-denied", "MCP tool is not selected or discovered");
    const signal = AbortSignal.any([this.lifetime.signal, ...(options.signal ? [options.signal] : [])]);
    signal.throwIfAborted();
    const submitted = structuredClone(input);
    const request: PermissionRequest = {
      toolName: name,
      input: structuredClone(submitted),
      toolUseId: options.toolUseId,
      // readOnlyHint is untrusted metadata, not sandbox policy.
      effect: "mcp",
      owner: tool.owner,
      signal,
    };
    const decision = await this.options.policy.authorizeTool(request);
    signal.throwIfAborted();
    if (decision.behavior !== "allow") throw new McpOperationError("permission-denied", decision.message);
    const approved = { ...request, input: structuredClone(decision.updatedInput ?? submitted) };
    if (tool.owner === "app_owned") {
      if (!this.options.policy.beforeAppOwnedCall)
        throw new McpOperationError(
          "permission-denied",
          "App-owned MCP needs trusted policy for the active run and provider",
        );
      await this.options.policy.beforeAppOwnedCall(approved);
      signal.throwIfAborted();
    }
    if (tool.owner === "app_owned") await this.resumeAppOwned();
    const connection = this.connections.get(tool.serverName);
    if (connection?.status !== "connected") throw new McpOperationError("closed", "MCP connection is not open");
    try {
      // SDK 1.27.1 incorrectly validates error structuredContent against the
      // success schema. Official T3 also returns OrchestratorMcpFailure with
      // isError:false. Translate that known app-owned failure, preserve its
      // original content, and skip only the success-only error validation.
      let errorResult: CallToolResult | undefined;
      const resultSchema = CallToolResultSchema.transform((result) => {
        const appFailure = tool.owner === "app_owned" && result.structuredContent?._tag === "OrchestratorMcpFailure";
        if (!result.isError && !appFailure) return result;
        errorResult = { ...result, isError: true };
        const { structuredContent: _error, ...rest } = result;
        return { ...rest, isError: true };
      });
      // Exactly one call. No delegate_task retry, local launch, job ACK, or task-ID reinterpretation.
      const result = await connection.client.callTool(
        { name: tool.remoteName, arguments: approved.input },
        resultSchema as unknown as typeof CallToolResultSchema,
        {
          signal,
          timeout: connection.timeout,
        },
      );
      signal.throwIfAborted();
      return errorResult ?? (result as CallToolResult);
    } catch {
      throw new McpOperationError(
        "call-failed",
        "MCP call failed; the remote mutation may have happened. It was not retried.",
      );
    }
  }

  /** Release app-owned HTTP leases while the owning run's host is still alive.
   * External MCP servers keep their ordinary persistent connection lifetime. */
  async parkAppOwned(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.appHttpServers.keys()].map((name) => this.closeConnection(this.connections.get(name)!)),
    );
    this.assertClosed(results);
  }

  /** Pi preflight reacquires each app HTTP lease before the next owning run. */
  resumeAppOwned(): Promise<void> {
    this.resuming ??= (async () => {
      if (this.closed) throw new McpOperationError("closed", "MCP session is closed");
      for (const [name, server] of this.appHttpServers) {
        const connection = this.connections.get(name)!;
        if (connection.closing) await connection.closing;
        if (connection.status === "closed") {
          try {
            const resumed = await this.startConnection(name, server);
            resumed.status = "connected";
          } catch {
            await this.closeConnection(this.connections.get(name)!);
            throw new McpOperationError("connection-failed", "Reconnect to app-owned MCP failed or was denied");
          }
        }
      }
    })().finally(() => {
      this.resuming = undefined;
    });
    return this.resuming;
  }

  private closeConnection(connection: Connection): Promise<void> {
    connection.closing ??= (async () => {
      let failed = false;
      try {
        if (connection.transport instanceof StreamableHTTPClientTransport && connection.transport.sessionId)
          await connection.transport.terminateSession();
      } catch {
        failed = true;
      }
      try {
        await connection.client.close();
      } catch {
        failed = true;
      }
      connection.status = failed ? "close-failed" : "closed";
      if (failed) throw new Error("MCP teardown failed");
    })();
    return connection.closing;
  }

  private assertClosed(results: PromiseSettledResult<void>[]): void {
    if (results.some((result) => result.status === "rejected"))
      throw new McpOperationError("teardown-failed", "MCP connection teardown was not fully confirmed");
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.lifetime.abort();
    this.unbindAbort?.();
    this.registry.clear();
    this.closing = Promise.allSettled(
      [...this.connections.values()].map((connection) => this.closeConnection(connection)),
    ).then((results) => this.assertClosed(results));
    return this.closing;
  }
}
