import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { siteContent, landing } from "../content";
import { demoIds, demoTranscript, demoFrame, demoDuration } from "../demos";
import { INSTALL_COMMAND, INSTALL_SOURCE_URL } from "../install-command";
import { cellRowsHtml } from "../html-cells";
const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export function siteMetadata(raw?: string, page = "") {
  if (!raw) return { html: "", sitemap: "", robots: "" };
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("BASE_URL must be an HTTP(S) site URL, without credentials, query or fragment.");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  const base = escapeHtml(url.href);
  const canonical = escapeHtml(new URL(page, url).href);
  const image = escapeHtml(new URL("assets/brand/bruv-social.png", url).href);
  return {
    html:
      '<link rel="canonical" href="' +
      canonical +
      '"><meta property="og:url" content="' +
      canonical +
      '"><meta property="og:image" content="' +
      image +
      '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:type" content="image/png"><meta property="og:image:alt" content="bruv wordmark">',
    sitemap:
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' +
      base +
      "</loc></url><url><loc>" +
      escapeHtml(new URL("text.html", url).href) +
      "</loc></url></urlset>\n",
    robots: "User-agent: *\nAllow: /\nSitemap: " + new URL("sitemap.xml", url).href + "\n",
  };
}
export function textContent(animated = true) {
  const cta = '<a href="#install">Install bruv</a>';
  return (
    '<main><h1 class="brand-wordmark"><span class="sr-only">' +
    escapeHtml(landing.title) +
    '</span><img src="./assets/brand/bruv-wordmark-light.svg" width="530" height="188" alt="" aria-hidden="true"></h1><p>' +
    escapeHtml(landing.titleTail) +
    "</p><p>" +
    escapeHtml(landing.intro) +
    "</p><p>" +
    cta +
    ' · <a href="' +
    siteContent.repository +
    '">Source</a></p>' +
    landing.features
      .map((f, i) => {
        const id = demoIds[i];
        const transcript = '<pre class="demo-transcript">' + escapeHtml(demoTranscript(id)) + "</pre>";
        const visual = animated
          ? '<pre class="demo-screen" aria-hidden="true" hidden>' +
            cellRowsHtml(demoFrame(id, 68, demoDuration(id)).rows) +
            '</pre><button class="demo-toggle" type="button" aria-label="Pause ' +
            id +
            ' demo" hidden>Ⅱ</button>'
          : "";
        return (
          "<section><h2>" +
          escapeHtml(f.title) +
          "</h2><p>" +
          escapeHtml(f.text) +
          '</p><figure class="feature-demo" data-demo="' +
          id +
          '" data-label="' +
          id +
          '" aria-label="' +
          escapeHtml(f.title) +
          ' demo">' +
          transcript +
          visual +
          "</figure></section>"
        );
      })
      .join("") +
    '<section id="install"><h2>' +
    escapeHtml(landing.installTitle) +
    "</h2><p>" +
    escapeHtml(landing.installNote) +
    '</p><div class="install-command"><pre><code data-install-command>' +
    escapeHtml(INSTALL_COMMAND) +
    '</code></pre><button type="button" data-copy-install hidden aria-live="polite">Copy command</button><a href="' +
    INSTALL_SOURCE_URL +
    '">Script ↗</a> · <a href="' +
    siteContent.install +
    '">Source guide</a></div><pre>' +
    escapeHtml(landing.start) +
    "</pre><p>" +
    escapeHtml(landing.requirements) +
    "</p></section></main>" +
    '<footer><a href="./">Terminal view</a> · <a href="./licenses/ghostty-web.txt">Renderer license</a> · <a href="./licenses/vesper.txt">Vesper theme</a></footer>'
  );
}
function renderPage(template: string, metadata: string, view: "terminal" | "text") {
  const html = template
    .replace("<!-- META -->", metadata)
    .replaceAll("<!-- DESCRIPTION -->", escapeHtml(siteContent.description));
  if (view === "text") {
    return html
      .replace("<!-- BOOTSTRAP -->", "")
      .replace("<!-- CONTENT -->", textContent(true))
      .replace("<!-- ACCESSIBLE SWITCH -->", "")
      .replace(
        "<!-- RUNTIME -->",
        '<script type="module" src="./html-animation.js"></script><script type="module" src="./install-html.js"></script>',
      )
      .replace("<!-- SWITCH -->", '<nav aria-label="View"><p><a href="./">Terminal view</a></p></nav>');
  }
  return html
    .replace(
      "<!-- BOOTSTRAP -->",
      '<style>html{background:#101010}.terminal-pending #text-content{display:none}.terminal-pending{overflow:hidden}</style><script>document.documentElement.classList.add("terminal-pending")</script>',
    )
    .replace("<!-- CONTENT -->", textContent(false))
    .replace(
      "<!-- ACCESSIBLE SWITCH -->",
      '<nav aria-label="Accessible view"><a class="plain-switch" href="./text.html">Accessible HTML / text view</a></nav>',
    )
    .replace(
      "<!-- RUNTIME -->",
      '<script type="module">import("./terminal.js").catch(() => document.documentElement.classList.remove("terminal-pending"))</script>',
    )
    .replace("<!-- SWITCH -->", '<nav aria-label="View"><p><a href="./text.html">HTML view</a></p></nav>');
}
export async function build(raw = process.env.BASE_URL) {
  const metadata = siteMetadata(raw);
  const root = resolve(import.meta.dir, ".."),
    out = resolve(root, "dist");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const template = await Bun.file(resolve(root, "index.html")).text();
  await Bun.write(resolve(out, "index.html"), renderPage(template, metadata.html, "terminal"));
  await Bun.write(resolve(out, "text.html"), renderPage(template, siteMetadata(raw, "text.html").html, "text"));
  const result = await Bun.build({
    entrypoints: [resolve(root, "terminal.ts"), resolve(root, "html-animation.ts"), resolve(root, "install-html.ts")],
    outdir: out,
    target: "browser",
    format: "esm",
    minify: true,
  });
  if (!result.success) throw new AggregateError(result.logs, "Browser bundle failed");
  await cp(resolve(root, "styles.css"), resolve(out, "styles.css"));
  await mkdir(resolve(out, "assets"), { recursive: true });
  await cp(resolve(root, "assets/brand"), resolve(out, "assets/brand"), { recursive: true });
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
