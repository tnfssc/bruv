import data from "./assets/settings-cells.json";
export type Run = { text: string; style: string };
const blank = { text: " ", style: "38;2;213;220;229;48;2;20;24;32" };
function pack(cells: Run[], width: number): Run[] {
  const runs: Run[] = [];
  for (const cell of [...cells, ...Array.from({ length: width - cells.length }, () => blank)]) {
    const last = runs.at(-1);
    if (last?.style === cell.style) last.text += cell.text;
    else runs.push({ ...cell });
  }
  return runs;
}
function wrapRow(cells: Run[], cols: number): Run[][] {
  const rows: Run[][] = [];
  let rest = cells;
  while (rest.length > cols) {
    let end = cols;
    for (let x = cols; x > 0; x--)
      if (rest[x]?.text === " ") {
        end = x;
        break;
      }
    rows.push(pack(rest.slice(0, end), cols));
    rest = rest.slice(end);
    while (rest[0]?.text === " ") rest.shift();
  }
  rows.push(pack(rest, cols));
  return rows;
}
function reflowMenuRow(cells: Run[], cols: number): Run[][] {
  // The captured menu has labels in columns 0–34, a separator at 35, and values from 36.
  const label = cells.slice(0, 35);
  while (label.at(-1)?.text === " ") label.pop();
  const value = cells.slice(36);
  if (label.length + 1 + value.length <= cols) {
    const padding = Array.from({ length: cols - label.length - value.length }, () => blank);
    return [pack([...label, ...padding, ...value], cols)];
  }
  return wrapRow(cells, cols);
}
/** Reflow only whitespace. Every visible source glyph retains its style and order.
 * Menu values stay paired with their source label; prose wraps at word boundaries.
 * No terminal escape parsing here: extraction already replayed the source in WASM.
 */
export function settingsCapture(maxWidth: number) {
  const cols = Math.min(maxWidth, data.cols);
  if (cols === data.cols) return { cols, rows: data.rows, caption: "Local settings menu (excerpt)." };
  const rows: Run[][] = [];
  for (const [i, runs] of data.rows.entries()) {
    const cells = runs.flatMap((run) => [...run.text].map((text) => ({ text, style: run.style })));
    while (cells.at(-1)?.text === " ") cells.pop();
    // The first ten source rows are menu entries; the remaining rows are count/prose/hints.
    rows.push(...(i < 10 ? reflowMenuRow(cells, cols) : wrapRow(cells, cols)));
  }
  return { cols, rows, caption: "Local settings menu, reflowed." };
}
