import { expect, test } from "bun:test";
import { WebSocketServer } from "ws";
import { studyTrial } from "../../scripts/live/study-trial";

async function trial(mode: "tools" | "error" | "close" | "timeout") {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const sent: any[] = [];
  const disconnected = new Promise<void>((resolve) =>
    server.once("connection", (socket) => socket.once("close", () => resolve())),
  );
  server.on("connection", (socket) => {
    const send = (event: object) => socket.send(JSON.stringify(event));
    let responses = 0;
    socket.on("message", (bytes) => {
      const event = JSON.parse(String(bytes));
      sent.push(event);
      if (event.type === "session.update") {
        socket.send("not json");
        if (mode === "error") send({ type: "error", error: { type: "invalid_request", code: "bad", param: "tools" } });
        else if (mode === "close") socket.close();
        else if (mode !== "timeout") send({ type: "session.updated" });
      }
      if (event.type === "response.create") {
        responses++;
        send({ type: "response.output_audio_transcript.delta", delta: "spoken " });
        send({ type: "response.output_text.delta", delta: "text " });
        send({
          type: "response.function_call_arguments.done",
          name: "execute",
          call_id: "call-" + responses,
          arguments: responses === 2 ? "malformed" : JSON.stringify({ code: "console.log('mock only')" }),
        });
        send({ type: "response.done" });
      }
    });
  });
  try {
    const result = await studyTrial({
      model: "fixture",
      key: "not-a-provider-key",
      instructions: "study instructions",
      tool: { type: "function", name: "execute" },
      items: [
        {
          type: "conversation.item.create",
          item: { role: "assistant", content: [{ type: "output_text", text: "prior refusal" }] },
        },
        {
          type: "conversation.item.create",
          item: { role: "user", content: [{ type: "input_text", text: "current request" }] },
        },
      ],
      mockOutput: (code) => ({ intercepted: code }),
      deadlineMs: mode === "timeout" ? 50 : 2000,
      speechLimit: 14,
      url: "ws://127.0.0.1:" + (server.address() as { port: number }).port,
    });
    await disconnected;
    return { result, sent };
  } finally {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("study ready/items/tools/continuation retain order, limits and synthetic outputs", async () => {
  const { result, sent } = await trial("tools");
  expect(sent[0].session.instructions).toBe("study instructions");
  expect(sent[0].session.audio.output.voice).toBe("marin");
  expect(sent[0].session.output_modalities).toEqual(["audio"]);
  expect(sent.slice(1, 3).map((event) => event.item.role)).toEqual(["assistant", "user"]);
  expect(sent.filter((event) => event.type === "response.create")).toHaveLength(3);
  expect(result.responses).toBe(3);
  expect(result.calls.map((call) => call.code)).toEqual([
    "console.log('mock only')",
    "malformed",
    "console.log('mock only')",
  ]);
  expect(result.speech).toBe("spoken text sp");
  expect(result.errors).toEqual([]);
  const outputs = sent.filter((event) => event.item?.type === "function_call_output");
  expect(outputs.map((event) => event.item.call_id)).toEqual(["call-1", "call-2", "call-3"]);
  expect(JSON.parse(outputs[1].item.output)).toEqual({ intercepted: "malformed" });
});

for (const mode of ["error", "close", "timeout"] as const)
  test("study terminates on " + mode, async () => {
    const { result, sent } = await trial(mode);
    expect(result.calls).toEqual([]);
    expect(result.speech).toBe("");
    expect(result.responses).toBe(0);
    expect(sent).toHaveLength(1);
    expect(result.errors).toEqual(
      mode === "error"
        ? [{ code: "bad", type: "invalid_request", param: "tools" }]
        : mode === "timeout"
          ? ["deadline 0.05s"]
          : [],
    );
  });
