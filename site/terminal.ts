import { Ghostty, Terminal } from "ghostty-web";
import { layout, hitAt, type State } from "./layout";
import { INSTALL_SOURCE_URL, INSTALL_COMMAND, copyCommand, enhanceInstall } from "./install-command";
import { CellScroll, wheelPixels } from "./scroll";
import { demoIds, demoDuration, type DemoId } from "./demos";
import { advance, inView } from "./playback";
enhanceInstall();
const host = document.querySelector<HTMLElement>("#terminal")!;
const fallback = document.querySelector<HTMLElement>("#text-content")!;
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const state: State = {
  scroll: 0,
  focus: -1,
  installUrl: INSTALL_SOURCE_URL,
  installCommand: INSTALL_COMMAND,
  demos: Object.fromEntries(
    demoIds.map((id) => [id, { elapsed: motion.matches ? demoDuration(id) : 0, paused: motion.matches }]),
  ) as NonNullable<State["demos"]>,
};
async function start() {
  await document.fonts.load('16px "Bruv Prompt"', "\uf460");
  const ghostty = await Ghostty.load(new URL("./ghostty-vt.wasm", import.meta.url).href);
  const terminal = new Terminal({
    ghostty,
    cols: 80,
    rows: 24,
    fontSize: innerWidth < 600 ? 14 : 16,
    fontFamily: '"Bruv Prompt", "DejaVu Sans Mono", "Liberation Mono", monospace',
    scrollback: 0,
    disableStdin: true,
    theme: { background: "#101010", foreground: "#ffffff", cursor: "#ffc799" },
  });
  host.hidden = false;
  terminal.open(host);
  terminal.write("\x1b[?1049h"); // A TUI viewport, not terminal scrollback.
  terminal.attachCustomWheelEventHandler(() => true);
  terminal.attachCustomKeyEventHandler(() => false);
  const canvas = terminal.renderer!.getCanvas();
  canvas.classList.add("ghostty-cells");
  canvas.setAttribute("aria-hidden", "true");
  host.tabIndex = 0;
  host.contentEditable = "false";
  host.setAttribute("role", "region");
  host.setAttribute(
    "aria-label",
    "bruv terminal website with scripted animated demos. Press A for HTML and full transcripts. Tab and Enter operate links and demo playback. Arrow keys scroll.",
  );
  // No PTY, socket, command evaluator or onData transport. Only our static layout is written.
  terminal.textarea?.remove();
  let frame: ReturnType<typeof layout>;
  const scrollInput = new CellScroll();
  let pendingFrame = 0;
  let needsResize = false;
  let previousRows: string[] = [];
  let clock = performance.now();
  let animationTimer: ReturnType<typeof setTimeout> | undefined;
  const announcement = document.createElement("span");
  announcement.className = "sr-only";
  announcement.setAttribute("aria-live", "polite");
  host.after(announcement);
  let lastFocus = "";
  const visibleDemo = (capture: ReturnType<typeof layout>["captures"][number]) =>
    state.demos![capture.id].started
      ? capture.y < frame.clip.bottom && capture.y + capture.rows.length > frame.clip.top
      : inView(capture.y, capture.rows.length, frame.clip.top, frame.clip.bottom);
  function render() {
    if (!pendingFrame) pendingFrame = requestAnimationFrame(paint);
  }
  function paint() {
    pendingFrame = 0;
    clearTimeout(animationTimer);
    const now = performance.now();
    if (frame && !document.hidden) {
      for (const capture of frame.captures)
        advance(state.demos![capture.id], now - clock, demoDuration(capture.id), visibleDemo(capture));
    }
    clock = now;
    if (needsResize) {
      needsResize = false;
      terminal.options.fontSize = innerWidth < 600 ? 14 : 16;
      const r = terminal.renderer!;
      terminal.resize(
        Math.max(24, Math.floor(host.clientWidth / r.charWidth)),
        Math.max(12, Math.floor(host.clientHeight / r.charHeight)),
      );
      previousRows = [];
      scrollInput.reset();
      state.focus = -1;
    }
    frame = layout(terminal.cols, terminal.rows, state);
    state.scroll = frame.scroll;
    const changedRows = frame.ansiRows.filter((row, i) => row !== previousRows[i]);
    if (changedRows.length) {
      terminal.write("\x1b[?25l\x1b[?7l" + changedRows.join("") + "\x1b[0m");
      // Ghostty 0.4 writes WASM synchronously, but its normal canvas paint is a
      // separate RAF. Paint its public renderer here so the complete grid reaches
      // the same browser frame. Its own loop then sees clean rows.
      // A full canvas pass avoids Ghostty dirty-row box-glyph join gaps. ANSI
      // parsing stays row-diffed; there is still only one paint per changed frame.
      terminal.renderer!.render(terminal.wasmTerm!, true);
    }
    previousRows = frame.ansiRows;
    host.dataset.scroll = String(frame.scroll);
    host.dataset.installCommand = state.installCommand;
    host.dataset.installUrl = state.installUrl;
    host.dataset.cols = String(terminal.cols);
    host.dataset.rows = String(terminal.rows);
    host.dataset.focus = frame.hits[state.focus]?.label || "";
    host.dataset.cellWidth = String(terminal.renderer!.charWidth);
    host.dataset.cellHeight = String(terminal.renderer!.charHeight);
    host.dataset.demos = JSON.stringify(state.demos);
    if (host.dataset.focus !== lastFocus) {
      lastFocus = host.dataset.focus || "";
      announcement.textContent = lastFocus ? lastFocus + ". Press Enter to activate." : "";
    }
    if (!document.hidden && frame.captures.some((c) => visibleDemo(c) && !state.demos![c.id].paused))
      animationTimer = setTimeout(render, 80);
  }
  document.addEventListener("visibilitychange", () => {
    clearTimeout(animationTimer);
    clock = performance.now();
    if (!document.hidden) render();
  });
  motion.addEventListener("change", () => {
    if (motion.matches)
      for (const id of demoIds) {
        state.demos![id].paused = true;
        state.demos![id].elapsed = demoDuration(id);
        state.demos![id].started = false;
      }
    render();
  });
  function resize() {
    needsResize = true;
    render();
  }
  let copyTimer: ReturnType<typeof setTimeout>;
  function activate(action: string) {
    scrollInput.reset();
    if (action === "install") {
      state.scroll = frame.maxScroll;
      state.focus = -1;
      render();
    } else if (action === "copy-install") {
      copyCommand(state.installCommand!)
        .then(() => {
          state.copyLabel = "Copied";
          announcement.textContent = "Install command copied.";
          render();
        })
        .catch(() => {
          state.copyLabel = "Copy in HTML";
          announcement.textContent = "Open HTML view to select the command.";
          render();
        })
        .finally(() => {
          clearTimeout(copyTimer);
          copyTimer = setTimeout(() => {
            state.copyLabel = undefined;
            render();
          }, 1800);
        });
    } else if (action.startsWith("demo:")) {
      const [, id] = action.split(":") as [string, DemoId];
      const playback = state.demos![id];
      if (playback.paused && !playback.started) {
        playback.elapsed = 0;
        playback.paused = false;
      } else playback.paused = !playback.paused;
      playback.started = true;
      clock = performance.now();
      announcement.textContent = id + " demo " + (playback.paused ? "paused" : "playing") + ".";
      render();
    } else if (action === "text") location.assign("./text.html");
    else location.assign(action);
  }
  function cell(e: { clientX: number; clientY: number }) {
    const rect = canvas.getBoundingClientRect();
    // CSS pixels and measured renderer cells, not device-pixel canvas dimensions.
    return {
      x: Math.floor((e.clientX - rect.left) / terminal.renderer!.charWidth),
      y: Math.floor((e.clientY - rect.top) / terminal.renderer!.charHeight),
    };
  }
  let touchY: number | null = null,
    touchDistance = 0,
    moved = false;
  function scrollPixels(pixels: number) {
    const next = scrollInput.move(state.scroll, pixels, terminal.renderer!.charHeight, frame.maxScroll);
    if (next !== state.scroll) {
      state.scroll = next;
      render();
    }
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") {
      touchY = e.clientY;
      touchDistance = 0;
      scrollInput.reset();
      moved = false;
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch" && touchY !== null) {
      const delta = touchY - e.clientY;
      touchY = e.clientY;
      touchDistance += Math.abs(delta);
      if (touchDistance > 4) moved = true;
      scrollPixels(delta);
      return;
    }
    const { x, y } = cell(e);
    const i = hitAt(frame.hits, x, y);
    canvas.style.cursor = i >= 0 ? "pointer" : "default";
    const hover =
      i >= 0 && frame.hits[i].action.startsWith("demo:") ? (frame.hits[i].action.split(":")[1] as DemoId) : undefined;
    if (state.hover !== hover) {
      state.hover = hover;
      render();
    }
  });
  canvas.addEventListener("pointerleave", () => {
    state.hover = undefined;
    render();
  });
  canvas.addEventListener("pointerup", (e) => {
    touchY = null;
    if (e.pointerType === "touch") {
      e.preventDefault();
      if (!moved) {
        const { x, y } = cell(e);
        const i = hitAt(frame.hits, x, y);
        if (i >= 0) {
          state.focus = i;
          state.hover = frame.hits[i].action.startsWith("demo:")
            ? (frame.hits[i].action.split(":")[1] as DemoId)
            : undefined;
          activate(frame.hits[i].action);
        }
      }
      moved = false;
    }
  });
  canvas.addEventListener("pointercancel", () => {
    touchY = null;
    moved = false;
  });
  canvas.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      host.focus({ preventScroll: true });
      if ((e as PointerEvent).pointerType === "touch") return;
      if (moved) {
        moved = false;
        return;
      }
      const { x, y } = cell(e);
      const index = hitAt(frame.hits, x, y);
      if (index >= 0) {
        state.focus = index;
        activate(frame.hits[index].action);
      }
    },
    true,
  );
  // Ghostty also listens in capture on the host. Own input one level earlier
  // so it cannot generate terminal scroll events or cancel browser pinch zoom.
  document.addEventListener(
    "wheel",
    (e) => {
      if (!host.contains(e.target as Node)) return;
      if (e.ctrlKey) {
        // Skip Ghostty's own cancelling wheel listener, but keep browser zoom.
        e.stopImmediatePropagation();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      scrollPixels(wheelPixels(e.deltaY, e.deltaMode, terminal.renderer!.charHeight, frame.visible));
    },
    { passive: false, capture: true },
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.target !== host && e.target !== document.body && !host.contains(e.target as Node)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      scrollInput.reset();
      let handled = true;
      if (e.key === "Tab") {
        const next = state.focus + (e.shiftKey ? -1 : 1);
        if (next < 0 || next >= frame.hits.length) {
          state.focus = -1;
          render();
          document.querySelector<HTMLAnchorElement>(".plain-switch")!.focus();
        } else {
          state.focus = next;
          render();
        }
      } else if (
        e.key === "Enter" ||
        (e.key === " " &&
          (frame.hits[state.focus]?.action.startsWith("demo:") || frame.hits[state.focus]?.action === "copy-install"))
      ) {
        if (frame.hits[state.focus]) activate(frame.hits[state.focus].action);
      } else if (e.key === "ArrowDown" || e.key === "j") {
        state.scroll++;
        render();
      } else if (e.key === "ArrowUp" || e.key === "k") {
        state.scroll--;
        render();
      } else if (e.key === "PageDown" || e.key === " ") {
        state.scroll += frame.visible;
        render();
      } else if (e.key === "PageUp") {
        state.scroll -= frame.visible;
        render();
      } else if (e.key === "Home") {
        state.scroll = 0;
        render();
      } else if (e.key === "End") {
        state.scroll = frame.maxScroll;
        render();
      } else if (e.key === "Escape" || e.key === "a") activate("text");
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  new ResizeObserver(resize).observe(host);
  fallback.hidden = true;
  document.documentElement.classList.add("terminal-mode");
  resize();
  cancelAnimationFrame(pendingFrame);
  paint();
  host.focus({ preventScroll: true });
  host.dataset.ready = "true";
  document.documentElement.classList.remove("terminal-pending");
}
start().catch((error) => {
  host.hidden = true;
  fallback.hidden = false;
  document.documentElement.classList.remove("terminal-mode", "terminal-pending");
  const notice = document.createElement("p");
  notice.textContent = "The terminal could not load. This HTML view has the same content and links.";
  fallback.prepend(notice);
  console.error(error);
});
