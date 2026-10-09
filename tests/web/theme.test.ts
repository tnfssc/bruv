import { expect, test } from "bun:test";
import vesper from "../../src/web/vesper.json";
import schema from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json";

test("web Vesper covers the TUI theme tokens without native default changes", () => {
  expect(Object.keys(vesper.colors).sort()).toEqual(Object.keys(schema.properties.colors.properties).sort());
  expect(vesper.name).toBe("bruv-web-vesper");
  expect(vesper.colors.accent).toBe("#ffc799");
  expect(vesper.colors.text).toBe("#ffffff");
  for (const color of Object.values(vesper.colors)) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  for (const key of ["userMessageBg", "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg"] as const)
    expect(vesper.colors[key]).toBe("#000000");
});

test("browser chrome keeps a black page and warm, visible focus", async () => {
  const css = await Bun.file(new URL("../../src/web/browser.css", import.meta.url)).text();
  expect(css).toContain("--terminal: #000000;");
  expect(css).toContain("--surface: #000000;");
  expect(css).toContain("--accent: #ffc799;");
  expect(css).toContain("outline: 2px solid var(--accent)");
});
