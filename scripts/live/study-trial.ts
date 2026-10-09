/** Transport for explicit paid studies. All tool outputs are synthetic; no code dispatch. */
import WebSocket from "ws";
export async function studyTrial(options: {
  model: string;
  key: string;
  instructions: string;
  tool: object;
  items: object[];
  mockOutput: (code: unknown) => unknown;
  deadlineMs: number;
  speechLimit: number;
  stringArguments?: boolean;
  url?: string;
}) {
  const { model, key, instructions, tool } = options;
  const result = {
    calls: [] as Array<{ name: string; code: unknown }>,
    speech: "",
    errors: [] as unknown[],
    responses: 0,
  };
  const speech: string[] = [];
  const ws = new WebSocket(options.url ?? `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const send = (event: object) => ws.send(JSON.stringify(event));
  let done = false,
    pending = false;
  await new Promise<void>((resolve) => {
    const end = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.close();
      resolve();
    };
    const timer = setTimeout(() => {
      result.errors.push(`deadline ${options.deadlineMs / 1000}s`);
      end();
    }, options.deadlineMs);
    ws.on("open", () =>
      send({
        type: "session.update",
        session: {
          type: "realtime",
          instructions,
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: { model: "gpt-4o-mini-transcribe" },
              turn_detection: { type: "server_vad", create_response: true, interrupt_response: true },
            },
            output: { format: { type: "audio/pcm", rate: 24000 }, voice: "marin" },
          },
          output_modalities: ["audio"],
          tools: [tool],
          tool_choice: "auto",
        },
      }),
    );

    ws.on("message", (data) => {
      let m:
        | { type: "session.updated" | "response.done" }
        | { type: "response.output_audio_transcript.delta" | "response.output_text.delta"; delta: string }
        | { type: "response.function_call_arguments.done"; arguments: string; name: string; call_id: string }
        | { type: "error"; error?: { code?: string; type?: string; param?: string } };
      try {
        m = JSON.parse(String(data));
      } catch {
        return;
      }
      if (m.type === "session.updated") {
        for (const item of options.items) send(item);
        send({ type: "response.create" });
      }
      if (m.type === "response.output_audio_transcript.delta" || m.type === "response.output_text.delta")
        speech.push(m.delta);
      if (m.type === "response.function_call_arguments.done") {
        const args = options.stringArguments ? String(m.arguments ?? "") : m.arguments;
        let code: unknown;
        try {
          code = JSON.parse(args).code;
        } catch {
          code = args;
        }
        result.calls.push({ name: m.name, code });
        pending = true;
        send({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: m.call_id, output: JSON.stringify(options.mockOutput(code)) },
        });
      }
      if (m.type === "response.done") {
        result.responses++;
        if (pending && result.responses < 3) {
          pending = false;
          send({ type: "response.create" });
        } else end();
      }
      if (m.type === "error") {
        result.errors.push({ code: m.error?.code, type: m.error?.type, param: m.error?.param });
        end();
      }
    });
    ws.on("error", (e) => {
      result.errors.push(`socket: ${String(e.message).replace(/sk-[A-Za-z0-9_-]+/g, "<redacted>")}`);
      end();
    });
    ws.on("close", end);
  });
  result.speech = speech.join("").slice(0, options.speechLimit);
  return result;
}
