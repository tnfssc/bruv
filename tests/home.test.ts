import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { LOGO, paint, registerHome } from "../src/home";
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
