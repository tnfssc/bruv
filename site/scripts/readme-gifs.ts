import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { demoDuration, demoFrame, demoIds } from "../demos";
import { cellRowsHtml } from "../html-cells";
import { launchBrowser } from "./browser";
import { liveDuration, liveFrame } from "./readme-live";

// Export the website's exact demo cells at fixed timestamps, not wall-clock playback.
// Run from site/: bun run gifs. Requires ffmpeg and a Playwright Chromium install.
const root = resolve(import.meta.dir, "../..");
const output = resolve(root, "site/assets/demos");
const framesRoot = resolve(root, "artifacts/readme-gifs");
const fps = 5;
const labels = {
  delegate: "Give the fix its own branch",
  background: "Use the time tests take",
  wisdom: "Pick up where you left off",
  live: "Talk to bruv · Live mode",
};
const font = Buffer.from(await Bun.file(resolve(root, "site/assets/bruv-prompt.woff2")).arrayBuffer()).toString(
  "base64",
);
await mkdir(output, { recursive: true });
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 840, height: 534 }, deviceScaleFactor: 1 });
  await page.setContent(
    [
      "<!doctype html><style>",
      '@font-face{font-family:"Bruv Prompt";src:url(data:font/woff2;base64,' +
        font +
        ') format("woff2");unicode-range:U+F460}',
      "*{box-sizing:border-box}body{margin:0;background:#141820;color:#dee0e1}",
      'header{height:42px;background:#1c2028;border-bottom:1px solid #343941;padding:12px 24px;font:14px "DejaVu Sans Mono",monospace}',
      'small{float:right;color:#7e888e;font:12px "DejaVu Sans Mono",monospace}',
      'pre{margin:0;padding:16px 24px;font:16px/20px "Bruv Prompt","DejaVu Sans Mono","Liberation Mono",monospace;font-variant-ligatures:none}',
      ".demo-row{display:block;height:20px;white-space:pre}",
      '</style><header><span id="title"></span><small>scripted demo</small></header><pre id="screen"></pre>',
    ].join(""),
  );
  await page.evaluate(() => document.fonts.load('16px "Bruv Prompt"', "\uf460"));
  for (const id of [...demoIds, "live"] as const) {
    const dir = resolve(framesRoot, id);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const duration = id === "live" ? liveDuration : demoDuration(id);
    await page.locator("#title").evaluate((el, label) => {
      el.textContent = label;
    }, labels[id]);
    for (let i = 0; i < (duration * fps) / 1000; i++) {
      const elapsed = (i * 1000) / fps;
      const rows = id === "live" ? liveFrame(elapsed) : demoFrame(id, 80, elapsed).rows;
      // Join without newlines: block rows already provide the line breaks.
      const html = cellRowsHtml(rows).replaceAll("</span>\n<span class=", "</span><span class=");
      await page.locator("#screen").evaluate((el, html) => {
        el.innerHTML = html;
      }, html);
      await page.screenshot({ path: resolve(dir, `${String(i).padStart(4, "0")}.png`) });
    }
    const proc = Bun.spawn(
      [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-framerate",
        String(fps),
        "-i",
        resolve(dir, "%04d.png"),
        "-filter_complex",
        "[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
        "-loop",
        "0",
        resolve(output, `${id}.gif`),
      ],
      { stdout: "inherit", stderr: "inherit" },
    );
    if ((await proc.exited) !== 0) throw new Error(`ffmpeg failed for ${id}`);
    console.log(`${id}: ${(await Bun.file(resolve(output, `${id}.gif`)).stat()).size} bytes`);
  }
} finally {
  await browser.close();
}
