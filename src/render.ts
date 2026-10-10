import { stripVTControlCharacters } from "node:util";
import type { NestedToolCallRecord } from "@earendil-works/pi-ai";
import type { CodemodeToolDetails, ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

type Call = Omit<NestedToolCallRecord, "status"> & { status: string; ids?: string[]; exit?: number };
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const plain = (text: string) => stripVTControlCharacters(text);
const oneLine = (text: string) => plain(text).replace(/[\r\n\t]+/g, " ");
function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function outputLines(text: string, expanded: boolean): string[] {
  return text
    .replace(/^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n/, "")
    .split("\n")
    .flatMap((line) => {
      if (/^==> text \d+\/\d+ <==$/.test(line)) return [];
      const value = json(line);
      if (!record(value)) return plain(line).split("\n");
      if (typeof value.output === "string") return plain(value.output).trimEnd().split("\n");
      if (!Array.isArray(value.done) || !Array.isArray(value.running)) return [plain(line)];
      const items: unknown[] = [...value.done, ...value.running];
      if (!items.every((item) => record(item) && typeof item.id === "string" && typeof item.status === "string"))
        return [plain(line)];
      return items.flatMap((raw) => {
        const item = raw as Record<string, unknown>;
        const row = oneLine(`${item.id} · ${item.status}${typeof item.title === "string" ? ` · ${item.title}` : ""}`);
        const output = typeof item.answer === "string" && item.answer ? item.answer : item.output;
        return expanded && typeof output === "string" ? [row, ...plain(output).split("\n")] : [row];
      });
    });
}
function callLine(call: Call, theme: Theme) {
  const args = call.arguments ?? {};
  const target =
    call.name === "agent" && call.ids
      ? call.ids.join(", ")
      : typeof args.path === "string"
        ? args.path
        : typeof args.command === "string"
          ? truncateToWidth(plain(args.command).split(/\r\n|[\r\n]/)[0], 60, "…")
          : Array.isArray(args.ids)
            ? args.ids.join(", ")
            : typeof args.id === "string"
              ? args.id
              : "";
  const failed = call.status === "error" || (call.exit !== undefined && call.exit !== 0);
  const mark = failed ? "✗" : call.status === "ok" ? "✓" : "…";
  const time =
    call.durationMs !== undefined && call.durationMs >= 1000 ? ` · ${+(call.durationMs / 1000).toFixed(1)}s` : "";
  const exit =
    call.exit !== undefined && call.exit !== 0 ? call.exit : /exit (?:code: ?)?(\d+)/i.exec(call.error ?? "")?.[1];
  return `${theme.fg(failed ? "error" : call.status === "ok" ? "success" : "dim", mark)} ${oneLine(call.name)}${target ? ` ${oneLine(target)}` : ""}${exit ? ` · exit ${exit}` : time}`;
}

export function registerRender(pi: ExtensionAPI) {
  const calls = new Map<string, Map<string, Call>>();
  const remember = (parent: string, call: Call) => {
    let list = calls.get(parent);
    if (!list) {
      list = new Map();
      calls.set(parent, list);
    }
    list.set(call.id, call);
  };
  const restore = (_event: unknown, ctx: ExtensionContext) => {
    calls.clear();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
      for (const call of entry.message.nestedCalls?.calls ?? []) remember(entry.message.toolCallId, call);
    }
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("session_shutdown", () => calls.clear());
  pi.on("tool_execution_start", (event) => {
    if (event.parentToolCallId)
      remember(event.parentToolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        arguments: event.args,
        status: "running",
      });
  });
  pi.on("tool_execution_end", (event) => {
    if (!event.parentToolCallId) return;
    const previous = calls.get(event.parentToolCallId)?.get(event.toolCallId);
    const data = event.result.structuredContent ?? event.result.details;
    remember(event.parentToolCallId, {
      ...previous,
      id: event.toolCallId,
      name: event.toolName,
      status: event.isError ? "error" : "ok",
      durationMs: event.durationMs,
      ...(record(data) && Array.isArray(data.ids) ? { ids: data.ids as string[] } : {}),
      ...(record(data) && typeof data.exit_code === "number" ? { exit: data.exit_code } : {}),
      ...(event.isError
        ? {
            error: event.result.content
              ?.filter((c: { type: string }) => c.type === "text")
              .map((c: { text: string }) => c.text)
              .join("\n"),
          }
        : {}),
    });
  });
  pi.registerToolRenderer((name, next) => {
    const fallback = next();
    if (name !== "codemode") return fallback;
    return {
      ...fallback,
      renderCall(args, theme, context) {
        if (!record(args) || typeof args.code !== "string")
          return fallback?.renderCall?.(args, theme, context) ?? new Text("", 0, 0);
        return new Text(context.expanded ? plain(args.code) : theme.fg("toolTitle", "codemode"), 0, 0);
      },
      renderResult(result, options, theme, context) {
        const details = result.details as CodemodeToolDetails | undefined;
        if (!Array.isArray(details?.calls) || result.content.some((block) => block.type !== "text"))
          return (
            fallback?.renderResult?.(result, options, theme, context) ??
            new Text(
              result.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("\n"),
              0,
              0,
            )
          );
        const list = new Map<string, Call>();
        const live = calls.get(context.toolCallId) ?? new Map<string, Call>();
        const pending = [...live.values()].filter((call) => !details.calls.some((saved) => saved.id === call.id));
        for (const [index, call] of details.calls.entries()) {
          const args = json(call.args);
          // Pi gives running script calls a /? ID until executeTool returns.
          const match = call.id.endsWith("/?") ? pending.findIndex((item) => item.name === call.name) : -1;
          const current = match >= 0 ? pending.splice(match, 1)[0] : live.get(call.id);
          const id = current?.id ?? (call.id.endsWith("/?") ? `${call.id}/${index}` : call.id);
          list.set(id, current ?? { ...call, id, arguments: record(args) ? (args as Call["arguments"]) : undefined });
        }
        for (const call of live.values()) list.set(call.id, call);
        const rows = [...list.values()].map((call) => callLine(call, theme));
        const output = result.content
          .filter((b) => b.type === "text")
          .flatMap((b) => outputLines(b.text, options.expanded));
        if (details.fullOutputPath) output.push(`Full output: ${details.fullOutputPath}`);
        return {
          invalidate() {},
          render(width) {
            const lines = output.flatMap((line) => wrapTextWithAnsi(line, width));
            const shown =
              options.expanded || lines.length <= 12
                ? lines
                : [...lines.slice(0, 12), `… ${lines.length - 12} more lines`];
            return [
              ...rows.map((row) => truncateToWidth(row, width)),
              ...shown.map((line) => theme.fg("toolOutput", line)),
            ];
          },
        };
      },
    };
  });
}
