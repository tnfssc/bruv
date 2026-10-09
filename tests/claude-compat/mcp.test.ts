import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { InjectedMcpSession, type McpSessionPolicy, parseInjectedMcpConfig } from "../../src/claude-compat/mcp";
import { createPermissionPolicy } from "../../src/claude-compat/permissions";

import { httpMcpLifecycleFixture } from "./fixtures/http-mcp-lifecycle";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const allow: McpSessionPolicy = {
  authorizeServer: async () => true,
  authorizeTool: async () => ({ behavior: "allow" }),
};
async function fixture() {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const requests: { token?: string; method: string; rpc?: string }[] = [];
  const calls: string[] = [];
  let cancels = 0;
  // Hold the tool response until the test has cancelled or replaced its client.
  const slowStarted = Promise.withResolvers<void>();
  const slowRelease = Promise.withResolvers<void>();
  const slowFinished = Promise.withResolvers<void>();
  const returnedAppFailure: CallToolResult = {
    isError: false,
    structuredContent: {
      _tag: "OrchestratorMcpFailure",
      code: "task_not_found",
      message: "Task does not belong to thread",
    },
    content: [{ type: "text", text: "Task does not belong to thread" }],
  };

  async function createPeer() {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, transport);
      },
    });
    const server = new McpServer({ name: "real-local-fixture", version: "1" });
    server.registerTool(
      "echo",
      { inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } },
      async ({ text }) => {
        calls.push("echo");
        return { content: [{ type: "text", text }] };
      },
    );
    server.registerTool(
      "delegate_task",
      { inputSchema: { clientRequestId: z.string() } },
      async ({ clientRequestId }) => {
        calls.push("delegate_task");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                clientRequestId,
                taskId: "app-task",
                threadId: "app-thread",
                runId: "app-run",
              }),
            },
          ],
        };
      },
    );
    server.registerTool("scope_denied", { inputSchema: {}, outputSchema: { taskId: z.string() } }, async () => ({
      isError: true,
      structuredContent: { code: "scope_violation", message: "Task does not belong to thread" },
      content: [{ type: "text", text: "Task does not belong to thread" }],
    }));
    server.registerTool(
      "scope_returned_failure",
      { inputSchema: {}, outputSchema: { taskId: z.string() } },
      async () => returnedAppFailure,
    );
    server.registerTool("task_status", { inputSchema: {} }, async () => {
      calls.push("task_status");
      return { content: [{ type: "text", text: "actual fixture status" }] };
    });
    server.registerTool("task_cancel", { inputSchema: {} }, async () => {
      calls.push("task_cancel");
      cancels++;
      return { content: [{ type: "text", text: "cancelled fixture task" }] };
    });
    server.registerTool("bruv_task_launch", { inputSchema: {} }, async () => {
      throw Error("old bridge must not run");
    });
    server.registerTool("slow", { inputSchema: {} }, async () => {
      calls.push("slow");
      slowStarted.resolve();
      await slowRelease.promise;
      slowFinished.resolve();
      return { content: [{ type: "text", text: "late" }] };
    });
    await server.connect(transport);
    return transport;
  }

  const http = createServer(async (req, res) => {
    try {
      const data: Buffer[] = [];
      for await (const chunk of req) data.push(chunk);
      const body = data.length ? JSON.parse(Buffer.concat(data).toString()) : undefined;
      requests.push({ token: req.headers.authorization, method: req.method!, rpc: body?.method });
      const id = req.headers["mcp-session-id"] as string | undefined;
      let transport = id ? sessions.get(id) : undefined;
      if (!transport && body?.method === "initialize") {
        transport = await createPeer();
      }
      if (!transport) {
        res.writeHead(404).end();
        return;
      }
      if (
        body?.method === "tools/call" &&
        body.params?.name === "delegate_task" &&
        body.params.arguments?.clientRequestId === "ambiguous"
      ) {
        calls.push("delegate_task");
        res.destroy();
        return; // fixture committed before dropping response
      }
      if (body?.method === "tools/call" && body.params.name === "scope_returned_failure") {
        // The unchanged official Effect MCP server returns failures with isError:false.
        // Bypass this fixture SDK server's own success-schema check to reproduce
        // exactly the observed response envelope, not a connector/native UI event.
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: returnedAppFailure,
          }),
        );
        return;
      }
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) res.writeHead(500).end("fixture error");
    }
  });
  await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));
  cleanup.push(async () => {
    // Also release and drain a handler stranded by a failed assertion.
    slowRelease.resolve();
    if (calls.includes("slow")) await slowFinished.promise;
    for (const transport of sessions.values()) await transport.close();
    http.closeAllConnections();
    await new Promise<void>((done) => http.close(() => done()));
  });
  const address = http.address() as { port: number };
  const config = (token: string) => ({
    mcpServers: {
      "t3-code": {
        type: "http",
        url: "http://127.0.0.1:" + address.port + "/mcp",
        headers: { Authorization: token },
        timeout: 2000,
      },
    },
  });
  return {
    config,
    requests,
    calls,
    cancels: () => cancels,
    slowCall: { started: slowStarted.promise, release: slowRelease.resolve, finished: slowFinished.promise },
  };
}
function track(session: InjectedMcpSession) {
  cleanup.push(() => session.close());
  return session;
}

test("actual SDK initializes/lists/calls per-session HTTP scopes and deletes on teardown", async () => {
  const f = await fixture();
  const a = track(
    await InjectedMcpSession.open(f.config("Bearer scope-A"), {
      cwd: process.cwd(),
      appOwnedServers: [],
      policy: allow,
    }),
  );
  const b = track(
    await InjectedMcpSession.open(f.config("Bearer scope-B"), {
      cwd: process.cwd(),
      appOwnedServers: [],
      policy: allow,
    }),
  );
  expect(a.tools().some((tool) => tool.remoteName.startsWith("bruv_task_"))).toBe(false);
  expect(a.status()).toEqual([{ name: "t3-code", status: "connected" }]);
  expect((await a.callTool("mcp__t3-code__echo", { text: "A" }, { toolUseId: "call-A" })).content).toEqual([
    { type: "text", text: "A" },
  ]);
  expect((await b.callTool("mcp__t3-code__echo", { text: "B" }, { toolUseId: "call-B" })).content).toEqual([
    { type: "text", text: "B" },
  ]);
  await a.close();
  expect(a.tools()).toEqual([]);
  expect(a.status()[0].status).toBe("closed");
  expect(f.requests.filter((request) => request.rpc === "tools/call").map((request) => request.token)).toEqual([
    "Bearer scope-A",
    "Bearer scope-B",
  ]);
  expect(f.requests.some((request) => request.method === "DELETE" && request.token === "Bearer scope-A")).toBe(true);
  await expect(a.callTool("mcp__t3-code__echo", { text: "no" }, { toolUseId: "closed" })).rejects.toThrow("closed");
  await b.callTool("mcp__t3-code__echo", { text: "still alive" }, { toolUseId: "call-B-2" });
});

test("selection is separate from permission; readOnlyHint cannot grant plan authority", async () => {
  const f = await fixture();
  const session = track(
    await InjectedMcpSession.open(f.config("scope"), {
      cwd: process.cwd(),
      appOwnedServers: [],
      selectedTools: ["mcp__t3-code__echo"],
      policy: { ...allow, authorizeTool: createPermissionPolicy({ mode: "plan", allowedTools: ["mcp__t3-code__*"] }) },
    }),
  );
  expect(session.tools().map((tool) => tool.remoteName)).toEqual(["echo"]);
  await expect(session.callTool("mcp__t3-code__echo", { text: "denied" }, { toolUseId: "denied" })).rejects.toThrow(
    "read-only",
  );
  await expect(session.callTool("mcp__t3-code__delegate_task", {}, { toolUseId: "unselected" })).rejects.toThrow(
    "not selected",
  );
  expect(f.calls).toEqual([]);
});

test("app delegation is one upstream call with trusted active-run guard, not a Bruv launch/ACK/cancel", async () => {
  const f = await fixture();
  let checks = 0;
  const session = track(
    await InjectedMcpSession.open(f.config("scope"), {
      cwd: process.cwd(),
      appOwnedServers: ["t3-code"],
      policy: {
        ...allow,
        authorizeTool: async (request) => ({
          behavior: "allow",
          updatedInput: request.toolName.endsWith("delegate_task")
            ? { clientRequestId: "owner-stable-key" }
            : request.input,
        }),
        beforeAppOwnedCall: async (request) => {
          expect(request.owner).toBe("app_owned");
          checks++;
        },
      },
    }),
  );
  const result = await session.callTool(
    "mcp__t3-code__delegate_task",
    { clientRequestId: "changed" },
    { toolUseId: "app-launch" },
  );
  expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({
    clientRequestId: "owner-stable-key",
    taskId: "app-task",
    threadId: "app-thread",
    runId: "app-run",
  });
  expect(f.calls).toEqual(["delegate_task"]);
  await session.callTool("mcp__t3-code__task_status", {}, { toolUseId: "app-status" });
  expect(f.cancels()).toBe(0);
  await session.callTool("mcp__t3-code__task_cancel", {}, { toolUseId: "app-cancel" });
  expect(f.cancels()).toBe(1);
  await session.close();
  expect(f.cancels()).toBe(1); // Connection shutdown is not another task_cancel.
  expect(checks).toBe(3);
});

test("app-owned tools fail closed without binding guard", async () => {
  const f = await fixture();
  const session = track(
    await InjectedMcpSession.open(f.config("scope"), {
      cwd: process.cwd(),
      appOwnedServers: ["t3-code"],
      policy: allow,
    }),
  );
  await expect(
    session.callTool("mcp__t3-code__delegate_task", { clientRequestId: "x" }, { toolUseId: "x" }),
  ).rejects.toThrow("App-owned MCP needs trusted policy for the active run and provider");
  expect(f.calls).toEqual([]);
});

test("cancellation/close cannot adopt a late result or retry an ambiguous call", async () => {
  const f = await fixture();
  const session = track(
    await InjectedMcpSession.open(f.config("SECRET_SCOPE"), { cwd: process.cwd(), appOwnedServers: [], policy: allow }),
  );
  const controller = new AbortController();
  const pending = session.callTool("mcp__t3-code__slow", {}, { toolUseId: "slow", signal: controller.signal });
  await f.slowCall.started;
  controller.abort();
  await expect(pending).rejects.toThrow("MCP call failed; the remote mutation may have happened. It was not retried.");
  f.slowCall.release();
  await f.slowCall.finished;
  expect(f.calls).toEqual(["slow"]);
});

test("denied discovery makes no network request; failures redact config", async () => {
  const f = await fixture();
  await expect(
    InjectedMcpSession.open(f.config("SECRET_SCOPE"), {
      cwd: process.cwd(),
      appOwnedServers: [],
      policy: { ...allow, authorizeServer: async () => false },
    }),
  ).rejects.toThrow("discovery failed");
  expect(f.requests).toEqual([]);
  expect(() =>
    parseInjectedMcpConfig({ mcpServers: { bad: { type: "sdk", headers: { Authorization: "SECRET_SCOPE" } } } }),
  ).toThrow("supported transports");
});

test("actual stdio server gets only its configured auth, no root/global server credentials, and exits on close", async () => {
  const old = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "ROOT_PROVIDER_NOT_FOR_MCP";
  try {
    const session = track(
      await InjectedMcpSession.open(
        {
          mcpServers: {
            local: {
              command: process.execPath,
              args: [resolve("tests/claude-compat/fixtures/stdio-mcp.ts")],
              env: {
                FIXTURE_AUTH: "stdio-scoped",
                OPENAI_API_KEY: "configured-provider",
                T3_ACP_MCP_TOKEN: "root-secret",
                BRUV_ROOT_RUNTIME_TOKEN: "root-token",
              },
            },
          },
        },
        { cwd: process.cwd(), appOwnedServers: [], policy: allow },
      ),
    );
    const result = await session.callTool("mcp__local__environment", {}, { toolUseId: "env" });
    const env = JSON.parse((result.content[0] as { text: string }).text);
    expect(env).toMatchObject({ configured: "stdio-scoped", provider: "configured-provider", controls: [] });
    expect(env.inheritedProvider).toBeUndefined();
    await session.close();
    expect(() => process.kill(env.pid, 0)).toThrow();
  } finally {
    if (old === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = old;
  }
});

test("committed app launch with lost response is unknown, not retried or acknowledged as a Bruv job", async () => {
  const f = await fixture();
  const session = track(
    await InjectedMcpSession.open(f.config("SECRET_SCOPE"), {
      cwd: process.cwd(),
      appOwnedServers: ["t3-code"],
      policy: { ...allow, beforeAppOwnedCall: async () => {} },
    }),
  );
  const error = await session
    .callTool("mcp__t3-code__delegate_task", { clientRequestId: "ambiguous" }, { toolUseId: "ambiguous" })
    .catch((error) => error);
  expect(error.code).toBe("call-failed");
  expect(error.message).toBe("MCP call failed; the remote mutation may have happened. It was not retried.");
  expect(String(error)).not.toContain("SECRET_SCOPE");
  expect(f.calls).toEqual(["delegate_task"]);
});

test("close cancels old connection calls; replacement cannot receive an old result", async () => {
  const f = await fixture();
  const old = track(
    await InjectedMcpSession.open(f.config("old-scope"), { cwd: process.cwd(), appOwnedServers: [], policy: allow }),
  );
  const pending = old.callTool("mcp__t3-code__slow", {}, { toolUseId: "old-call" }).catch((error) => error);
  await f.slowCall.started;
  await old.close();
  expect((await pending).code).toBe("call-failed");
  const replacement = track(
    await InjectedMcpSession.open(f.config("new-scope"), { cwd: process.cwd(), appOwnedServers: [], policy: allow }),
  );
  f.slowCall.release();
  await f.slowCall.finished;
  const result = await replacement.callTool("mcp__t3-code__echo", { text: "new only" }, { toolUseId: "new-call" });
  expect(result.content).toEqual([{ type: "text", text: "new only" }]);
  expect(f.calls).toEqual(["slow", "echo"]);
});

test("actual SDK preserves structured scoped errors instead of validating a success schema", async () => {
  const f = await fixture();
  const session = track(
    await InjectedMcpSession.open(f.config("Bearer isolated-child"), {
      cwd: process.cwd(),
      appOwnedServers: [],
      policy: allow,
    }),
  );
  const result = await session.callTool("mcp__t3-code__scope_denied", {}, { toolUseId: "denied" });
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([{ type: "text", text: "Task does not belong to thread" }]);
  expect(result.structuredContent).toEqual({ code: "scope_violation", message: "Task does not belong to thread" });
  expect(f.requests.filter((r) => r.rpc === "tools/call")).toHaveLength(1);
});

test("official T3 returned OrchestratorMcpFailure is an error, never a success-schema result", async () => {
  const f = await fixture();
  const session = track(
    await InjectedMcpSession.open(f.config("Bearer native-child"), {
      cwd: process.cwd(),
      appOwnedServers: ["t3-code"],
      policy: { ...allow, beforeAppOwnedCall: async () => {} },
    }),
  );
  const result = await session.callTool("mcp__t3-code__scope_returned_failure", {}, { toolUseId: "denied" });
  expect(result.isError).toBe(true);
  expect(result.structuredContent?._tag).toBe("OrchestratorMcpFailure");
  expect(result.content).toEqual([{ type: "text", text: "Task does not belong to thread" }]);
});

test("app HTTP discovery parks an actual session; concurrent resume reuses one lease and park never cancels app tasks", async () => {
  const peer = await httpMcpLifecycleFixture();
  cleanup.push(peer.stopHost);
  const admitted: string[] = [];
  const session = track(
    await InjectedMcpSession.open(peer.config, {
      cwd: process.cwd(),
      appOwnedServers: ["t3-code"],
      policy: {
        ...allow,
        authorizeServer: async (name) => {
          admitted.push(name);
          return true;
        },
        beforeAppOwnedCall: async () => {},
      },
    }),
  );
  expect(peer.activeSessions()).toBe(0);
  expect(admitted).toEqual(["t3-code"]);
  expect(peer.requests.filter((request) => request.rpc === "tools/list")).toHaveLength(1);
  expect(session.tools().map((tool) => tool.remoteName)).toEqual(["echo"]);
  await Promise.all([session.resumeAppOwned(), session.resumeAppOwned()]);
  expect(peer.activeSessions()).toBe(1);
  expect(peer.requests.filter((request) => request.rpc === "initialize")).toHaveLength(2);
  expect(admitted).toEqual(["t3-code", "t3-code"]);
  expect(peer.requests.filter((request) => request.rpc === "tools/list")).toHaveLength(1);
  await session.callTool("mcp__t3-code__echo", { text: "actual" }, { toolUseId: "echo" });
  await Promise.all([session.parkAppOwned(), session.parkAppOwned()]);
  expect(peer.activeSessions()).toBe(0);
  expect(peer.requests.filter((request) => request.method === "DELETE")).toHaveLength(2);
  expect(peer.requests.filter((request) => request.rpc === "tools/call")).toHaveLength(1);
  await peer.stopHost();
  await session.close();
});

test("app HTTP release failure is still fatal, even though the local SDK client is closed", async () => {
  const peer = await httpMcpLifecycleFixture();
  cleanup.push(peer.stopHost);
  const session = await InjectedMcpSession.open(peer.config, {
    cwd: process.cwd(),
    appOwnedServers: ["t3-code"],
    policy: allow,
  });
  await session.resumeAppOwned();
  peer.rejectDeletion();
  await expect(session.parkAppOwned()).rejects.toMatchObject({ code: "teardown-failed" });
  expect(session.status()).toEqual([{ name: "t3-code", status: "close-failed" }]);
  await expect(session.close()).rejects.toMatchObject({ code: "teardown-failed" });
});

test("external HTTP MCP keeps its session until process close and does not suppress unavailable-peer teardown", async () => {
  const peer = await httpMcpLifecycleFixture();
  cleanup.push(peer.stopHost);
  const session = await InjectedMcpSession.open(peer.config, {
    cwd: process.cwd(),
    appOwnedServers: [],
    policy: allow,
  });
  await session.parkAppOwned();
  expect(peer.activeSessions()).toBe(1);
  expect(peer.requests.some((request) => request.method === "DELETE")).toBe(false);
  await peer.stopHost();
  await expect(session.close()).rejects.toMatchObject({ code: "teardown-failed" });
});
