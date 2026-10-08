import { placementReply } from "../tests/fixtures/remote-e2e/placement-parent";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
export function loopbackParent(agentDir: string, onCall?: () => void) {
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/chat/completions"))
        return new Response("not found", { status: 404 });
      const body = (await request.json()) as {
        messages: Array<{ role: string; tool_call_id?: string; content?: unknown }>;
      };
      const response = placementReply(body.messages);
      onCall?.();
      const event = (delta: object, finish_reason: string | null) => ({
        id: "local-fixture",
        object: "chat.completion.chunk",
        created: 1,
        model: "fixture-model",
        choices: [{ index: 0, delta, finish_reason }],
      });
      return new Response(
        [event(response, null), event({}, "tool_calls" in response ? "tool_calls" : "stop")]
          .map((chunk) => "data: " + JSON.stringify(chunk) + "\n\n")
          .join("") + "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        fixture: {
          baseUrl: "http://127.0.0.1:" + provider.port + "/v1",
          api: "openai-completions",
          apiKey: "fixture-only",
          models: [{ id: "fixture-model", name: "fixture", contextWindow: 32000, maxTokens: 1024 }],
        },
      },
    }),
  );

  return provider;
}
function readRpcEvents(stdout: Readable, onEvent: (event: any) => void) {
  let buffer = "";
  stdout.on("data", (chunk: Buffer) => {
    buffer += String(chunk);
    for (let pos; (pos = buffer.indexOf("\n")) !== -1; ) {
      const line = buffer.slice(0, pos);
      buffer = buffer.slice(pos + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line));
        } catch {
          throw new Error("Invalid RPC JSON: " + line);
        }
      }
    }
  });
}

export function fixtureRpc(options: {
  bruv: string;
  cwd: string;
  home: string;
  agentDir: string;
  children: ReturnType<typeof spawn>[];
  noSession?: boolean;
  timeoutDetail: (events: any[]) => string;
}) {
  const { bruv, cwd, home, agentDir } = options;
  const child = spawn(
    bruv,
    [
      "--mode",
      "rpc",
      "--provider",
      "fixture",
      "--model",
      "fixture-model",
      ...(options.noSession ? ["--no-session"] : []),
    ],
    {
      cwd,
      env: { ...process.env, HOME: home, BRUV_CODING_AGENT_DIR: agentDir },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  options.children.push(child);
  const events: any[] = [];
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += String(chunk)));
  readRpcEvents(child.stdout, (event) => {
    events.push(event);
    if (event.type === "extension_ui_request" && event.method === "confirm")
      child.stdin.write(JSON.stringify({ type: "extension_ui_response", id: event.id, confirmed: false }) + "\n");
  });
  const send = (message: string) => child.stdin.write(JSON.stringify({ type: "prompt", message }) + "\n");
  const wait = async (predicate: () => boolean, label: string, limit = 20_000) => {
    const start = Date.now();
    while (!predicate()) {
      if (child.exitCode !== null) throw new Error("RPC exited while " + label + ": " + stderr);
      if (Date.now() - start > limit)
        throw new Error("RPC timeout " + label + "; stderr=" + stderr + options.timeoutDetail(events));
      await Bun.sleep(40);
    }
  };
  return { child, events, send, wait, stderr: () => stderr };
}
