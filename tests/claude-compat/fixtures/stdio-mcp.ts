import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
const server = new McpServer({ name: "local-stdio-fixture", version: "1" });
server.registerTool("environment", { inputSchema: {} }, async () => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        pid: process.pid,
        configured: process.env.FIXTURE_AUTH,
        provider: process.env.OPENAI_API_KEY,
        inheritedProvider: process.env.ANTHROPIC_API_KEY,
        controls: Object.keys(process.env).filter(
          (name) => name.startsWith("T3_") || name.startsWith("BRUV_ROOT_") || name.startsWith("BRUV_T3_"),
        ),
      }),
    },
  ],
}));
await server.connect(new StdioServerTransport());
