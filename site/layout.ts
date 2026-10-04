import { siteContent } from "./content";
export type Hit = { x: number; y: number; width: number; label: string; action: string };
export type State = { route: string; scroll: number; focus: number };
export const palette = {
  base: "38;2;211;221;215",
  muted: "38;2;136;155;146",
  accent: "38;2;194;242;120",
  border: "38;2;66;88;76",
  title: "1;38;2;235;244;229",
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
  function put(x: number, y: number, s: string, style: string = palette.base) {
    if (y < 0 || y >= rows) return;
    [...s].forEach((c, i) => {
      if (x + i >= 0 && x + i < cols) grid[y][x + i] = { c, style };
    });
  }
  function button(x: number, y: number, label: string, action: string) {
    const text = "[" + label + "]";
    if (x + text.length > cols - 1) return;
    const index = hits.length;
    hits.push({ x, y, width: text.length, label, action });
    put(x, y, text, state.focus === index ? "30;48;2;194;242;120" : palette.accent);
  }
  const narrow = cols < 90;
  const page = siteContent.pages.find((p) => p.id === state.route) || siteContent.pages[0];
  put(1, 0, "┌" + "─".repeat(cols - 4) + "┐", palette.border);
  put(3, 1, "bruv", palette.accent);
  put(9, 1, narrow ? "/ " + page.title : "/ coding agent for your terminal", palette.title);
  if (!narrow) put(cols - 24, 1, "STATIC / NO SHELL", palette.muted);
  put(1, 2, "├" + "─".repeat(cols - 4) + "┤", palette.border);
  let navY = 3,
    navX = 3;
  siteContent.pages.forEach((p, i) => {
    const label =
      i +
      1 +
      " " +
      ({
        overview: "Overview",
        install: "Install",
        workflows: "Workflows",
        live: "Live",
        gallery: "Gallery",
        help: "Help",
      }[p.id] || p.title);
    if (navX + label.length + 2 > cols - 3) {
      navY += 2;
      navX = 3;
    }
    button(navX, navY, label, "#" + p.id);
    navX += label.length + 4;
  });
  const top = navY + 2;
  const bottom = rows - 5;
  put(1, top - 1, "├" + "─".repeat(cols - 4) + "┤", palette.border);
  for (let y = 1; y < rows - 1; y++) {
    if (![2, top - 1, bottom + 1].includes(y)) {
      put(1, y, "│", palette.border);
      put(cols - 2, y, "│", palette.border);
    }
  }
  const textX = narrow ? 3 : 5;
  const sidePane = page.id === "overview" && cols >= 128;
  const width = Math.min(cols - textX - 5, sidePane ? 80 : 88);
  type Line = { text: string; style?: string; action?: string; label?: string };
  const lines: Line[] = [];
  const add = (text: string, style?: string) => wrap(text, width).forEach((text) => lines.push({ text, style }));
  if (page.id === "overview" && !narrow) {
    [
      " _                         ",
      "| |__  _ __ _   ___   __    ",
      "| '_ \\| '__| | | \\ \\ / /    ",
      "| |_) | |  | |_| |\\ V /     ",
      "|_.__/|_|   \\__,_| \\_/      ",
    ].forEach((text) => lines.push({ text, style: palette.accent }));
    lines.push({ text: "" });
  }
  add(page.title.toUpperCase(), palette.accent);
  lines.push({ text: "" });
  page.paragraphs.forEach((p) => {
    add(p);
    lines.push({ text: "" });
  });
  page.links.forEach((link) => {
    wrap("> " + link.label, width).forEach((text) =>
      lines.push({ text, style: palette.accent, action: link.href, label: link.label }),
    );
    lines.push({ text: "" });
  });
  if (page.id === "install") {
    add("The command is text, not an executable prompt.", palette.muted);
  }
  const visible = Math.max(1, bottom - top + 1);
  const maxScroll = Math.max(0, lines.length - visible);
  const scroll = Math.min(Math.max(0, state.scroll), maxScroll);
  lines.slice(scroll, scroll + visible).forEach((line, i) => {
    let style = line.style || palette.base;
    if (line.action) {
      const index = hits.length;
      hits.push({ x: textX, y: top + i, width: line.text.length, label: line.label!, action: line.action });
      if (state.focus === index) style = "30;48;2;194;242;120";
    }
    put(textX, top + i, line.text, style);
  });
  if (sidePane) {
    const sx = textX + width + 4,
      sw = cols - sx - 5;
    for (let y = top; y <= bottom; y++) put(sx, y, "│", palette.border);
    let sy = top + 1;
    put(sx + 3, sy, "BUILD FROM SOURCE", palette.accent);
    sy += 2;
    const install = siteContent.pages.find((p) => p.id === "install")!;
    for (const line of wrap(install.paragraphs[0], sw - 2)) {
      if (sy < bottom) put(sx + 3, sy++, line, palette.muted);
    }
    sy++;
    for (const line of wrap(siteContent.installCommand, sw - 2)) {
      if (sy < bottom) put(sx + 3, sy++, line);
    }
    sy++;
    if (sy < bottom) button(sx + 3, sy, "Install guide", "#install");
    sy += 3;
    if (sy + 5 < bottom) {
      put(sx + 3, sy, "CLI CAPTURES", palette.accent);
      sy += 2;
      for (const link of siteContent.pages.find((p) => p.id === "gallery")?.links.slice(0, 2) || []) {
        button(sx + 3, sy, link.label.replace("View ", ""), link.href);
        sy += 2;
      }
    }
  }
  put(1, bottom + 1, "├" + "─".repeat(cols - 4) + "┤", palette.border);
  let bx = 3;
  for (const [label, action] of [
    ["Back", "back"],
    ["↑", "up"],
    ["↓", "down"],
    ["HTML", "text"],
  ]) {
    button(bx, bottom + 2, label, action);
    bx += label.length + 4;
  }
  if (cols > bx + 18)
    put(
      bx + 1,
      bottom + 2,
      scroll + 1 + "-" + Math.min(scroll + visible, lines.length) + " / " + lines.length,
      palette.muted,
    );
  put(
    3,
    bottom + 3,
    narrow
      ? "Tab Enter · ↑↓ scroll · ? help"
      : "Click / Tab + Enter   ↑↓ / wheel scroll   Esc back   ? help   a plain HTML",
    palette.muted,
  );
  put(1, rows - 1, "└" + "─".repeat(cols - 4) + "┘", palette.border);
  let ansi = "\x1b[?25l\x1b[?7l\x1b[H";
  for (let y = 0; y < rows; y++) {
    ansi += "\x1b[" + (y + 1) + ";1H";
    let prev = "";
    for (const cell of grid[y]) {
      if (cell.style !== prev) {
        ansi += "\x1b[0;" + cell.style + "m";
        prev = cell.style;
      }
      ansi += cell.c;
    }
  }
  ansi += "\x1b[0m";
  return { ansi, hits, scroll, maxScroll, visible, lines: lines.map((l) => l.text), route: page.id };
}
export function hitAt(hits: Hit[], x: number, y: number) {
  return hits.findIndex((hit) => y === hit.y && x >= hit.x && x < hit.x + hit.width);
}
