import { randomUUID } from "node:crypto";
import { calculateCost, type Model, type Usage } from "@earendil-works/pi-ai";
import { getPiUserAgent } from "@earendil-works/pi-ai/utils/pi-user-agent";
import {
  type CompactionEntry,
  convertToLlm,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

type Item = { type: "compaction"; id: string; encrypted_content: string };
type Details = { strategy: "codex-native"; version: 1; provider: string; model: string; item: Item };
type Capture = {
  model: Model<string>;
  payload: Record<string, unknown>;
  headers?: Record<string, string | null>;
};
const summary =
  "Earlier messages were saved by Codex. Continue from the recent messages. If details are missing, ask the user.";
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isItem = (value: unknown): value is Item =>
  record(value) &&
  value.type === "compaction" &&
  typeof value.id === "string" &&
  typeof value.encrypted_content === "string" &&
  value.encrypted_content.length > 0;

export function codexResponsesUrl(baseUrl: string) {
  const base = (baseUrl.trim() || "https://chatgpt.com/backend-api").replace(/\/+$/, "");
  return base.endsWith("/codex/responses") ? base : `${base}${base.endsWith("/codex") ? "" : "/codex"}/responses`;
}

function headersFor(captured: Record<string, string | null>, model: Model<string>, sessionId: string) {
  const headers = new Headers(model.headers);
  for (const [name, value] of Object.entries(captured))
    value === null ? headers.delete(name) : headers.set(name, value);
  if (!headers.has("Authorization") || !headers.has("chatgpt-account-id"))
    throw new Error("Codex sign-in headers are missing.");
  for (const name of [
    "host",
    "content-length",
    "connection",
    "upgrade",
    "sec-websocket-key",
    "sec-websocket-version",
    "sec-websocket-extensions",
  ])
    headers.delete(name);
  headers.set("originator", "pi");
  headers.set("User-Agent", getPiUserAgent());
  headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("session-id", sessionId);
  headers.set("x-client-request-id", randomUUID());
  return headers;
}

function usageFrom(response: Record<string, unknown>, model: Model<string>): Usage | undefined {
  if (!record(response.usage)) return;
  const raw = response.usage;
  const cached = record(raw.input_tokens_details) ? Number(raw.input_tokens_details.cached_tokens ?? 0) : 0;
  const written = record(raw.input_tokens_details) ? Number(raw.input_tokens_details.cache_write_tokens ?? 0) : 0;
  const input = Number(raw.input_tokens);
  const output = Number(raw.output_tokens);
  if (![input, output, cached, written].every((n) => Number.isSafeInteger(n) && n >= 0) || cached + written > input)
    throw new Error("Codex returned invalid token use.");
  const usage: Usage = {
    input: input - cached - written,
    output,
    cacheRead: cached,
    cacheWrite: written,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  calculateCost(model, usage);
  return usage;
}

async function readCompaction(response: Response, model: Model<string>, signal: AbortSignal) {
  if (!response.ok) throw new Error(`Codex request failed (${response.status}).`);
  if (!response.body) throw new Error("Codex returned no response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lines: string[] = [];
  const items: Item[] = [];
  const accept = () => {
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    lines = [];
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data);
    if (["error", "response.failed", "response.cancelled", "response.incomplete"].includes(event.type))
      throw new Error("Codex compaction did not finish.");
    if (event.type === "response.output_item.done") {
      if (!isItem(event.item)) throw new Error("Codex returned an unexpected item.");
      items.push(event.item);
    }
    if (event.type !== "response.completed" && event.type !== "response.done") return;
    const result = event.response;
    if (
      !record(result) ||
      (result.status !== undefined && result.status !== "completed") ||
      !Array.isArray(result.output)
    )
      throw new Error("Codex returned an unfinished response.");
    const output = result.output.length ? result.output : items;
    const item = output[0];
    if (
      output.length !== 1 ||
      !isItem(item) ||
      items.some((other) => other.id !== item.id || other.encrypted_content !== item.encrypted_content)
    )
      throw new Error("Codex returned an invalid compaction item.");
    return { item, usage: usageFrom(result, model) };
  };
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done });
      let match = /\r\n|\r|\n/.exec(buffer);
      while (match) {
        if (!done && match[0] === "\r" && match.index === buffer.length - 1) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (line) lines.push(line);
        else {
          const result = accept();
          if (result) return result;
        }
        match = /\r\n|\r|\n/.exec(buffer);
      }
      if (done) {
        if (buffer) lines.push(buffer);
        const result = accept();
        if (result) return result;
        throw new Error("Codex ended before compaction finished.");
      }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export function registerCodexCompaction(
  pi: ExtensionAPI,
  options: { fetch?: (url: string, init: RequestInit) => Promise<Response> } = {},
) {
  let captured: Capture | undefined;
  let latest: CompactionEntry | undefined;
  let useDefault = false;
  let warned: string | undefined;
  const reset = () => {
    captured = undefined;
  };
  const remember = (entry: CompactionEntry | undefined) => {
    latest = (entry?.details as Details | undefined)?.strategy === "codex-native" ? entry : undefined;
  };
  const restore = (_event: unknown, ctx: ExtensionContext) => {
    reset();
    useDefault = false;
    warned = undefined;
    remember(
      ctx.sessionManager
        .getBranch()
        .reverse()
        .find((entry) => entry.type === "compaction"),
    );
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("model_select", reset);
  pi.on("session_compact", (event) => remember(event.compactionEntry));
  pi.on("before_provider_headers", (event) => {
    if (captured) captured.headers = { ...event.headers };
  });
  pi.on("before_provider_request", (event, ctx) => {
    const details = latest?.details as Details | undefined;
    const payload = event.payload as Record<string, unknown>;
    if (latest && details) {
      if (
        ctx.model?.api === "openai-codex-responses" &&
        ctx.model.provider === details.provider &&
        ctx.model.id === details.model
      ) {
        const message = convertToLlm([
          { role: "compactionSummary", summary: latest.summary, tokensBefore: latest.tokensBefore, timestamp: 0 },
        ])[0];
        const text =
          message.role === "user" && Array.isArray(message.content) && message.content[0].type === "text"
            ? message.content[0].text
            : undefined;
        if (Array.isArray(payload.input))
          payload.input = payload.input.map((item: unknown) =>
            record(item) &&
            item.role === "user" &&
            Array.isArray(item.content) &&
            item.content.length === 1 &&
            record(item.content[0]) &&
            item.content[0].text === text
              ? details.item
              : item,
          );
      } else if (warned !== latest.id) {
        warned = latest.id;
        ctx.ui.notify("The model changed. Using the saved text summary.", "info");
      }
    }
    captured =
      ctx.model?.api === "openai-codex-responses"
        ? { model: structuredClone(ctx.model), payload: structuredClone(payload) }
        : undefined;
  });
  pi.on("session_before_compact", async (event, ctx) => {
    if (ctx.model?.api !== "openai-codex-responses") return;
    if (useDefault) {
      useDefault = false;
      return;
    }
    const request = captured;
    if (!request?.headers || request.model.provider !== ctx.model.provider || request.model.id !== ctx.model.id) return;
    const payload = request.payload;
    if (
      !Array.isArray(payload.input) ||
      typeof payload.model !== "string" ||
      payload.stream !== true ||
      payload.store !== false
    )
      return;
    try {
      const response = await (options.fetch ?? globalThis.fetch)(codexResponsesUrl(request.model.baseUrl), {
        method: "POST",
        headers: headersFor(request.headers, request.model, ctx.sessionManager.getSessionId()),
        body: JSON.stringify({
          ...payload,
          service_tier: "default",
          input: [...payload.input, { type: "compaction_trigger" }],
        }),
        signal: event.signal,
      });
      const { item, usage } = await readCompaction(response, request.model, event.signal);
      return {
        compaction: {
          summary,
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
          usage,
          details: {
            strategy: "codex-native",
            version: 1,
            provider: request.model.provider,
            model: request.model.id,
            item,
          } satisfies Details,
        },
      };
    } catch (error) {
      useDefault = true;
      ctx.ui.notify(
        `Codex compaction failed. History kept; the next attempt will use a text summary. ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      return { cancel: true };
    }
  });
}
