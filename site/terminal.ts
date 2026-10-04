import { Ghostty, Terminal } from "ghostty-web";
import { layout, hitAt, type State } from "./layout";
import { siteContent } from "./content";
const host = document.querySelector<HTMLElement>("#terminal")!;
const fallback = document.querySelector<HTMLElement>("#text-content")!;
const state: State = { route: location.hash.slice(1) || "overview", scroll: 0, focus: -1 };
async function start() {
  const ghostty = await Ghostty.load(new URL("./ghostty-vt.wasm", import.meta.url).href);
  const terminal = new Terminal({
    ghostty,
    cols: 80,
    rows: 24,
    fontSize: innerWidth < 600 ? 13 : 16,
    fontFamily: '"DejaVu Sans Mono", "Liberation Mono", monospace',
    scrollback: 0,
    disableStdin: true,
    theme: { background: "#101a16", foreground: "#d3ddd7", cursor: "#c2f278" },
  });
  host.hidden = false;
  terminal.open(host);
  terminal.write("\x1b[?1049h"); // A TUI viewport, not terminal scrollback.
  terminal.attachCustomWheelEventHandler(() => false);
  terminal.attachCustomKeyEventHandler(() => false);
  const canvas = terminal.renderer!.getCanvas();
  canvas.setAttribute("aria-hidden", "true");
  host.tabIndex = 0;
  host.contentEditable = "false";
  host.setAttribute("role", "region");
  host.setAttribute(
    "aria-label",
    "Bruv terminal website. Press A for the accessible HTML view. Tab and Enter navigate; arrow keys scroll.",
  );
  // No PTY, socket, command evaluator or onData transport. Only our static layout is written.
  terminal.textarea?.remove();
  let frame: ReturnType<typeof layout>;
  function render() {
    frame = layout(terminal.cols, terminal.rows, state);
    state.scroll = frame.scroll;
    terminal.write(frame.ansi);
    host.dataset.route = frame.route;
    host.dataset.scroll = String(frame.scroll);
    host.dataset.cols = String(terminal.cols);
    host.dataset.rows = String(terminal.rows);
    host.dataset.focus = frame.hits[state.focus]?.label || "";
  }
  function resize() {
    terminal.options.fontSize = innerWidth < 600 ? 13 : 16;
    const r = terminal.renderer!;
    const cols = Math.max(24, Math.floor(host.clientWidth / r.charWidth));
    const rows = Math.max(12, Math.floor(host.clientHeight / r.charHeight));
    terminal.resize(cols, rows);
    state.focus = -1;
    render();
  }
  function navigate(route: string) {
    if (location.hash === "#" + route) {
      state.scroll = 0;
      render();
    } else location.hash = route;
  }
  function activate(action: string) {
    if (action.startsWith("#")) navigate(action.slice(1));
    else if (action === "back") {
      if (history.length > 1) history.back();
      else navigate("overview");
    } else if (action === "up") {
      state.scroll -= Math.max(1, Math.floor(frame.visible / 2));
      render();
    } else if (action === "down") {
      state.scroll += Math.max(1, Math.floor(frame.visible / 2));
      render();
    } else if (action === "text") location.assign("./text.html#" + frame.route);
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
    moved = false;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") {
      touchY = e.clientY;
      moved = false;
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch" && touchY !== null) {
      const delta = touchY - e.clientY;
      if (Math.abs(delta) > terminal.renderer!.charHeight) {
        state.scroll += Math.trunc(delta / terminal.renderer!.charHeight);
        touchY = e.clientY;
        moved = true;
        render();
      }
      return;
    }
    const { x, y } = cell(e);
    const i = hitAt(frame.hits, x, y);
    canvas.style.cursor = i >= 0 ? "pointer" : "default";
    if (state.focus !== i) {
      state.focus = i;
      render();
    }
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
  host.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      state.scroll += Math.sign(e.deltaY) * 3;
      render();
    },
    { passive: false, capture: true },
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.target !== host && e.target !== document.body && !host.contains(e.target as Node)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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
      } else if (e.key === "Enter") {
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
      } else if (e.key === "Escape" || e.key === "Backspace") activate("back");
      else if (e.key === "a") activate("text");
      else if (e.key === "?") navigate("help");
      else if (/^[1-9]$/.test(e.key) && siteContent.pages[Number(e.key) - 1])
        navigate(siteContent.pages[Number(e.key) - 1].id);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  addEventListener("hashchange", () => {
    state.route = location.hash.slice(1);
    state.scroll = 0;
    state.focus = -1;
    render();
    requestAnimationFrame(() => host.focus({ preventScroll: true }));
  });
  new ResizeObserver(resize).observe(host);
  fallback.hidden = true;
  document.documentElement.classList.add("terminal-mode");
  resize();
  host.focus({ preventScroll: true });
  host.dataset.ready = "true";
}
start().catch((error) => {
  host.hidden = true;
  fallback.hidden = false;
  document.documentElement.classList.remove("terminal-mode");
  const notice = document.createElement("p");
  notice.textContent = "The terminal could not load. This HTML view has the same content and links.";
  fallback.prepend(notice);
  console.error(error);
});
