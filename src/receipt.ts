import { stripVTControlCharacters } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { CheckReport } from "./check";
import type { TurnSummary } from "./turn";

export type Receipt = CheckReport & TurnSummary;
const clean = (text: string) =>
  stripVTControlCharacters(text)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\p{Cc}/gu, "");

export function registerReceipt(pi: ExtensionAPI, report: () => CheckReport | undefined) {
  pi.registerEntryRenderer<Receipt>("bruv-receipt", (entry, _options, theme) => ({
    invalidate() {},
    render(width) {
      const data = entry.data as Receipt;
      const seconds = data.elapsedSeconds;
      const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
      const header = ["Done", elapsed, `${data.calls} calls`, `${data.agents} agents`];
      if (data.weekPercent) header.push(`+${data.weekPercent}% week`);
      const lines = [
        header.join(" · "),
        `Asked:   ${clean(data.asked)}`,
        ...data.checked.slice(0, 5).map((line) => `✓ ${clean(line)}`),
        ...data.gaps.map((line) => `✗ ${clean(line)} (not fixed)`),
        ...(data.failed ? ["Check didn't complete"] : []),
        ...(data.changes
          ? [`Changed: ${data.changes.files} files, +${data.changes.added} −${data.changes.removed}`]
          : []),
      ];
      if (width < 5) return lines.flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width)));
      const inner = width - 4;
      const edge = (text: string) => theme.fg("accent", text);
      return [
        edge(`╭${"─".repeat(width - 2)}╮`),
        ...lines
          .flatMap((line) => wrapTextWithAnsi(line, inner))
          .map((line) => `${edge("│")} ${line}${" ".repeat(Math.max(0, inner - visibleWidth(line)))} ${edge("│")}`),
        edge(`╰${"─".repeat(width - 2)}╯`),
      ];
    },
  }));
  return (summary: TurnSummary) => {
    const checked = report();
    if (!checked) return false;
    pi.appendEntry<Receipt>("bruv-receipt", { ...structuredClone(checked), ...summary });
    return true;
  };
}
