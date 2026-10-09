import html from "../../dist/runtime-assets/web/index.html.asset" with { type: "file" };
import javascript from "../../dist/runtime-assets/web/terminal.js.asset" with { type: "file" };
import css from "../../dist/runtime-assets/web/terminal.css.asset" with { type: "file" };
import type { WebAssets } from "./server";

export async function loadWebAssets(): Promise<WebAssets> {
  return {
    html: await Bun.file(html).text(),
    javascript: await Bun.file(javascript).text(),
    css: await Bun.file(css).text(),
  };
}
