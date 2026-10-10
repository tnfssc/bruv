import { CellFlags, type Terminal } from "ghostty-web";

// One viewport, read from Ghostty's cells. No second output history.
export function visibleTerminalText(term: Terminal): string {
  const screen = term.wasmTerm;
  if (!screen) return "";
  const history = term.buffer.active.type === "alternate" ? 0 : screen.getScrollbackLength();
  const offset = term.buffer.active.type === "alternate" ? 0 : Math.floor(term.getViewportY());
  const lines: string[] = [];
  for (let row = 0; row < term.rows; row++) {
    const absolute = history - offset + row;
    const inHistory = absolute < history;
    const cells = inHistory ? screen.getScrollbackLine(absolute) : screen.getLine(absolute - history);
    let line = "";
    for (let col = 0; col < term.cols; col++) {
      const cell = cells?.[col];
      if (cell?.width === 0) continue;
      if (!cell || cell.flags & CellFlags.INVISIBLE) {
        line += " ";
      } else if (cell.grapheme_len) {
        line += inHistory
          ? screen.getScrollbackGraphemeString(absolute, col)
          : screen.getGraphemeString(absolute - history, col);
      } else {
        line += String.fromCodePoint(cell.codepoint || 32);
      }
    }
    lines.push(line.trimEnd());
  }
  return lines.join("\n").trimEnd();
}

export function installTerminalAccessibility(element: HTMLElement, term: Terminal) {
  const output = document.createElement("pre");
  output.className = "terminal-accessible-output";
  output.setAttribute("role", "region");
  output.setAttribute("aria-label", "Terminal output");
  output.setAttribute("aria-live", "polite");
  output.setAttribute("aria-atomic", "true");
  output.hidden = true;
  element.append(output);
  let active = false;
  let disposed = false;
  let frame: number | undefined;
  const refresh = () => {
    if (!active || disposed || frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (!active || disposed) return;
      const text = visibleTerminalText(term);
      if (output.textContent !== text) output.textContent = text;
    });
  };
  // 0.4.0 declares onRender but never fires it. Writes refresh at the socket seam.
  const scroll = term.onScroll(refresh);
  const resize = term.onResize(refresh);
  return {
    refresh,
    setActive(next: boolean) {
      active = next && !disposed;
      output.hidden = !active;
      if (active) refresh();
      else output.textContent = "";
    },
    dispose() {
      disposed = true;
      active = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      scroll.dispose();
      resize.dispose();
      output.remove();
    },
  };
}
