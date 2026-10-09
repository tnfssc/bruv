import { requireValue } from "../scripts/lib/require-value";
import { INSTALL_COMMAND, INSTALL_SOURCE_URL } from "./install-command";
import { siteContent, landing } from "./content";
import { wordmark } from "./brand";
import { demoIds, demoFrame, demoDuration, type DemoId } from "./demos";
import type { Playback } from "./playback";
export type Hit = { x: number; y: number; width: number; height: number; label: string; action: string };
export type State = {
  scroll: number;
  focus: number;
  hover?: DemoId;
  installCommand?: string;
  installUrl?: string;
  copyLabel?: string;
  demos?: Record<DemoId, Playback>;
};
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
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Match terminal control bytes.
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

type Piece = {
  x: number;
  y: number;
  text: string;
  style: string;
  action?: string;
  primary?: boolean;
  height?: number;
  demo?: DemoId;
};
type Capture = {
  id: DemoId;
  x: number;
  y: number;
  cols: number;
  rows: { text: string; style: string }[][];
  stage: string;
};

function demoPanel(id: DemoId, x: number, y: number, cols: number, elapsed: number) {
  const demo = demoFrame(id, cols, elapsed);
  const pieces: Piece[] = [
    {
      x,
      y,
      text: `╭${"─".repeat(cols)}╮`,
      style: palette.border,
      action: `demo:${id}:toggle`,
      height: demo.rows.length + 2,
      demo: id,
    },
  ];
  const capture: Capture = {
    id,
    x: x + 1,
    y: y + 1,
    cols,
    rows: demo.rows.map((row) => row.map((cell) => ({ text: cell.text, style: cell.style }))),
    stage: demo.stage,
  };
  for (const [i, row] of capture.rows.entries()) {
    const rowY = capture.y + i;
    pieces.push({ x, y: rowY, text: "│", style: palette.border });
    let runX = capture.x;
    for (const run of row) {
      pieces.push({ x: runX, y: rowY, text: run.text, style: run.style });
      runX += [...run.text].length;
    }
    pieces.push({ x: x + 1 + cols, y: rowY, text: "│", style: palette.border });
  }
  const bottom = capture.y + capture.rows.length;
  pieces.push({ x, y: bottom, text: `╰${"─".repeat(cols)}╯`, style: palette.border });
  return { pieces, capture, end: bottom + 1 };
}

function composeLanding(
  width: number,
  margin: number,
  state: Pick<State, "demos" | "installCommand" | "installUrl" | "copyLabel">,
) {
  const pieces: Piece[] = [];
  const captures: Capture[] = [];
  let y = width < 60 ? 2 : 3;
  function text(value: string, style: string = palette.base, x = margin, w = width) {
    for (const line of wrap(value, w)) pieces.push({ x, y: y++, text: line, style });
  }
  function link(label: string, action: string, x = margin, primary = false) {
    pieces.push({
      x,
      y,
      text: primary ? `  ${label}  ` : `[ ${label} ]`,
      style: palette.accent,
      action,
      primary,
    });
  }
  for (const line of wordmark(width)) pieces.push({ x: margin, y: y++, text: line, style: palette.title });
  y++;
  text(landing.titleTail, palette.accent);
  y += 2;
  text(landing.intro, palette.base, margin, Math.min(width, 66));
  y += 2;
  link("Install bruv", "install", margin, true);
  if (width < 38) {
    y += 2;
    link("Source ↗", siteContent.repository);
  } else link("Source ↗", siteContent.repository, margin + 20);
  y += 4;
  landing.features.forEach((feature, i) => {
    const id = demoIds[i];
    const beside = width >= 100;
    const demoCols = beside ? 68 : width - 2;
    const sectionTop = y;
    const captionWidth = beside ? width - demoCols - 6 : width;
    text(feature.title, palette.accent, margin, captionWidth);
    y++;
    text(feature.text, palette.base, margin, captionWidth);
    const copyEnd = y;
    const frameTop = beside ? sectionTop : copyEnd + 2;
    const frameX = beside ? margin + width - demoCols - 2 : margin;
    const panel = demoPanel(id, frameX, frameTop, demoCols, state.demos?.[id]?.elapsed ?? demoDuration(id));
    pieces.push(...panel.pieces);
    captures.push(panel.capture);
    y = Math.max(copyEnd, panel.end) + 4;
  });
  text("─".repeat(width), palette.border);
  y += 2;
  text(landing.installTitle, palette.accent);
  y++;
  text(landing.installNote, palette.base, margin, Math.min(width, 66));
  y++;
  text(state.installCommand || INSTALL_COMMAND, palette.accent);
  y++;
  link(state.copyLabel || "Copy command", "copy-install", margin, true);
  y += 2;
  link("Script ↗", state.installUrl || INSTALL_SOURCE_URL);
  y += 2;
  link("Source guide ↗", siteContent.install);
  y += 3;
  text(landing.start, palette.accent);
  y++;
  text(landing.requirements, palette.muted, margin, Math.min(width, 66));
  y += 7;
  return { pieces, captures, height: y };
}

export function layout(cols: number, rows: number, state: State) {
  const grid = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ c: " ", style: palette.base as string })),
  );
  const hits: Hit[] = [];
  const margin = cols < 60 ? 2 : Math.max(4, Math.floor((cols - 112) / 2));
  const width = cols - 2 * margin,
    top = 3,
    bottom = rows - 1;
  function put(x: number, row: number, value: string, style: string = palette.base) {
    if (row < 0 || row >= rows) return;
    [...value].forEach((c, i) => {
      if (x + i >= 0 && x + i < cols) grid[row][x + i] = { c, style };
    });
  }
  put(margin, 1, "bruv", palette.accent);
  if (width > 50) put(margin + 7, 1, "an opinionated coding agent", palette.muted);
  const htmlLabel = "[ HTML ]",
    htmlX = cols - margin - htmlLabel.length;
  hits.push({ x: htmlX, y: 1, width: htmlLabel.length, height: 1, label: "HTML", action: "text" });
  put(htmlX, 1, htmlLabel, state.focus === 0 ? palette.selected : palette.accent);
  const { pieces, captures, height } = composeLanding(width, margin, state);
  const visible = Math.max(1, bottom - top + 1),
    maxScroll = Math.max(0, height - visible);
  const scroll = Math.min(Math.max(0, state.scroll), maxScroll);
  const controls: { x: number; y: number; text: string; style: string }[] = [];
  for (const p of pieces) {
    const row = top + p.y - scroll;
    if (row + (p.height ?? 1) <= top || row > bottom) continue;
    if (p.action) {
      const index = hits.length;
      hits.push({
        x: p.x,
        y: Math.max(top, row),
        width: [...p.text].length,
        height: Math.min(row + (p.height ?? 1), bottom + 1) - Math.max(top, row),
        label: p.action.startsWith("demo:")
          ? `${(state.demos?.[requireValue(p.demo)]?.paused ? "Play " : "Pause ") + p.demo} demo`
          : p.text.trim(),
        action: p.action,
      });
      if (row >= top)
        put(p.x, row, p.text, !p.demo && (state.focus === index || p.primary) ? palette.selected : p.style);
      if (p.demo && (state.focus === index || state.hover === p.demo)) {
        const label = `[ ${state.demos?.[p.demo]?.paused ? "Play" : "Pause"} ]`;
        // Use the border (or the first visible row), never add a layout row.
        controls.push({
          x: p.x + p.text.length - label.length - 1,
          y: Math.max(top, row),
          text: label,
          style: state.focus === index ? palette.selected : palette.accent,
        });
      }
    } else if (row >= top) put(p.x, row, p.text, p.style);
  }
  for (const c of controls) put(c.x, c.y, c.text, c.style);
  const ansiRows = grid.map((row, i) => {
    let ansi = `\x1b[${i + 1};1H`,
      prev = "";
    for (const cell of row) {
      if (cell.style !== prev) {
        ansi += `\x1b[0;${cell.style}m`;
        prev = cell.style;
      }
      ansi += cell.c;
    }
    return ansi;
  });
  return {
    ansi: `\x1b[?25l\x1b[?7l\x1b[H${ansiRows.join("")}\x1b[0m`,
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
