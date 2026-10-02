/** Wire encoding only: each fixture owns its router, headers and timing. */
export function completionSse(
  identity: { id: string; model: string; created: number },
  delta: Record<string, unknown>,
  finishReason: string,
): string {
  const base = { id: identity.id, object: "chat.completion.chunk", created: identity.created, model: identity.model };
  return (
    [
      { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] },
    ]
      .map((chunk) => "data: " + JSON.stringify(chunk) + "\n\n")
      .join("") + "data: [DONE]\n\n"
  );
}

export function executeDelta(id: string, code: string) {
  return {
    role: "assistant",
    tool_calls: [
      { index: 0, id, type: "function", function: { name: "execute", arguments: JSON.stringify({ code }) } },
    ],
  };
}
