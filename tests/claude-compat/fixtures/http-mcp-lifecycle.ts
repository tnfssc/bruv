import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/** Stateful real SDK peer; host shutdown happens only when the test says so. */
export async function httpMcpLifecycleFixture({ timeout = 2000 }: { timeout?: number } = {}) {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const requests: { method: string; rpc?: string; session?: string }[] = [];
  let rejectDelete = false;
  let deleteDelay = 0;
  const http = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const session = req.headers["mcp-session-id"] as string | undefined;
    requests.push({ method: req.method!, rpc: body?.method, session });
    if (req.method === "DELETE" && rejectDelete) {
      res.writeHead(500).end();
      return;
    }
    let transport = session ? sessions.get(session) : undefined;
    if (!transport && body?.method === "initialize") {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          sessions.set(id, transport!);
        },
        onsessionclosed: (id) => {
          sessions.delete(id);
        },
      });
      const server = new McpServer({ name: "lifecycle-fixture", version: "1" });
      server.registerTool("echo", { inputSchema: { text: z.string() } }, async ({ text }) => ({
        content: [{ type: "text", text }],
      }));
      await server.connect(transport);
    }
    if (!transport) {
      res.writeHead(404).end();
      return;
    }
    if (req.method === "DELETE" && deleteDelay) await new Promise((done) => setTimeout(done, deleteDelay));
    await transport.handleRequest(req, res, body);
  });
  await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));
  const { port } = http.address() as { port: number };
  let stopping: Promise<void> | undefined;
  return {
    config: { mcpServers: { "t3-code": { type: "http", url: "http://127.0.0.1:" + port + "/mcp", timeout } } },
    requests,
    activeSessions: () => sessions.size,
    delayDeletion: (milliseconds: number) => {
      deleteDelay = milliseconds;
    },
    rejectDeletion: () => {
      rejectDelete = true;
    },
    stopHost: () =>
      (stopping ??= (async () => {
        for (const transport of sessions.values()) await transport.close();
        sessions.clear();
        http.closeAllConnections();
        await new Promise<void>((done) => http.close(() => done()));
      })()),
  };
}
