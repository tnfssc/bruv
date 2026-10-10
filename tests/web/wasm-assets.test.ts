import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { loadWebAssets } from "../../src/web/assets";

test("Bun file asset retains the pinned Ghostty 0.4.0 WASM", async () => {
  const assets = await loadWebAssets();
  const source = await Bun.file(new URL("../../node_modules/ghostty-web/ghostty-vt.wasm", import.meta.url)).bytes();
  expect(assets.wasm).toEqual(source);
  expect(assets.wasm.byteLength).toBe(423_045);
  expect(createHash("sha256").update(assets.wasm).digest("hex")).toBe(
    "d6f0326f1874ad2ce9f289e3a4a0c5f3507d4cb38d8747e4b287def470a0c60a",
  );
  expect(assets.javascript).toContain("/ghostty-vt.wasm");
  expect(assets.javascript).not.toContain(Buffer.from(source).toString("base64").slice(0, 256));
  expect(WebAssembly.validate(assets.wasm)).toBe(true);
  const module = await WebAssembly.compile(assets.wasm);
  expect(WebAssembly.Module.exports(module).some((entry) => entry.name === "ghostty_terminal_new")).toBe(true);
});
