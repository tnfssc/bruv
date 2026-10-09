import { requestNativeCodexCompaction } from "../../src/agent/native-compaction";
import { normalizeContext } from "@earendil-works/pi-ai";
import { expect, test } from "bun:test";
import { stream } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { getModel } from "@earendil-works/pi-ai/compat";
import { createPromptPreview } from "../../src/prompt-preview";
import { expectExecuteOnce } from "./combined-request";

const sentinel = "provider-prompt-serialization-sentinel";

function dummyCodexJwt(): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "test-account",
      },
    }),
    "signature",
  ].join(".");
}

test("Codex serializes the complete system prompt as instructions without a network request", async () => {
  const model = getModel("openai-codex", "gpt-5.6-luna");
  expect(model).toBeDefined();

  const { systemPrompt, tools } = await createPromptPreview();
  let captured: { instructions?: string; tool_choice?: unknown; tools?: any[] } | undefined;
  let networkCalls = 0;

  const events = [];
  for await (const event of stream(
    model!,
    normalizeContext({
      systemPrompt,
      tools,
      messages: [{ role: "user", content: "Serialize this request, but do not send it.", timestamp: 0 }],
    }),
    {
      apiKey: dummyCodexJwt(),
      transport: "sse",
      fetch: (async () => {
        networkCalls++;
        throw new Error("network must not be used");
      }) as unknown as typeof fetch,
      onPayload(payload) {
        captured = payload as typeof captured;
        throw new Error(sentinel);
      },
    },
  )) {
    events.push(event);
  }

  expect(captured?.instructions).toBe(systemPrompt);
  expectExecuteOnce(captured!.instructions!, captured!.tools!);
  expect(captured?.tool_choice).toBe("auto");
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe("error");
  if (events[0].type === "error") {
    expect(events[0].reason).toBe("error");
    expect(events[0].error.errorMessage).toContain(sentinel);
  }
  expect(networkCalls).toBe(0);

  // Compaction sends the captured ordinary request, with its own trigger.
  let compacted: any;
  await requestNativeCodexCompaction({
    model: model!,
    payload: captured,
    headers: { Authorization: "Bearer offline", "chatgpt-account-id": "test-account" },
    fetch: (async (_url, init) => {
      compacted = JSON.parse(init!.body as string);
      return new Response(
        "data: " +
          JSON.stringify({
            type: "response.completed",
            response: {
              status: "completed",
              usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
              output: [{ type: "compaction", id: "cmp_offline", encrypted_content: "offline" }],
            },
          }) +
          "\n\n",
        { status: 200 },
      );
    }) as typeof fetch,
  });
  expectExecuteOnce(compacted.instructions, compacted.tools);
  expect(compacted.instructions).toBe(systemPrompt);
  expect(compacted.tools).toEqual(captured!.tools);
  expect(compacted.input.at(-1)).toEqual({ type: "compaction_trigger" });
});
