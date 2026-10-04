import { siteContent, landing } from "./content";
import { captures } from "./gallery";
import { headline } from "./type";
export type Hit = { x: number; y: number; width: number; height: number; label: string; action: string };
export type State = { route: string; scroll: number; focus: number };
export type CellImage = { id: string; x: number; y: number; width: number; height: number; crop: boolean };
// Vesper: github.com/raunofreiberg/vesper, themes/Vesper-dark-color-theme.json. See licenses/vesper.txt.
export const palette = {
  base: "38;2;255;255;255",
  muted: "38;2;160;160;160",
  accent: "38;2;255;199;153",
  border: "38;2;80;80;80",
  title: "38;2;255;255;255",
  selected: "38;2;0;0;0;48;2;255;199;153",
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
export function layout(cols: number, rows: number, state: State, cellRatio = 0.5) {
  const grid = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ c: " ", style: palette.base as string })),
  );
  const hits: Hit[] = [],
    images: CellImage[] = [];
  const page = siteContent.pages.find((p) => p.id === state.route) || siteContent.pages[0];
  const narrow = cols < 120,
    margin = cols < 60 ? 2 : Math.max(4, Math.floor((cols - 128) / 2));
  const width = cols - 2 * margin,
    top = narrow ? 6 : 5,
    bottom = rows - 4;
  function put(x: number, y: number, text: string, style: string = palette.base) {
    if (y < 0 || y >= rows) return;
    [...text].forEach((c, i) => {
      if (x + i >= 0 && x + i < cols) grid[y][x + i] = { c, style };
    });
  }
  function button(x: number, y: number, label: string, action: string, primary = false, height = 2) {
    const text = primary ? "  " + label + "  " : "[ " + label + " ]";
    if (x + text.length > cols - 1 || y < 0 || y + height > rows) return;
    const index = hits.length;
    hits.push({ x, y, width: text.length, height, label, action });
    const style = state.focus === index || primary ? palette.selected : palette.accent;
    if (primary || state.focus === index)
      for (let r = 0; r < height; r++) put(x, y + r, " ".repeat(text.length), style);
    put(x, y + (height === 3 ? 1 : 0), text, style);
  }
  // All navigation, including the filled CTA, is written into the Ghostty grid.
  button(margin, 1, "bruv", "#overview");
  if (narrow) {
    button(margin + 10, 1, "Install", "#install");
    button(margin + 23, 1, "Source", siteContent.repository);
    let x = margin;
    for (const [label, action] of [
      ["Work", "#workflows"],
      ["Live", "#live"],
      ["Shots", "#gallery"],
      ["?", "#help"],
    ]) {
      button(x, 3, label, action);
      x += label.length + 6;
    }
  } else {
    put(margin + 11, 1, "a coding agent for your terminal", palette.muted);
    const nav = [
      ["Workflows", "#workflows"],
      ["Live", "#live"],
      ["Captures", "#gallery"],
      ["Install", "#install"],
      ["Source", siteContent.repository],
    ];
    let x = cols - margin - nav.reduce((sum, [label]) => sum + label.length + 6, 0) + 2;
    if (x < margin + 45) x = margin + 10;
    for (const [label, action] of nav) {
      button(x, x < margin + 45 ? 3 : 1, label, action);
      x += label.length + 6;
    }
  }
  put(margin, top - 1, "─".repeat(width), palette.border);
  type Piece = {
    x: number;
    y: number;
    text: string;
    style?: string;
    action?: string;
    primary?: boolean;
    height?: number;
  };
  const pieces: Piece[] = [],
    docImages: CellImage[] = [];
  let y = narrow ? 1 : 2;
  const text = (s: string, style: string = palette.base, x = margin, w = width) => {
    for (const line of wrap(s, w)) pieces.push({ x, y: y++, text: line, style });
  };
  const link = (label: string, action: string, primary = false, x = margin) => {
    pieces.push({ x, y, text: label, action, primary, height: 3 });
  };
  const rule = () => {
    pieces.push({ x: margin, y: y++, text: "─".repeat(width), style: palette.border });
  };
  const image = (id: string) => {
    const capture = captures.find((c) => c.id === id)!;
    const crop = narrow && id === "settings";
    const imageWidth = width - 2;
    const height = Math.ceil((imageWidth * cellRatio * capture.height) / (crop ? 660 : capture.width));
    pieces.push({ x: margin, y: y++, text: "┌" + "─".repeat(width - 2) + "┐", style: palette.border });
    docImages.push({ id, x: margin + 1, y, width: imageWidth, height, crop });
    for (let r = 0; r < height; r++) {
      pieces.push({ x: margin, y: y + r, text: "│", style: palette.border });
      pieces.push({ x: margin + width - 1, y: y + r, text: "│", style: palette.border });
    }
    y += height;
    pieces.push({ x: margin, y: y++, text: "└" + "─".repeat(width - 2) + "┘", style: palette.border });
  };
  if (page.id === "overview") {
    text(landing.eyebrow, palette.accent);
    y++;
    const heroY = y,
      wideHero = cols >= 120;
    const heroWidth = wideHero ? Math.min(72, width - 44) : width;
    const titleLines = headline(page.title, heroWidth, !wideHero);
    for (const line of titleLines) pieces.push({ x: margin, y: y++, text: line, style: palette.title });
    const titleEnd = y;
    if (wideHero) y = heroY + 1;
    else y++;
    const pitchX = wideHero ? margin + heroWidth + 5 : margin;
    const pitchWidth = wideHero ? width - heroWidth - 5 : Math.min(width, 65);
    text(page.paragraphs[0], palette.base, pitchX, pitchWidth);
    y++;
    if (wideHero) {
      link("Install Bruv", "#install", true, pitchX);
      y += 4;
      link("View source ↗", siteContent.repository, false, pitchX);
      y += 3;
      y = Math.max(y, titleEnd) + 2;
    } else {
      link("Install Bruv", "#install", true);
      if (width >= 30) link("Source ↗", siteContent.repository, false, margin + 18);
      y += 5;
    }
    text(landing.captureLabel, palette.muted);
    y++;
    image("settings");
    link("Full capture ↗", "./shots/settings.html");
    y += 5;
    rule();
    y += 2;
    const featureTop = y;
    const featureWidth = narrow ? Math.min(width, 78) : Math.floor((width - 8) / 2);
    let featureEnd = y;
    for (let i = 0; i < landing.featureTitles.length; i++) {
      const featureX = !narrow && i === 1 ? margin + featureWidth + 8 : margin;
      if (!narrow) y = featureTop;
      text("0" + (i + 1) + " / " + landing.featureTitles[i], palette.accent, featureX, featureWidth);
      y++;
      text(page.paragraphs[i + 1], palette.base, featureX, featureWidth);
      y++;
      link(i === 0 ? "How delegation works" : "Read about wisdom", page.links[i + 2].href, false, featureX);
      y += 5;
      featureEnd = Math.max(featureEnd, y);
    }
    y = featureEnd;
    if (!narrow)
      for (let row = featureTop; row < featureEnd - 3; row++) {
        pieces.push({ x: margin + featureWidth + 4, y: row, text: "│", style: palette.border });
      }
    rule();
    y += 2;
    text("Start in your project.", palette.title);
    y++;
    text(landing.installNote, palette.muted);
    y++;
    link("Install Bruv", "#install", true);
    y += 5;
  } else {
    text(page.title.toUpperCase(), palette.title);
    y += 2;
    for (const p of page.paragraphs) {
      text(p, palette.base, margin, Math.min(width, 88));
      y++;
    }
    if (page.id === "gallery") {
      for (const capture of captures) {
        text(capture.title, palette.accent);
        y++;
        image(capture.id);
        y++;
        text(capture.caption, palette.muted);
        y++;
        link("Full capture ↗", "./shots/" + capture.id + ".html");
        y += 5;
      }
    }
    for (const l of page.links) {
      for (const label of wrap(l.label, width - 4)) {
        link(label, l.href);
        y += 3;
      }
      y++;
    }
  }
  const visible = Math.max(1, bottom - top + 1),
    maxScroll = Math.max(0, y - visible);
  const scroll = Math.min(Math.max(0, state.scroll), maxScroll);
  for (const p of pieces) {
    const row = top + p.y - scroll;
    if (row < top || row > bottom) continue;
    if (p.action) {
      if (row + (p.height || 1) - 1 <= bottom) button(p.x, row, p.text, p.action, p.primary, p.height);
    } else put(p.x, row, p.text, p.style);
  }
  for (const img of docImages) {
    const row = top + img.y - scroll;
    if (row > bottom || row + img.height <= top) continue;
    images.push({ ...img, y: row });
    // Image hit region is clipped by the same cell viewport as the compositor.
    const iy = Math.max(top, row),
      end = Math.min(bottom + 1, row + img.height);
    hits.push({
      x: img.x,
      y: iy,
      width: img.width,
      height: end - iy,
      label: "Open " + img.id + " capture",
      action: "./shots/" + img.id + ".html",
    });
    if (state.focus === hits.length - 1) {
      for (let r = iy; r < end; r++) {
        put(img.x - 1, r, "│", palette.accent);
        put(img.x + img.width, r, "│", palette.accent);
      }
    }
  }
  put(margin, rows - 3, "─".repeat(width), palette.border);
  let fx = margin;
  for (const [label, action] of [
    ["↑", "up"],
    ["↓", "down"],
    ["HTML", "text"],
    ["?", "#help"],
  ]) {
    button(fx, rows - 2, label, action);
    fx += label.length + 6;
  }
  if (cols - margin - fx > 25) put(fx + 2, rows - 2, "wheel / swipe to explore", palette.muted);
  if (cols - margin - fx > 40)
    put(cols - margin - 12, rows - 2, Math.round((scroll / Math.max(1, maxScroll)) * 100) + "%", palette.muted);
  let ansi = "\x1b[?25l\x1b[?7l\x1b[H";
  for (let row = 0; row < rows; row++) {
    ansi += "\x1b[" + (row + 1) + ";1H";
    let prev = "";
    for (const cell of grid[row]) {
      if (cell.style !== prev) {
        ansi += "\x1b[0;" + cell.style + "m";
        prev = cell.style;
      }
      ansi += cell.c;
    }
  }
  ansi += "\x1b[0m";
  return {
    ansi,
    hits,
    images,
    clip: { top, bottom: bottom + 1 },
    scroll,
    maxScroll,
    visible,
    lines: pieces.map((p) => p.text),
    route: page.id,
  };
}
export function hitAt(hits: Hit[], x: number, y: number) {
  return hits.findIndex((h) => y >= h.y && y < h.y + h.height && x >= h.x && x < h.x + h.width);
}
