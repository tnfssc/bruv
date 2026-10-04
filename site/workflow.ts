import { landing } from "./content";
import type { Run } from "./capture";
const bg = ";48;2;24;24;24";
const styles = {
  label: "38;2;160;160;160" + bg,
  prompt: "38;2;255;199;153" + bg,
  detail: "38;2;153;255;228" + bg,
  gap: "38;2;255;255;255" + bg,
};
/** Illustrative prompts and a work split, NOT a replayed app transcript. */
export function workflowCells(index: number, maxWidth: number) {
  const cols = Math.min(56, maxWidth);
  const rows: Run[][] = [];
  for (const line of landing.features[index].example) {
    const style = styles[line.kind as keyof typeof styles];
    const words = line.text.split(/\s+/);
    let text = line.kind === "prompt" ? ">" : "";
    const emit = () => rows.push([{ text: " " + text.padEnd(cols - 2) + " ", style }]);
    for (const word of words) {
      if (text && text.length + word.length + 1 > cols - 2) {
        emit();
        text = "";
      }
      text += (text ? " " : "") + word;
    }
    emit();
  }
  return { cols, rows, caption: "Example workflow" };
}
