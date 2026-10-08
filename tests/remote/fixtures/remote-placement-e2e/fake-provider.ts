import { appendFileSync } from "node:fs";
import { stream, type RequestBody } from "./scenario";
Bun.serve({
  hostname: "0.0.0.0",
  port: 18765,
  async fetch(request) {
    if (request.method === "GET" && new URL(request.url).pathname === "/health")
      return new Response("placement fixture only");
    if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/chat/completions"))
      return new Response("not found", { status: 404 });
    const body = (await request.json()) as RequestBody;
    appendFileSync("/tmp/placement-inference.jsonl", JSON.stringify({ at: Date.now(), ...body }) + "\n");
    try {
      return new Response(stream(body), { headers: { "content-type": "text/event-stream" } });
    } catch (error) {
      appendFileSync("/tmp/placement-provider-errors", String(error) + "\n");
      return new Response(String(error), { status: 400 });
    }
  },
});
