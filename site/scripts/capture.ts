import { resolve } from "node:path";
import { launchBrowser } from "./browser";
const root = resolve(import.meta.dir, "..");
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 2200 }, deviceScaleFactor: 1 });
  await page.goto(new URL("../fixtures/captures.html", import.meta.url).href);
  await page.evaluate(() => document.fonts.ready);
  for (const name of ["delegation", "wisdom", "social"]) {
    await page.locator("#" + name).screenshot({ path: resolve(root, "assets", name + ".png"), animations: "disabled" });
    console.log("Captured illustrative asset:", name);
  }
} finally {
  await browser.close();
}
