import type { AssistantMessage } from "@earendil-works/pi-ai";

/** Pi totals are catalog-priced usage, not necessarily the provider's invoice. */
export function nativeAssistantUsage(message: AssistantMessage) {
  return {
    input_tokens: message.usage.input,
    output_tokens: message.usage.output,
    cache_read_input_tokens: message.usage.cacheRead,
    cache_creation_input_tokens: message.usage.cacheWrite,
  };
}

/** Do not coerce missing/unknown prices to zero. An explicit known zero survives. */
export function nativeAssistantCost(message: AssistantMessage): { costUSD?: number } {
  const total = message.usage?.cost?.total;
  return typeof total === "number" && Number.isFinite(total) && total >= 0 ? { costUSD: total } : {};
}
