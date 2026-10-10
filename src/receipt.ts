import { stripVTControlCharacters } from "node:util";
import type { CheckReport } from "./check";
import type { TurnSummary } from "./turn";

export type Receipt = CheckReport & TurnSummary;
const clean = (text: string) =>
  stripVTControlCharacters(text)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\p{Cc}/gu, "");

export function receiptLines(data: Receipt) {
  const seconds = data.elapsedSeconds;
  const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
  const header = ["Done", elapsed, `${data.calls} calls`, `${data.agents} agents`];
  if (data.weekPercent) header.push(`+${data.weekPercent}% week`);
  return [
    header.join(" · "),
    `Asked:   ${clean(data.asked)}`,
    ...data.checked.slice(0, 5).map((line) => `✓ ${clean(line)}`),
    ...data.gaps.map((line) => `✗ ${clean(line)} (not fixed)`),
    ...(data.failed ? ["Check didn't complete"] : []),
    ...(data.changes ? [`Changed: ${data.changes.files} files, +${data.changes.added} −${data.changes.removed}`] : []),
  ];
}
