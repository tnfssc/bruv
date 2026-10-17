import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, isViewportTUI, sliceByColumn, stripTerminalSequences, type TUI } from "@earendil-works/pi-tui";

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

/**
 * Whether the logo, centred on the screen one row up, would cover anything in `lines` (what is drawn under
 * it), such as a widget's QR code above the editor. Content starts at the top and scrolls once it is taller
 * than the screen, as Pi draws it.
 */
export function covers(lines: string[], width: number, height: number) {
  const top = Math.max(lines.length, height) - height;
  const row = Math.max(0, Math.min(Math.floor((height - LOGO.length) / 2) - 1, height - LOGO.length));
  const col = Math.max(0, Math.floor((width - WIDTH) / 2));
  return LOGO.some((_line, i) => {
    const line = lines[top + row + i];
    return line !== undefined && stripTerminalSequences(sliceByColumn(line, col, WIDTH)).trim() !== "";
  });
}

/**
 * What Pi draws under overlays, one line per row. Full-screen Pi mounts the chat first and the input dock
 * after it, and lays them out with the dock at the bottom and the chat above, scrolled to its end. Its
 * layout can't be asked for a whole frame, and without a height it renders only the dock and one chat row.
 */
export function screen(tui: TUI, width: number, height: number) {
  if (!isViewportTUI(tui)) return tui.render(width);
  const [chat = [], ...dock] = tui.children.map((child) => child.render(width));
  const below = dock.flat();
  const room = Math.max(0, height - below.length);
  const above = room ? chat.slice(-room) : [];
  return [...above, ...Array<string>(room - above.length).fill(""), ...below];
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
    // It steps aside for anything drawn where it would be, such as the voice QR code.
    visible: (width, height) =>
      width >= WIDTH + 4 && height >= LOGO.length + 10 && !covers(screen(tui, width, height), width, height),
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
