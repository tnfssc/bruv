import { describe, expect, test } from "bun:test";
import { siteMetadata } from "./build";
describe("configurable deployment metadata", () => {
  test("does not invent a production URL", () => {
    expect(siteMetadata()).toEqual({ html: "", sitemap: "", robots: "" });
  });
  test("uses the configured subpath for canonical, social image and sitemap", () => {
    const metadata = siteMetadata("https://example.test/bruv");
    expect(metadata.html).toContain('href="https://example.test/bruv/"');
    expect(metadata.html).toContain('content="https://example.test/bruv/assets/social.png"');
    expect(metadata.html).toContain('content="1200"');
    expect(metadata.sitemap).toContain("<loc>https://example.test/bruv/</loc>");
    expect(metadata.robots).toBe("User-agent: *\nAllow: /\nSitemap: https://example.test/bruv/sitemap.xml\n");
  });
  test("rejects credentials, non-web schemes and ambiguous page URLs", () => {
    for (const raw of [
      "file:///tmp/site",
      "javascript:alert(1)",
      "https://user:pass@example.test",
      "https://example.test/?preview=1",
      "https://example.test/#demo",
    ])
      expect(() => siteMetadata(raw)).toThrow();
  });
});
