import { randomUUID } from "node:crypto";
import { arch, platform, release } from "node:os";
import { calculateCost, type Model, type Usage } from "@earendil-works/pi-ai";
import {
  type CompactionEntry,
  type CompactionResult,
  compact,
  convertToLlm,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import { priorityUsage } from "./fast";

type Item = { type: "compaction"; id?: string; encrypted_content: string };
type Details = {
  strategy: "codex-native";
  version: 1;
  provider: string;
  model: string;
  baseUrl?: string;
  item: Item;
};
type Capture = {
  model: Model<string>;
  payload: Record<string, unknown>;
  headers?: Record<string, string | null>;
};
const summary =
  "Earlier messages were saved by Codex. Continue from the recent messages. If you need details from before, search this session's file, named in the system prompt.";
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isItem = (value: unknown): value is Item =>
  record(value) &&
  value.type === "compaction" &&
  (value.id === undefined || typeof value.id === "string") &&
  typeof value.encrypted_content === "string" &&
  value.encrypted_content.length > 0;
// The backend may also name the item compaction_summary; replay always sends it as compaction.
const asItem = (value: unknown): Item | undefined => {
  if (!record(value) || (value.type !== "compaction" && value.type !== "compaction_summary")) return;
  const item = {
    type: "compaction",
    ...(value.id === undefined ? {} : { id: value.id }),
    encrypted_content: value.encrypted_content,
  };
  return isItem(item) ? item : undefined;
};
const isCompaction = (value: unknown) =>
  record(value) && (value.type === "compaction" || value.type === "compaction_summary");

export function codexResponsesUrl(baseUrl: string) {
  const base = (baseUrl.trim() || "https://chatgpt.com/backend-api").replace(/\/+$/, "");
  return base.endsWith("/codex/responses") ? base : `${base}${base.endsWith("/codex") ? "" : "/codex"}/responses`;
}

/** The ChatGPT account in a Codex sign-in token, if it has one. */
export function codexAccountId(token: string): string | undefined {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    const id = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

async function headersFor(captured: Record<string, string | null>, model: Model<string>, ctx: ExtensionContext) {
  const headers = new Headers(model.headers);
  for (const [name, value] of Object.entries(captured))
    value === null ? headers.delete(name) : headers.set(name, value);
  if (!headers.has("Authorization") || !headers.has("chatgpt-account-id")) {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (auth.ok && auth.apiKey) {
      const accountId = codexAccountId(auth.apiKey);
      if (!accountId) throw new Error("Codex sign-in is invalid. Sign in again with /login.");
      headers.set("Authorization", `Bearer ${auth.apiKey}`);
      headers.set("chatgpt-account-id", accountId);
    }
  }
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
  headers.set("User-Agent", `pi (${platform()} ${release()}; ${arch()})`);
  headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("session-id", ctx.sessionManager.getSessionId());
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
    if (event.type === "response.output_item.done" && isCompaction(event.item)) {
      const item = asItem(event.item);
      if (!item) throw new Error("Codex returned an invalid compaction item.");
      items.push(item);
    }
    if (event.type !== "response.completed" && event.type !== "response.done") return;
    const result = event.response;
    if (
      !record(result) ||
      (result.status !== undefined && result.status !== "completed") ||
      !Array.isArray(result.output)
    )
      throw new Error("Codex returned an unfinished response.");
    const output = result.output.length ? result.output.filter(isCompaction).map(asItem) : items;
    const item = output[0];
    if (
      output.length !== 1 ||
      !item ||
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

type Summarize = (event: SessionBeforeCompactEvent, ctx: ExtensionContext) => Promise<CompactionResult>;

// Pi's own text summary, made alongside the Codex item so other providers and later compactions can read the history.
const piSummary: (pi: ExtensionAPI) => Summarize = (pi) => async (event, ctx) => {
  if (!ctx.model) throw new Error("No model selected.");
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!auth.ok) throw new Error(auth.error);
  return compact(
    event.preparation,
    { ...ctx.model, baseUrl: auth.baseUrl ?? ctx.model.baseUrl },
    auth.apiKey,
    auth.headers as Record<string, string> | undefined,
    event.customInstructions,
    event.signal,
    pi.getThinkingLevel(),
    undefined,
    auth.env,
  );
};

function addUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (!a || !b) return a ?? b;
  const sum = (key: "input" | "output" | "cacheRead" | "cacheWrite" | "total") => a.cost[key] + b.cost[key];
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
    cost: {
      input: sum("input"),
      output: sum("output"),
      cacheRead: sum("cacheRead"),
      cacheWrite: sum("cacheWrite"),
      total: sum("total"),
    },
  };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function registerCodexCompaction(
  pi: ExtensionAPI,
  options: { fetch?: (url: string, init: RequestInit) => Promise<Response>; summarize?: Summarize } = {},
) {
  const summarize = options.summarize ?? piSummary(pi);
  let captured: Capture | undefined;
  let requestHeaders: Capture["headers"];
  let latest: CompactionEntry | undefined;
  let warned: string | undefined;
  const reset = () => {
    captured = undefined;
    requestHeaders = undefined;
  };
  const remember = (entry: CompactionEntry | undefined) => {
    latest = (entry?.details as Details | undefined)?.strategy === "codex-native" ? entry : undefined;
  };
  const restore = (_event: unknown, ctx: ExtensionContext) => {
    reset();
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
  pi.on("session_compact", (event) => {
    // Pi's own summary requests pass through before_provider_request too; never reuse one.
    captured = undefined;
    remember(event.compactionEntry);
  });
  pi.on("session_compact_failed", () => {
    captured = undefined;
  });
  pi.on("before_provider_headers", (event) => {
    requestHeaders = { ...event.headers };
    if (captured) captured.headers = requestHeaders;
  });
  pi.on("before_provider_request", (event, ctx) => {
    const details = latest?.details as Details | undefined;
    const payload = event.payload as Record<string, unknown>;
    if (latest && details) {
      // The item works across Codex models; it is tied to the account behind the provider.
      if (
        ctx.model?.api === "openai-codex-responses" &&
        ctx.model.provider === details.provider &&
        (details.baseUrl === undefined || details.baseUrl === ctx.model.baseUrl)
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
        ctx.ui.notify("The provider changed. Using the saved text summary.", "info");
      }
    }
    captured =
      ctx.model?.api === "openai-codex-responses"
        ? { model: structuredClone(ctx.model), payload: structuredClone(payload), headers: requestHeaders }
        : undefined;
  });
  pi.on("session_before_compact", async (event, ctx) => {
    if (ctx.model?.api !== "openai-codex-responses") return;
    const request = captured;
    if (!request?.headers || request.model.provider !== ctx.model.provider || request.model.id !== ctx.model.id) return;
    const payload = request.payload;
    const input = payload.input;
    if (
      !Array.isArray(input) ||
      typeof payload.model !== "string" ||
      payload.stream !== true ||
      payload.store !== false
    )
      return;
    const native = async () => {
      const response = await (options.fetch ?? globalThis.fetch)(codexResponsesUrl(request.model.baseUrl), {
        method: "POST",
        headers: await headersFor(request.headers ?? {}, request.model, ctx),
        body: JSON.stringify({ ...payload, input: [...input, { type: "compaction_trigger" }] }),
        signal: event.signal,
      });
      const result = await readCompaction(response, request.model, event.signal);
      if (payload.service_tier === "priority" && result.usage)
        result.usage = priorityUsage(request.model, result.usage);
      return result;
    };
    const [codex, text] = await Promise.allSettled([native(), summarize(event, ctx)]);
    if (event.signal.aborted) return { cancel: true };
    if (codex.status === "rejected" && text.status === "rejected") {
      ctx.ui.notify(`Compaction failed. History kept. ${message(codex.reason)}`, "error");
      return { cancel: true };
    }
    if (codex.status === "rejected") {
      ctx.ui.notify(`Codex compaction failed, so a text summary was used. ${message(codex.reason)}`, "warning");
      return { compaction: (text as PromiseFulfilledResult<CompactionResult>).value };
    }
    const readable = text.status === "fulfilled" ? text.value : undefined;
    return {
      compaction: {
        summary: readable?.summary ?? summary,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        usage: addUsage(codex.value.usage, readable?.usage),
        details: {
          ...(readable?.details as object | undefined),
          strategy: "codex-native",
          version: 1,
          provider: request.model.provider,
          model: request.model.id,
          baseUrl: request.model.baseUrl,
          item: codex.value.item,
        } satisfies Details,
      },
    };
  });
}
