import type { Cell } from "./type";

export const escapeText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Demo cells carry RGB SGR colors. Keep those colors, not a second UI palette. */
export function cellStyle(sgr: string): string {
  return [
    ["38", "color"],
    ["48", "background-color"],
  ]
    .map(([code, property]) => {
      const match = sgr.match(new RegExp(code + ";2;(\\d+);(\\d+);(\\d+)"));
      return match ? property + ":rgb(" + match.slice(1).join(",") + ")" : "";
    })
    .filter(Boolean)
    .join(";");
}

/** Adjacent cells with one style become a run, so a frame needs tens of spans, not thousands. */
export function cellRowHtml(row: Cell[]): string {
  const runs: { text: string; style: string }[] = [];
  for (const cell of row) {
    const last = runs.at(-1);
    if (last?.style === cell.style) last.text += cell.text;
    else runs.push({ ...cell });
  }
  return runs.map((run) => '<span style="' + cellStyle(run.style) + '">' + escapeText(run.text) + "</span>").join("");
}

export function cellRowsHtml(rows: Cell[][]): string {
  return rows.map((row) => '<span class="demo-row">' + cellRowHtml(row) + "</span>").join("\n");
}
