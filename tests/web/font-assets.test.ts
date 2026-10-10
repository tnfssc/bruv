import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { loadWebAssets } from "../../src/web/assets";

test("Bun file asset retains the exact regular Mono WOFF2 and same-origin face", async () => {
  const assets = await loadWebAssets();
  const source = await Bun.file(
    new URL("../../src/web/fonts/JetBrainsMonoNerdFontMono-Regular.woff2", import.meta.url),
  ).bytes();
  expect(assets.font).toEqual(source);
  expect(assets.font.byteLength).toBe(1_083_072);
  expect(new TextDecoder().decode(assets.font.slice(0, 4))).toBe("wOF2");
  expect(createHash("sha256").update(assets.font).digest("hex")).toBe(
    "2b777374f6ba42c46919fb5f8bb1f607ccff116bf54d44c7a453ebeb70b794a8",
  );
  expect(assets.css).toContain("@font-face");
  expect(assets.css).toContain('url("/fonts/JetBrainsMonoNerdFontMono-Regular.woff2")');
  expect(assets.javascript).toContain("JetBrainsMono Nerd Font Mono");
});
