import { stripVTControlCharacters } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { FinishResult } from "./finish";
import { receiptLines } from "./receipt";

export function registerFinishRender(pi: ExtensionAPI) {
  pi.registerToolRenderer((name, next) => {
    const fallback = next();
    if (name !== "finish") return fallback;
    return {
      ...fallback,
      renderResult(result, options, theme, context) {
        const data = result.details as FinishResult | undefined;
        if (!data?.status)
          return (
            fallback?.renderResult?.(result, options, theme, context) ??
            new Text(
              result.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("\n"),
              0,
              0,
            )
          );
        const note = data.note ? stripVTControlCharacters(data.note) : "";
        const gaps = data.gaps ?? [];
        const lines = data.receipt
          ? receiptLines(data.receipt)
          : gaps.length
            ? [
                theme.fg("error", `✗ Check found ${gaps.length} gap${gaps.length === 1 ? "" : "s"}`),
                ...gaps.map((gap) => `- ${stripVTControlCharacters(gap)}`),
                theme.fg("dim", "Fixing, then checking again."),
              ]
            : [
                data.status === "need_you" ? "Waiting for you" : data.status === "blocked" ? "Blocked" : "Done",
                ...(note ? [note] : []),
              ];
        const extra = options.expanded && note && (data.receipt || gaps.length) ? [theme.fg("dim", note)] : [];
        return {
          invalidate() {},
          render(width) {
            const wrap = (text: string, columns: number) =>
              text.split("\n").flatMap((line) => wrapTextWithAnsi(line, columns));
            const raw = extra.flatMap((line) => wrap(line, Math.max(1, width)));
            if (!data.receipt || width < 5) return [...lines.flatMap((line) => wrap(line, Math.max(1, width))), ...raw];
            const inner = width - 4;
            const edge = (text: string) => theme.fg("accent", text);
            return [
              edge(`╭${"─".repeat(width - 2)}╮`),
              ...lines
                .flatMap((line) => wrap(line, inner))
                .map(
                  (line) => `${edge("│")} ${line}${" ".repeat(Math.max(0, inner - visibleWidth(line)))} ${edge("│")}`,
                ),
              edge(`╰${"─".repeat(width - 2)}╯`),
              ...raw,
            ];
          },
        };
      },
    };
  });
}
