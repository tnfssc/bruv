import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { siteContent } from "../content";
import { captures } from "../gallery";
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
function textContent() {
  return (
    "<header><h1>" +
    escape(siteContent.name) +
    "</h1><p>" +
    escape(siteContent.description) +
    '</p><nav aria-label="Pages">' +
    siteContent.pages.map((p) => '<a href="#' + escape(p.id) + '">' + escape(p.title) + "</a>").join(" ") +
    "</nav></header><main>" +
    siteContent.pages
      .map(
        (p) =>
          '<section id="' +
          escape(p.id) +
          '"><h2>' +
          escape(p.title) +
          "</h2>" +
          p.paragraphs
            .map((t) =>
              t === siteContent.installCommand
                ? "<pre><code>" + escape(t) + "</code></pre>"
                : "<p>" + escape(t) + "</p>",
            )
            .join("") +
          "<ul>" +
          p.links.map((l) => '<li><a href="' + escape(l.href) + '">' + escape(l.label) + "</a></li>").join("") +
          "</ul></section>",
      )
      .join("") +
    '</main><footer>Static website. No shell commands run here. <a href="./">Open terminal view</a> · <a href="./licenses/ghostty-web.txt">Renderer license</a></footer>'
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
  await mkdir(resolve(out, "shots"), { recursive: true });
  for (const capture of captures) {
    const html =
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
      escape(capture.title) +
      ' — Bruv CLI</title><meta name="description" content="' +
      escape(capture.caption) +
      '"><link rel="stylesheet" href="../styles.css"></head><body><main id="text-content" style="max-width:1200px"><nav><a href="../#gallery">Back to terminal gallery</a><a href="../text.html#gallery">HTML gallery</a></nav><h1>' +
      escape(capture.title) +
      "</h1><p>" +
      escape(capture.caption) +
      '</p><a href="../assets/' +
      capture.file +
      '"><img src="../assets/' +
      capture.file +
      '" width="' +
      capture.width +
      '" height="' +
      capture.height +
      '" alt="' +
      escape(capture.caption) +
      '"></a><p><a href="../assets/' +
      capture.file +
      '">Original PNG</a> · <a href="../assets/' +
      capture.transcript +
      '">Full captured terminal transcript</a> · <a href="../assets/cli-captures.md">Capture provenance</a></p><p>The transcript may contain terminal escape sequences. These images show local settings and help, not a connected coding session.</p></main></body></html>';
    await Bun.write(resolve(out, "shots", capture.id + ".html"), html);
  }
  const result = await Bun.build({
    entrypoints: [resolve(root, "terminal.ts")],
    outdir: out,
    target: "browser",
    format: "esm",
    minify: true,
  });
  if (!result.success) throw new AggregateError(result.logs, "Browser bundle failed");
  for (const file of ["styles.css", "assets"]) await cp(resolve(root, file), resolve(out, file), { recursive: true });
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
