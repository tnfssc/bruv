import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
export function siteMetadata(raw?: string) {
  if (!raw) return { html: "", sitemap: "", robots: "" };
  const url = new URL(raw);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("BASE_URL must be an HTTP(S) site URL, without credentials, query or fragment.");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  const escapeMarkup = (text: string) =>
    text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const base = escapeMarkup(url.href);
  const image = escapeMarkup(new URL("assets/social.png", url).href);
  return {
    html:
      '<link rel="canonical" href="' +
      base +
      '">\n  <meta property="og:url" content="' +
      base +
      '">\n  <meta property="og:image" content="' +
      image +
      '">\n  <meta property="og:image:width" content="1200">\n  <meta property="og:image:height" content="630">\n  <meta property="og:image:alt" content="Bruv: Big ideas. Small prompt. A coding agent for your terminal, with a labeled illustrative terminal.">\n  <meta name="twitter:image" content="' +
      image +
      '">\n  <meta name="twitter:image:alt" content="Bruv: A coding agent for your terminal. Illustrative terminal, not a live session.">',
    sitemap:
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' +
      base +
      "</loc></url></urlset>\n",
    robots: "User-agent: *\nAllow: /\nSitemap: " + new URL("sitemap.xml", url).href + "\n",
  };
}
export async function build(raw = process.env.BASE_URL) {
  const metadata = siteMetadata(raw); // Validate before touching an existing build.
  const root = resolve(import.meta.dir, "..");
  const out = resolve(root, "dist");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const html = (await Bun.file(resolve(root, "index.html")).text()).replace("<!-- SITE_META -->", metadata.html);
  await Bun.write(resolve(out, "index.html"), html);
  for (const file of ["styles.css", "demo.js", "assets"])
    await cp(resolve(root, file), resolve(out, file), { recursive: true });
  if (metadata.sitemap) {
    await Bun.write(resolve(out, "sitemap.xml"), metadata.sitemap);
    await Bun.write(resolve(out, "robots.txt"), metadata.robots);
  }
  console.log(
    "Built static files in site/dist" +
      (raw
        ? " with configured URL metadata."
        : "; canonical, sitemap and social image URLs omitted until BASE_URL is set."),
  );
}
if (import.meta.main) await build();
