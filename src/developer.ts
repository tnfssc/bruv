import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Messages bruv writes itself. The user's own words, such as question answers, stay user messages. */
const fromBruv = new Set(["bruv-report", "bruv-goal", "bruv-keep-going", "bruv-time"]);
const responsesApis = new Set(["openai-responses", "openai-codex-responses"]);
const reminderMs = 60 * 60_000;

export function currentTime(now = new Date()): string {
  const offset = -now.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const local = new Date(now.getTime() + offset * 60_000).toISOString().slice(0, 16).replace("T", " ");
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `Current time: ${local} (UTC${sign}${pad(offset / 60)}:${pad(offset % 60)}${zone ? `, ${zone}` : ""}).`;
}

export function registerDeveloper(pi: ExtensionAPI): void {
  // Pi's prompt has no date, and users come back hours later. Say the time when it has moved on.
  pi.on("before_agent_start", (_event, ctx) => {
    const last = ctx.sessionManager
      .getBranch()
      .reverse()
      .find((entry) => entry.type === "custom_message" && entry.customType === "bruv-time");
    if (last && Date.now() - Date.parse(last.timestamp) < reminderMs) return;
    return { message: { customType: "bruv-time", content: currentTime(), display: false } };
  });

  // Pi sends custom messages as user messages. On OpenAI Responses models, send bruv's own as
  // developer messages so the model does not answer them as if the user wrote them.
  let texts = new Set<string>();
  pi.on("context", (event) => {
    texts = new Set();
    for (const message of event.messages)
      if (message.role === "custom" && fromBruv.has(message.customType))
        for (const part of typeof message.content === "string"
          ? [{ type: "text", text: message.content }]
          : message.content)
          if (part.type === "text") texts.add(part.text);
  });
  pi.on("before_provider_request", (event, ctx) => {
    const payload = event.payload as { input?: unknown };
    if (!responsesApis.has(ctx.model?.api ?? "") || !Array.isArray(payload.input) || !texts.size) return;
    payload.input = payload.input.map((item) => {
      const content = (item as { role?: string; content?: { type?: string; text?: string }[] }).content;
      return (item as { role?: string }).role === "user" &&
        Array.isArray(content) &&
        content.length === 1 &&
        content[0].type === "input_text" &&
        texts.has(content[0].text ?? "")
        ? { ...item, role: "developer" }
        : item;
    });
  });
}
