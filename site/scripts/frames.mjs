// Turn recorded terminal frames (tmux capture-pane -e output) into an HTML replay script.
// Usage: node scripts/frames.mjs <frames dir> <plan.json> <out.json>
// plan.json: [{ "from": <ms>, "to": <ms>, "speed": 20, "caption": "..." }, ...]
// Each output frame is { html, ms, caption } where ms is how long to show it.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, planPath, outPath] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".ans"))
  .map((name) => ({ name, at: Number(name.slice(0, -4)) }))
  .sort((a, b) => a.at - b.at);

const palette = [
  "#1c1c1c",
  "#ff8a80",
  "#7ee2a8",
  "#ffd27d",
  "#82aaff",
  "#c792ea",
  "#89ddff",
  "#dcdcdc",
  "#6b6b6b",
  "#ff8a80",
  "#7ee2a8",
  "#ffd27d",
  "#82aaff",
  "#c792ea",
  "#89ddff",
  "#ffffff",
];
function color256(n) {
  if (n < 16) return palette[n];
  if (n < 232) {
    const v = [0, 95, 135, 175, 215, 255];
    const i = n - 16;
    return `rgb(${v[Math.floor(i / 36)]},${v[Math.floor(i / 6) % 6]},${v[i % 6]})`;
  }
  const g = 8 + (n - 232) * 10;
  return `rgb(${g},${g},${g})`;
}
const esc = (text) => text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

// Convert one line of SGR-colored text into HTML spans.
function line(text) {
  let style = {};
  let out = "";
  let open = false;
  const css = () =>
    [
      style.fg && `color:${style.fg}`,
      style.bg && `background:${style.bg}`,
      style.bold && "font-weight:700",
      style.dim && "opacity:.6",
      style.italic && "font-style:italic",
    ]
      .filter(Boolean)
      .join(";");
  for (const part of text.split(/(\x1b\[[0-9;:]*m)/)) {
    const sgr = /^\x1b\[([0-9;:]*)m$/.exec(part);
    if (!sgr) {
      if (part) out += esc(part.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, ""));
      continue;
    }
    const codes = sgr[1].split(/[;:]/).map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0 || Number.isNaN(c)) style = {};
      else if (c === 1) style.bold = true;
      else if (c === 2) style.dim = true;
      else if (c === 3) style.italic = true;
      else if (c === 22) style.bold = style.dim = false;
      else if (c === 23) style.italic = false;
      else if (c === 39) style.fg = undefined;
      else if (c === 49) style.bg = undefined;
      else if (c >= 30 && c <= 37) style.fg = palette[c - 30];
      else if (c >= 90 && c <= 97) style.fg = palette[c - 82];
      else if (c >= 40 && c <= 47) style.bg = palette[c - 40];
      else if (c === 38 || c === 48) {
        const key = c === 38 ? "fg" : "bg";
        if (codes[i + 1] === 5) {
          style[key] = color256(codes[i + 2]);
          i += 2;
        } else if (codes[i + 1] === 2) {
          style[key] = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
          i += 4;
        }
      }
    }
    if (open) out += "</span>";
    const s = css();
    open = Boolean(s);
    if (open) out += `<span style="${s}">`;
  }
  return out + (open ? "</span>" : "");
}

const frames = [];
for (const step of plan) {
  // At high speeds keep every nth frame so each one still shows for ~50 ms.
  const every = Math.max(1, Math.round((50 * step.speed) / 1000));
  const picked = files.filter((f, i) => f.at >= step.from && f.at <= step.to && i % every === 0);
  for (let i = 0; i < picked.length; i++) {
    const realGap = (picked[i + 1]?.at ?? picked[i].at + 1000) - picked[i].at;
    const html = readFileSync(join(dir, picked[i].name), "utf8")
      .split("\n")
      // Blank lines that only come from the recording machine's setup, never from bruv.
      .map((text) => (step.hide && new RegExp(step.hide).test(text) ? "" : text))
      .slice(-(step.rows ?? 28))
      .map(line)
      .join("\n");
    frames.push({ html, ms: Math.max(40, Math.round(realGap / step.speed)), caption: step.caption });
  }
  if (step.hold && frames.length) frames.at(-1).ms += step.hold;
}
writeFileSync(outPath, JSON.stringify(frames));
const total = frames.reduce((sum, f) => sum + f.ms, 0);
console.log(`${frames.length} frames, ${(total / 1000).toFixed(1)}s`);
