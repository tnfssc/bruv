/** Screenshot exact full PTY viewports in a browser. No cropping, redaction or pixel edits.
 * This is an ANSI terminal replay, not a desktop photograph or another UI renderer.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
const dir = resolve(process.argv[2] ?? "");
if (process.argv.length !== 3) throw Error("Usage: bun scripts/tasks-ui-proof-screenshots.ts CAPTURE_DIR");
const modulePath = process.env.PLAYWRIGHT_CORE;
const executablePath = process.env.CHROMIUM_BIN;
if (!modulePath || !executablePath)
  throw Error("Set PLAYWRIGHT_CORE and CHROMIUM_BIN to installed cached assets; no downloads");
const { chromium } = await import(modulePath);
const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const base = [
  "#000000",
  "#cd0000",
  "#00cd00",
  "#cdcd00",
  "#0000ee",
  "#cd00cd",
  "#00cdcd",
  "#e5e5e5",
  "#7f7f7f",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#5c5cff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
];
const ansi = (n: number): string => {
  if (n < 16) return base[n]!;
  if (n >= 232)
    return (
      "rgb(" +
      Array(3)
        .fill(8 + (n - 232) * 10)
        .join(",") +
      ")"
    );
  const v = [0, 95, 135, 175, 215, 255];
  n -= 16;
  return "rgb(" + [v[Math.floor(n / 36)], v[Math.floor(n / 6) % 6], v[n % 6]].join(",") + ")";
};
function replay(text: string) {
  let fg = "#e5e5e5",
    bg = "#000000",
    bold = false,
    italic = false,
    dim = false,
    underline = false,
    reverse = false;
  let html = "";
  for (const part of text.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith("\x1b")) {
      const ns = part
        .slice(2, -1)
        .split(";")
        .map((s) => Number(s || 0));
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i]!;
        if (!n) {
          fg = "#e5e5e5";
          bg = "#000000";
          bold = italic = dim = underline = reverse = false;
        } else if (n === 1) bold = true;
        else if (n === 2) dim = true;
        else if (n === 3) italic = true;
        else if (n === 4) underline = true;
        else if (n === 7) reverse = true;
        else if (n === 22) bold = dim = false;
        else if (n === 23) italic = false;
        else if (n === 24) underline = false;
        else if (n === 27) reverse = false;
        else if (n === 39) fg = "#e5e5e5";
        else if (n === 49) bg = "#000000";
        else if (n >= 30 && n <= 37) fg = ansi(n - 30);
        else if (n >= 90 && n <= 97) fg = ansi(n - 90 + 8);
        else if (n >= 40 && n <= 47) bg = ansi(n - 40);
        else if (n >= 100 && n <= 107) bg = ansi(n - 100 + 8);
        else if (n === 38 || n === 48) {
          const mode = ns[++i];
          const color =
            mode === 5 ? ansi(ns[++i]!) : mode === 2 ? "rgb(" + ns.slice(i + 1, i + 4).join(",") + ")" : null;
          if (mode === 2) i += 3;
          if (!color) throw Error("Unsupported SGR color");
          if (n === 38) fg = color;
          else bg = color;
        } else throw Error("Unsupported SGR: " + n);
      }
    } else {
      if (part.includes("\x1b")) throw Error("Non-SGR sequence in tmux viewport");
      html +=
        '<span style="color:' +
        (reverse ? bg : fg) +
        ";background:" +
        (reverse ? fg : bg) +
        ";font-weight:" +
        (bold ? 700 : 400) +
        ";font-style:" +
        (italic ? "italic" : "normal") +
        ";opacity:" +
        (dim ? 0.65 : 1) +
        ";text-decoration:" +
        (underline ? "underline" : "none") +
        '">' +
        esc(part) +
        "</span>";
    }
  }
  return html;
}
const timeline = JSON.parse(await readFile(join(dir, "timeline.json"), "utf8"));
const font = (await readFile(process.env.TERMINAL_FONT ?? "/usr/share/fonts/TTF/DejaVuSansMono.ttf")).toString(
  "base64",
);
const screenshotHashes: Record<string, string> = {};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  await page.route("**/*", (route: any) => route.abort());
  for (const frame of timeline) {
    const screen = await readFile(join(dir, frame.step + ".viewport.ansi.txt"), "utf8");
    const html =
      '<!doctype html><meta charset="utf-8"><style>@font-face{font-family:terminal;src:url(data:font/ttf;base64,' +
      font +
      ")}body{margin:0;background:black;color:#e5e5e5}pre{box-sizing:border-box;margin:0;padding:12px;font:16px/22px terminal,monospace;white-space:pre;width:max-content;min-width:100vw;min-height:100vh}</style><pre>" +
      replay(screen) +
      "</pre>";
    await writeFile(join(dir, frame.step + ".html"), html);
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    if ((await page.locator("pre").innerText()) !== screen.replace(/\x1b\[[0-9;]*m/g, ""))
      throw Error("Replay changed viewport text");
    const png = await page.screenshot({ path: join(dir, frame.step + ".png"), fullPage: true });
    screenshotHashes[frame.step] = hash(png);
  }
} finally {
  await browser.close();
}
await writeFile(
  join(dir, "screenshots.json"),
  JSON.stringify(
    {
      kind: "full text-identical native PTY ANSI replay, no pixel edits",
      playwrightModule: modulePath,
      chromiumBinary: executablePath,
      chromiumSha256: hash(await readFile(executablePath)),
      fontSha256: hash(Buffer.from(font, "base64")),
      screenshotHashes,
    },
    null,
    2,
  ) + "\n",
);
console.log("Full unedited ANSI-replay screenshots: " + timeline.length);
