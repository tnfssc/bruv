import { resolve } from "node:path";

// One-time asset tool, not part of the build. Needs librsvg and ImageMagick.
const source = resolve(import.meta.dir, "../assets/brand/bruv-wordmark.svg");
const result: Record<string, string[]> = {};
for (const width of [24, 28, 48]) {
  const height = Math.ceil((width * 188) / 530 / 2) * 2;
  const render = Bun.spawn(["rsvg-convert", "-w", String(width), "-h", String(height), source], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const png = await new Response(render.stdout).arrayBuffer();
  if (await render.exited) throw new Error("Wordmark SVG render failed");
  const convert = Bun.spawn(["magick", "png:-", "-alpha", "extract", "-depth", "8", "gray:-"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  convert.stdin.write(png);
  convert.stdin.end();
  const pixels = new Uint8Array(await new Response(convert.stdout).arrayBuffer());
  if ((await convert.exited) || pixels.length !== width * height) throw new Error("Wordmark raster conversion failed");
  const rows: string[] = [];
  for (let y = 0; y < height; y += 2) {
    let row = "";
    for (let x = 0; x < width; x++) {
      const top = pixels[y * width + x] >= 128;
      const bottom = pixels[(y + 1) * width + x] >= 128;
      row += top ? (bottom ? "█" : "▀") : bottom ? "▄" : " ";
    }
    rows.push(row.trimEnd());
  }
  result[String(width)] = rows;
}
await Bun.write(
  resolve(import.meta.dir, "../assets/brand/wordmark-cells.json"),
  JSON.stringify(result, null, 2) + "\n",
);

// Social cards use the same paths, centered on a dark 1200 × 630 canvas.
const geometry = (await Bun.file(source).text()).match(/<g[\s\S]*<\/g>/)![0].replace("#171717", "#fafafa");
const card =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#171717"/><g transform="translate(96.5 136.4) scale(1.9)">' +
  geometry +
  "</g></svg>";
const social = Bun.spawn(["rsvg-convert"], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
social.stdin.write(card);
social.stdin.end();
const image = await new Response(social.stdout).arrayBuffer();
if (await social.exited) throw new Error("Social logo render failed");
await Bun.write(resolve(import.meta.dir, "../assets/brand/bruv-social.png"), image);
