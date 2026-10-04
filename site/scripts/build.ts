import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { siteContent, landing } from "../content";
import { demoIds, demoTranscript } from "../demos";
const escape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export function siteMetadata(raw?: string, page = "") {
  if (!raw) return { html: "", sitemap: "", robots: "" };
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("BASE_URL must be an HTTP(S) site URL, without credentials, query or fragment.");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  const base = escape(url.href);
  const canonical = escape(new URL(page, url).href);
  return {
    html: '<link rel="canonical" href="' + canonical + '"><meta property="og:url" content="' + canonical + '">',
    sitemap:
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' +
      base +
      "</loc></url><url><loc>" +
      escape(new URL("text.html", url).href) +
      "</loc></url></urlset>\n",
    robots: "User-agent: *\nAllow: /\nSitemap: " + new URL("sitemap.xml", url).href + "\n",
  };
}
export function textContent() {
  const cta = '<a href="' + siteContent.install + '">Install Bruv</a>';
  return (
    "<main><p>" +
    escape(landing.eyebrow) +
    "</p><h1>" +
    escape(landing.title + " " + landing.titleTail) +
    "</h1><p>" +
    escape(landing.intro) +
    "</p><p>" +
    cta +
    ' · <a href="' +
    siteContent.repository +
    '">Source</a></p>' +
    landing.features
      .map((f, i) => {
        const pre = escape(demoTranscript(demoIds[i]));
        return (
          "<section><h2>" +
          escape(f.title) +
          "</h2><p>" +
          escape(f.text) +
          "</p><figure><figcaption>" +
          "Animated demo · scripted. Static transcript; outcomes and timing are illustrative." +
          "</figcaption><pre>" +
          pre +
          "</pre></figure></section>"
        );
      })
      .join("") +
    "<section><h2>" +
    escape(landing.installTitle) +
    "</h2><p>" +
    escape(landing.installNote) +
    "</p><pre>" +
    escape(landing.start) +
    "</pre><p>" +
    escape(landing.requirements) +
    "</p>" +
    cta +
    "</section></main>" +
    '<footer><a href="./">Terminal view</a> · <a href="./licenses/ghostty-web.txt">Renderer license</a> · <a href="./licenses/vesper.txt">Vesper theme</a></footer>'
  );
}
export async function build(raw = process.env.BASE_URL) {
  const metadata = siteMetadata(raw);
  const root = resolve(import.meta.dir, ".."),
    out = resolve(root, "dist");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const template = await Bun.file(resolve(root, "index.html")).text();
  for (const plain of [false, true]) {
    const html = template
      .replace("<!-- META -->", plain ? siteMetadata(raw, "text.html").html : metadata.html)
      .replaceAll("<!-- DESCRIPTION -->", escape(siteContent.description))
      .replace("<!-- CONTENT -->", textContent())
      .replace("<!-- RUNTIME -->", plain ? "" : '<script type="module" src="./terminal.js"></script>')
      .replace(
        "<!-- SWITCH -->",
        plain
          ? '<p><a href="./">Open terminal view</a>. This text view contains the same website content.</p>'
          : '<p><a href="./text.html">Accessible HTML view</a>. The same content is available below while the terminal loads or if JavaScript is off.</p>',
      );
    await Bun.write(resolve(out, plain ? "text.html" : "index.html"), html);
  }
  const result = await Bun.build({
    entrypoints: [resolve(root, "terminal.ts")],
    outdir: out,
    target: "browser",
    format: "esm",
    minify: true,
  });
  if (!result.success) throw new AggregateError(result.logs, "Browser bundle failed");
  await cp(resolve(root, "styles.css"), resolve(out, "styles.css"));
  await mkdir(resolve(out, "assets"), { recursive: true });
  await cp(resolve(root, "assets/favicon.svg"), resolve(out, "assets/favicon.svg"));
  await cp(resolve(root, "assets/bruv-prompt.woff2"), resolve(out, "assets/bruv-prompt.woff2"));
  await cp(resolve(root, "node_modules/ghostty-web/ghostty-vt.wasm"), resolve(out, "ghostty-vt.wasm"));
  await cp(resolve(root, "licenses"), resolve(out, "licenses"), { recursive: true });
  if (metadata.sitemap) {
    await Bun.write(resolve(out, "sitemap.xml"), metadata.sitemap);
    await Bun.write(resolve(out, "robots.txt"), metadata.robots);
  }
  console.log(
    "Built self-contained terminal website in site/dist" +
      (raw ? " (" + raw + ")" : "; set BASE_URL for canonical/sitemap metadata."),
  );
}
if (import.meta.main) await build();
