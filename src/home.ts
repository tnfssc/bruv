import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

// site/assets/bruv-wordmark.svg drawn in quarter blocks, 2 by 2 per cell.
export const LOGO = [
  "  ██▌                                       ",
  " ▐██▌                                       ",
  " ▟██▙▄▄▄▄▖   ▗▄▄▗▄▄▄▖ ▗▄▄   ▗▄▄▖ ▗▄▄▖   ▗▄▄▖",
  " ███▀▀▀▜██▙  ███████▌ ███   ███  ▝███  ▄██▛ ",
  "▐██▌    ███ ▗███▀    ▗██▌   ██▛   ▐██▙▟██▀  ",
  "▐██▙▄▄▄▟██▘ ▐██▌     ▐████████▘    █████▘   ",
  "███████▛▀   ▜██       ▝▜███▛▀      ▝██▛▘    ",
];
const WIDTH = LOGO[0].length;
const STEP_MS = 40;
const PAUSE_MS = 6000;
// The light band starts left of the logo and leaves past its right edge, slanted by row.
const START = -6;
const END = WIDTH + LOGO.length + 6;

type Color = "dim" | "muted" | "text";

/** One logo row with a light band at `band` (columns from the left, slanted down the rows). */
export function paint(theme: Theme, row: number, band: number): string {
  let out = "";
  let run = "";
  let color: Color | undefined;
  for (const [col, char] of [...LOGO[row]].entries()) {
    const distance = Math.abs(col + row - band);
    const next: Color | undefined = char === " " ? undefined : distance < 2 ? "text" : distance < 5 ? "muted" : "dim";
    if (next !== color) {
      out += color ? theme.fg(color, run) : run;
      run = "";
      color = next;
    }
    run += char;
  }
  return out + (color ? theme.fg(color, run) : run);
}

/** A big bruv in the middle of an empty chat, drawn behind the editor until the first message. */
export function registerHome(pi: ExtensionAPI) {
  const clear = (ctx: ExtensionContext) => {
    if (ctx.mode === "tui") ctx.ui.setHeader(() => ({ render: () => [], invalidate() {} }));
  };
  let shown = false;
  pi.on("session_start", (_event, ctx) => {
    shown = false;
    if (ctx.mode !== "tui") return;
    const empty = !ctx.sessionManager.getBranch().some((entry) => entry.type === "message");
    if (!empty) return clear(ctx);
    shown = true;
    ctx.ui.setHeader((tui, theme) => home(tui, theme));
  });
  pi.on("message_start", (_event, ctx) => {
    if (!shown) return;
    shown = false;
    clear(ctx);
  });
}

function home(tui: TUI, theme: Theme): Component & { dispose(): void } {
  let band = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const logo: Component = {
    render: () => LOGO.map((_line, row) => paint(theme, row, band)),
    invalidate() {},
  };
  const handle = tui.showOverlay(logo, {
    width: WIDTH,
    nonCapturing: true,
    offsetY: -1,
    visible: (width, height) => width >= WIDTH + 4 && height >= LOGO.length + 10,
  });
  const wait = (ms: number, then: () => void) => {
    timer = setTimeout(then, ms);
    timer.unref?.();
  };
  const step = () => {
    band = band === Number.NEGATIVE_INFINITY ? START : band + 1;
    if (band > END) band = Number.NEGATIVE_INFINITY;
    tui.requestRender();
    wait(band === Number.NEGATIVE_INFINITY ? PAUSE_MS : STEP_MS, step);
  };
  wait(400, step);
  return {
    render: () => [],
    invalidate() {},
    dispose() {
      clearTimeout(timer);
      handle.hide();
    },
  };
}
