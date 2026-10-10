import { loadWebAssets } from "../../../src/web/assets";
import { startWebServer } from "../../../src/web/server";

const specimen = [
  "BRUV / BROWSER TERMINAL",
  "",
  "Regular Mono / text + Nerd icons",
  "",
  "\uf07b  src/web      \uf120  terminal",
  "\uf013  build        \ue0b0  main",
  "",
  "0123456789  ABCDEFGHIJKLMNOPQRST",
  "iiiiiiiiii  MMMMMMMMMMMMMMMMMMMM",
  "----------  --------------------",
  "",
  "\uf07b assets.ts    bundled bytes",
  "\uf07b browser.ts   font-ready fit",
  "\uf07b server.ts    same-origin URL",
  "\uf013 font.woff2   1,083,072 bytes",
  "",
  "Text and icons share one cell.",
  "No CDN. No runtime font download.",
  "",
  "Ready for keyboard input.",
];
const app = startWebServer({
  port: 0,
  assets: await loadWebAssets(),
  command: [
    process.env.FONT_TEST_BUN!,
    "-e",
    'process.stdin.setRawMode(true); const draw=()=>{process.stdout.write("\\x1b[H\\x1b[2J"); console.log(' +
      JSON.stringify(specimen.join("\r\n")) +
      '); console.log("SIZE "+process.stdout.columns+" "+process.stdout.rows)}; draw(); process.on("SIGWINCH",draw); process.stdin.on("data",d=>console.log("INPUT "+d.toString())); setInterval(()=>{},1000);',
  ],
});
console.log(app.url);
process.on("SIGTERM", async () => {
  await app.stop();
  process.exit(0);
});
