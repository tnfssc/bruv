import { siteContent, landing } from "./content";
import { headline } from "./type";
import { workflowCells } from "./workflow";
export type Hit = { x: number; y: number; width: number; height: number; label: string; action: string };
export type State = { scroll: number; focus: number };
// Official Vesper colors. Capture colors are preserved separately, not recolored.
export const palette = {
  base: "38;2;255;255;255",
  muted: "38;2;160;160;160",
  accent: "38;2;255;199;153",
  border: "38;2;80;80;80",
  title: "38;2;255;255;255",
  selected: "38;2;16;16;16;48;2;255;199;153",
};
const clean = (s: string) =>
  s
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
export function wrap(text: string, width: number): string[] {
  if (text.includes("\n")) return text.split("\n").flatMap((line) => wrap(line, width));
  const lines: string[] = [];
  let line = "";
  for (let word of clean(text).split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = "";
    }
    while (word.length > width) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (word) line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  return lines;
}

export function layout(cols: number, rows: number, state: State) {
  const grid = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ c: " ", style: palette.base as string })),
  );
  const hits: Hit[] = [];
  const margin = cols < 60 ? 2 : Math.max(4, Math.floor((cols - 112) / 2));
  const width = cols - 2 * margin,
    top = 3,
    bottom = rows - 3;
  const pieces: { x: number; y: number; text: string; style: string; action?: string; primary?: boolean }[] = [];
  let y = width < 60 ? 1 : 2;
  function put(x: number, row: number, value: string, style: string = palette.base) {
    if (row < 0 || row >= rows) return;
    [...value].forEach((c, i) => {
      if (x + i >= 0 && x + i < cols) grid[row][x + i] = { c, style };
    });
  }
  function text(value: string, style: string = palette.base, x = margin, w = width) {
    for (const line of wrap(value, w)) pieces.push({ x, y: y++, text: line, style });
  }
  function link(label: string, action: string, x = margin, primary = false) {
    pieces.push({
      x,
      y,
      text: primary ? "  " + label + "  " : "[ " + label + " ]",
      style: palette.accent,
      action,
      primary,
    });
  }
  put(margin, 1, "bruv", palette.accent);
  if (width > 45) put(margin + 7, 1, "a coding agent for your terminal", palette.muted);
  text(landing.eyebrow, palette.muted);
  y += 2;
  for (const line of headline(landing.title, width, width < 80))
    pieces.push({ x: margin, y: y++, text: line, style: palette.title });
  y++;
  text(landing.titleTail, palette.accent);
  y += 2;
  text(landing.intro, palette.base, margin, Math.min(width, 66));
  y += 2;
  link("Install Bruv", siteContent.install, margin, true);
  if (width < 38) {
    y += 2;
    link("Source ↗", siteContent.repository);
  } else link("Source ↗", siteContent.repository, margin + 20);
  y += 4;
  const captures: (ReturnType<typeof workflowCells> & { x: number; y: number })[] = [];
  landing.features.forEach((feature, i) => {
    const beside = width >= 96;
    const sectionTop = y;
    const captionWidth = beside ? width - 64 : width;
    text("0" + (i + 1), palette.muted);
    y++;
    text(feature.title, palette.accent, margin, captionWidth);
    y++;
    text(feature.text, palette.base, margin, captionWidth);
    const copyEnd = y;
    y = beside ? sectionTop : y + 2;
    const capture = workflowCells(i, beside ? 56 : width - 2);
    const frameX = beside ? margin + width - capture.cols - 2 : margin;
    text(capture.caption, palette.muted, frameX, capture.cols);
    y++;
    pieces.push({ x: frameX, y: y++, text: "╭" + "─".repeat(capture.cols) + "╮", style: palette.border });
    captures.push({ x: frameX + 1, y, ...capture });
    for (const row of capture.rows) {
      pieces.push({ x: frameX, y, text: "│", style: palette.border });
      let x = frameX + 1;
      for (const run of row) {
        pieces.push({ x, y, text: run.text, style: run.style });
        x += [...run.text].length;
      }
      pieces.push({ x: frameX + 1 + capture.cols, y: y++, text: "│", style: palette.border });
    }
    pieces.push({ x: frameX, y: y++, text: "╰" + "─".repeat(capture.cols) + "╯", style: palette.border });
    y = Math.max(copyEnd, y) + 4;
  });
  text("─".repeat(width), palette.border);
  y += 2;
  text(landing.installTitle, palette.accent);
  y++;
  text(landing.installNote, palette.base, margin, Math.min(width, 66));
  y++;
  text(landing.start, palette.accent);
  y++;
  text(landing.requirements, palette.muted, margin, Math.min(width, 66));
  y += 2;
  link("Install Bruv", siteContent.install, margin, true);
  y += 5;
  const visible = Math.max(1, bottom - top + 1),
    maxScroll = Math.max(0, y - visible);
  const scroll = Math.min(Math.max(0, state.scroll), maxScroll);
  for (const p of pieces) {
    const row = top + p.y - scroll;
    if (row < top || row > bottom) continue;
    if (p.action) {
      const index = hits.length;
      hits.push({ x: p.x, y: row, width: [...p.text].length, height: 1, label: p.text.trim(), action: p.action });
      put(p.x, row, p.text, state.focus === index || p.primary ? palette.selected : p.style);
    } else put(p.x, row, p.text, p.style);
  }
  put(margin, rows - 2, width < 55 ? "scroll / swipe" : "scroll to explore", palette.muted);
  const label = "[ HTML ]",
    x = cols - margin - label.length;
  const focused = state.focus === hits.length;
  hits.push({ x, y: rows - 2, width: label.length, height: 1, label: "HTML", action: "text" });
  put(x, rows - 2, label, focused ? palette.selected : palette.accent);
  const ansiRows = grid.map((row, i) => {
    let ansi = "\x1b[" + (i + 1) + ";1H",
      prev = "";
    for (const cell of row) {
      if (cell.style !== prev) {
        ansi += "\x1b[0;" + cell.style + "m";
        prev = cell.style;
      }
      ansi += cell.c;
    }
    return ansi;
  });
  return {
    ansi: "\x1b[?25l\x1b[?7l\x1b[H" + ansiRows.join("") + "\x1b[0m",
    ansiRows,
    hits,
    scroll,
    maxScroll,
    visible,
    clip: { top, bottom: bottom + 1 },
    capture: { ...captures[0], y: top + captures[0].y - scroll },
    captures: captures.map((c) => ({ ...c, y: top + c.y - scroll })),
    lines: pieces.map((p) => p.text),
  };
}
export function hitAt(hits: Hit[], x: number, y: number) {
  return hits.findIndex((h) => y >= h.y && y < h.y + h.height && x >= h.x && x < h.x + h.width);
}
