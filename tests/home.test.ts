import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { covers, LOGO, paint, registerHome, screen } from "../src/home";
import { sdk } from "./sdk";

test.each(["tui", "rpc"] as const)(
  "logo shows on an empty chat and leaves with the first message (%s)",
  async (mode) => {
    initTheme("dark", false);
    let header: (Component & { dispose?: () => void }) | undefined;
    const overlays: Component[] = [];
    let hidden = 0;
    const tui = {
      showOverlay: (component: Component) => {
        overlays.push(component);
        return { hide: () => hidden++ };
      },
      requestRender() {},
    };
    const app = await sdk(
      [registerHome],
      {
        setHeader: (factory) => {
          header?.dispose?.();
          header = factory?.(tui as never, app.session.extensionRunner.createContext().ui.theme);
        },
      },
      undefined,
      mode,
    );
    try {
      await app.session.extensionRunner.emit({ type: "session_start", reason: "startup" });
      expect(overlays).toHaveLength(mode === "tui" ? 1 : 0);
      expect(header?.render(80) ?? []).toEqual([]);
      expect(overlays[0]?.render(80).map(visibleWidth) ?? []).toEqual(mode === "tui" ? LOGO.map(visibleWidth) : []);
      app.faux.setResponses([fauxAssistantMessage("hi")]);
      await app.session.prompt("go");
      expect(hidden).toBe(overlays.length);
      await app.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
      expect(overlays).toHaveLength(mode === "tui" ? 1 : 0);
    } finally {
      header?.dispose?.();
      await app.close();
    }
  },
);

test("logo rows keep their width wherever the light band is", async () => {
  initTheme("dark", false);
  const app = await sdk([]);
  try {
    const theme = app.session.extensionRunner.createContext().ui.theme;
    for (const band of [Number.NEGATIVE_INFINITY, -6, 0, 10, 40])
      for (const row of LOGO.keys()) expect(visibleWidth(paint(theme, row, band))).toBe(visibleWidth(LOGO[row]));
  } finally {
    await app.close();
  }
});

test("logo steps aside for anything drawn where it would be", () => {
  const blank = Array.from({ length: 10 }, () => "");
  expect(covers(blank, 100, 40)).toBe(false);
  // A widget down the middle of the screen, such as a QR code.
  const widget = Array.from({ length: 30 }, (_line, i) => (i > 5 ? "      \x1b[7m██████████\x1b[0m" : ""));
  expect(covers(widget, 60, 40)).toBe(true);
  // Text only at the top and bottom leaves its rows free.
  expect(covers(["header", ...Array.from({ length: 37 }, () => ""), "editor", "footer"], 100, 40)).toBe(false);
});

test("in full screen, the logo sees the chat above the input, as Pi lays it out", () => {
  const line = (text: string) => ({ render: () => [text], invalidate() {} });
  const chat = (rows: number) => ({
    render: () => Array.from({ length: rows }, (_row, i) => `${"x".repeat(80)} ${i}`),
    invalidate() {},
  });
  const fullScreen = (rows: number) => ({
    [Symbol.for("@earendil-works/pi-tui/viewport")]: true,
    children: [chat(rows), line(""), line("editor"), line("footer")],
    // Without a height, Pi's layout gives one chat row and the dock.
    render: () => ["", "", "editor", "footer"],
  });
  const lines = screen(fullScreen(16) as never, 100, 40);
  expect(lines).toHaveLength(40);
  expect(lines.at(-1)).toBe("footer");
  // The newest chat line (a notice) is where the logo would start.
  expect(covers(lines, 100, 40)).toBe(true);
  expect(covers(screen(fullScreen(15) as never, 100, 40), 100, 40)).toBe(false);
});
