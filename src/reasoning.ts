import {
  type Api,
  type AssistantMessage,
  clampThinkingLevel,
  type Model,
  type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";

// Keeps the Codex prompt cache when the thinking level changes. The request keeps the effort the
// conversation started with, and each later change becomes a configuration_update item placed
// where it happened. Everything is rebuilt from the session branch on each request, so a resumed
// session sends the same request it sent before. Notes: .agents/notes/reasoning-cache.md.

type Payload = Record<string, unknown>;
const efforts = new Set(["low", "medium", "high", "xhigh", "max"]);
const replyItems = new Set(["reasoning", "message", "function_call", "custom_tool_call"]);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const update = (effort: string) => ({ type: "configuration_update", reasoning: { effort } });

export const supportsReasoningUpdates = (model: Model<Api> | undefined): model is Model<Api> =>
  model?.api === "openai-codex-responses" && /^gpt-6(?:\.\d+)?-/i.test(model.id.split("/").at(-1) ?? "");

function effortFor(model: Model<Api>, level: string) {
  const clamped = clampThinkingLevel(model, level as ModelThinkingLevel);
  const effort = clamped === "off" ? undefined : (model.thinkingLevelMap?.[clamped] ?? clamped);
  return typeof effort === "string" && efforts.has(effort) ? effort : undefined;
}

// The item ids Pi gives a saved reply when it sends it back: reasoning, text and tool calls.
function idsOf(message: AssistantMessage) {
  const ids: string[] = [];
  for (const block of message.content) {
    if (block.type === "toolCall") ids.push(block.id.split("|")[0]);
    const signature =
      block.type === "thinking" ? block.thinkingSignature : block.type === "text" ? block.textSignature : undefined;
    if (!signature) continue;
    try {
      const id = signature.startsWith("{") ? JSON.parse(signature).id : block.type === "text" && signature;
      if (typeof id === "string") ids.push(id);
    } catch {}
  }
  return ids;
}

/** Rewrites a GPT-6 Codex payload in place. */
export function pinReasoning(payload: Payload, branch: SessionEntry[], model: Model<Api>) {
  const current = record(payload.reasoning) ? payload.reasoning.effort : undefined;
  if (
    !supportsReasoningUpdates(model) ||
    payload.model !== model.id ||
    typeof current !== "string" ||
    !efforts.has(current) ||
    !Array.isArray(payload.input) ||
    payload.truncation === "auto" ||
    (Array.isArray(payload.context_management) && payload.context_management.length > 0)
  )
    return;
  // Walk the branch and find the effort each saved reply was made with. A change made while a
  // reply was streaming is saved before that reply but only applies to the next request, so a
  // change counts for a reply only if it was saved before the reply started.
  const target = `${model.provider}/${model.id}`;
  let level = "off";
  const waiting: { time: number; level: string }[] = [];
  let lane: string | undefined;
  let replies: { message: AssistantMessage; effort: string | undefined }[] = [];
  const use = (key: string) => {
    if (key !== lane) replies = [];
    lane = key;
  };
  for (const entry of branch) {
    if (entry.type === "thinking_level_change")
      waiting.push({ time: Date.parse(entry.timestamp), level: entry.thinkingLevel });
    // After a compaction the request starts with new content, so the pin starts again.
    else if (entry.type === "compaction") replies = [];
    else if (entry.type === "model_change") use(`${entry.provider}/${entry.modelId}`);
    else if (entry.type === "message" && entry.message.role === "assistant") {
      const message = entry.message;
      use(`${message.provider}/${message.model}`);
      while (waiting.length && !(waiting[0].time > message.timestamp)) level = waiting.shift()?.level ?? level;
      replies.push({ message, effort: effortFor(model, level) });
    }
  }
  const pinned = replies[0]?.effort;
  if (lane !== target || !pinned || replies.some((reply) => !reply.effort)) return;
  const found = new Map<string, number>();
  payload.input.forEach((item: unknown, index) => {
    if (!record(item) || typeof item.type !== "string" || !replyItems.has(item.type)) return;
    for (const id of [item.id, item.call_id]) if (typeof id === "string" && !found.has(id)) found.set(id, index);
  });
  const inserts = new Map<number, string>();
  let shown = pinned;
  for (const { message, effort } of replies.slice(1)) {
    const index = Math.min(...idsOf(message).map((id) => found.get(id) ?? Number.POSITIVE_INFINITY));
    // A reply missing from the input (failed or dropped) keeps no marker; the next one carries it.
    if (!Number.isFinite(index) || !effort || effort === shown) continue;
    inserts.set(index, effort);
    shown = effort;
  }
  const input = payload.input.flatMap((item: unknown, index) => {
    const effort = inserts.get(index);
    return effort ? [update(effort), item] : [item];
  });
  if (current !== shown) input.push(update(current));
  payload.input = input;
  payload.reasoning = { ...(payload.reasoning as Payload), effort: pinned };
}

export function registerReasoning(pi: ExtensionAPI) {
  pi.on("before_provider_request", (event, ctx) => {
    if (supportsReasoningUpdates(ctx.model) && record(event.payload))
      pinReasoning(event.payload, ctx.sessionManager.getBranch(), ctx.model);
  });
}
