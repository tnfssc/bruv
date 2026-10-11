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
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const header = ["Done", elapsed, count(data.calls, "call"), ...(data.agents ? [count(data.agents, "agent")] : [])];
  if (data.weekPercent) header.push(`+${data.weekPercent}% week`);
  return [
    header.join(" · "),
    `Asked:   ${clean(data.asked)}`,
    ...data.checked.slice(0, 5).map((line) => `✓ ${clean(line)}`),
    ...(data.skipped ?? []).map((line) => `– ${clean(line)} (not checked)`),
    ...data.gaps.map((line) => `✗ ${clean(line)} (not fixed)`),
    ...(data.failed ? ["Check didn't complete"] : []),
    ...(data.changes ? [`Changed: ${data.changes.files} files, +${data.changes.added} −${data.changes.removed}`] : []),
    ...(data.notes ? [`Notes:   ${data.notes.length ? data.notes.map(clean).join(", ") : "no changes"}`] : []),
  ];
}
