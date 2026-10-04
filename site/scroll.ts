// Keep physical wheel/touch distance; terminal content advances in whole cells.
export class CellScroll {
  private remainder = 0;
  reset() {
    this.remainder = 0;
  }
  move(current: number, pixels: number, cellHeight: number, max: number) {
    if (pixels === 0) return current;
    // An opposite gesture must not first pay off the previous fractional cell.
    if (Math.sign(pixels) !== Math.sign(this.remainder)) this.remainder = 0;
    this.remainder += pixels / cellHeight;
    const rows = Math.trunc(this.remainder);
    this.remainder -= rows;
    const next = Math.max(0, Math.min(max, current + rows));
    if ((next === 0 && pixels < 0) || (next === max && pixels > 0)) this.reset();
    return next;
  }
}
export function wheelPixels(delta: number, mode: number, cellHeight: number, visibleRows: number) {
  return delta * (mode === 1 ? cellHeight : mode === 2 ? visibleRows * cellHeight : 1);
}
