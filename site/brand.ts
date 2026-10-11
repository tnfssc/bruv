import cells from "./assets/brand/wordmark-cells.json";

// Half-block terminal glyphs rendered from the same SVG used by the HTML view.
export function wordmark(width: number): string[] {
  return width >= 48 ? cells["48"] : width >= 28 ? cells["28"] : cells["24"];
}
