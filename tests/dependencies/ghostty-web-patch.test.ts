import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const packageRoot = new URL("../../node_modules/ghostty-web/", import.meta.url);
const wasmPath = new URL("ghostty-vt.wasm", packageRoot).pathname;

// This patch handles DOM mouse buttons 0–2, wheel and pane focusin/focusout.
// Touch/pen gestures, extended buttons and window-only focus changes aren't
// mapped here. UTF-8 (1005), urxvt (1015) and pixel-SGR (1016) are unimplemented.
// Legacy coordinates cap at cell 223; SGR uses the full terminal geometry.
// Keep the fake DOM in a VM. Nothing changes the host's browser globals.
class Element {
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: Element[] = [];
  parentNode: Element | null = null;
  parentElement: Element | null = null;
  width = 0;
  height = 0;
  value = "";
  listeners: { type: string; callback: Function; capture: boolean }[] = [];
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  appendChild(child: Element) {
    this.children.push(child);
    child.parentNode = child.parentElement = this;
  }
  removeChild(child: Element) {
    this.children.splice(this.children.indexOf(child), 1);
    child.parentNode = child.parentElement = null;
  }
  addEventListener(type: string, callback: Function, options?: any) {
    this.listeners.push({ type, callback, capture: options === true || !!options?.capture });
  }
  removeEventListener(type: string, callback: Function, options?: any) {
    const capture = options === true || !!options?.capture;
    this.listeners = this.listeners.filter(
      (item) => item.type !== type || item.callback !== callback || item.capture !== capture,
    );
  }
  fire(type: string, event: any = {}) {
    let stopped = false;
    let immediate = false;
    Object.assign(event, {
      target: this,
      preventDefault: () => {
        event.defaultPrevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
      stopImmediatePropagation: () => {
        stopped = immediate = true;
      },
    });
    const path: Element[] = [];
    for (let node: Element | null = this; node; node = node.parentNode) path.push(node);
    const dispatch = (node: Element, capture: boolean) => {
      for (const item of [...node.listeners]) {
        if (item.type === type && item.capture === capture) item.callback(event);
        if (immediate) break;
      }
    };
    for (const node of [...path].reverse()) {
      dispatch(node, true);
      if (stopped) return event;
    }
    for (const node of path) {
      dispatch(node, false);
      if (stopped) return event;
    }
    return event;
  }
  focus() {}
  blur() {}
  contains(child: Element) {
    return child === this || this.children.includes(child);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 };
  }
  getContext() {
    return new Proxy(
      { measureText: () => ({ width: 8, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 3 }) },
      {
        get(target, key) {
          return (target as any)[key] ?? (() => {});
        },
      },
    );
  }
}

function harness(entry: string) {
  const document = Object.assign(new Element(), { createElement: () => new Element() });
  const exports = {};
  const context = createContext({
    Bun,
    WebAssembly,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    DataView,
    console,
    exports,
    module: { exports },
    document,
    navigator: { clipboard: { writeText: async () => {} } },
    window: { devicePixelRatio: 1, setTimeout, clearTimeout, setInterval, clearInterval },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    WheelEvent: { DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 },
  });
  let source = readFileSync(new URL(entry, packageRoot), "utf8");
  if (entry.endsWith(".js")) {
    source = source.replace(
      /export \{([\s\S]*?)\};\s*$/,
      (_, names) => "globalThis.pkg = {" + names.replace(/([\w$]+) as (\w+)/g, "$2: $1") + "};",
    );
  }
  runInContext(source, context);
  return { pkg: context.pkg ?? (exports as any), document, source, context };
}

function mouseEvent(term: any, col = 3, row = 2, extra = {}) {
  return {
    clientX: (col - 0.5) * term.renderer.charWidth,
    clientY: (row - 0.5) * term.renderer.charHeight,
    offsetX: (col - 0.5) * term.renderer.charWidth,
    offsetY: (row - 0.5) * term.renderer.charHeight,
    button: 0,
    buttons: 0,
    deltaMode: 1,
    deltaX: 0,
    deltaY: 0,
    ...extra,
  };
}

async function mouseHarness(entry: string, modes: number[]) {
  const { pkg, document } = harness(entry);
  const term = new pkg.Terminal({ ghostty: await pkg.Ghostty.load(wasmPath), cols: 120, rows: 40 });
  const host = new Element();
  document.appendChild(host);
  term.open(host);
  term.write("\x1b[?1049h" + modes.map((mode) => "\x1b[?" + mode + "h").join(""));
  const data: string[] = [];
  const binary: string[] = [];
  term.onData((value: string) => data.push(value));
  const subscription = term.onBinary((value: string) => binary.push(value));
  const canvas = host.children[0];
  return { term, host, canvas, document, data, binary, subscription };
}

for (const entry of ["dist/ghostty-web.js", "dist/ghostty-web.umd.cjs"]) {
  test(entry + " requires a WASM path and has no embedded default", async () => {
    const { pkg, source } = harness(entry);
    expect(source).not.toContain("data:application/wasm;base64,");
    await expect(pkg.Ghostty.load()).rejects.toThrow("explicit WASM path");
    await pkg.init(wasmPath);
    const term = new pkg.Terminal();
    term.dispose();
  });

  test(entry + " removes host and document listeners on dispose", async () => {
    const { pkg, document } = harness(entry);
    const ghostty = await pkg.Ghostty.load(wasmPath);
    const host = new Element();
    const term = new pkg.Terminal({ ghostty, cols: 10, rows: 4 });
    term.open(host);
    expect(host.listeners.some((item) => item.type === "beforeinput")).toBe(true);
    expect(host.listeners.some((item) => item.type === "wheel" && item.capture)).toBe(true);
    expect(document.listeners.filter((item) => item.type === "mouseup")).toHaveLength(2);
    expect(document.listeners.some((item) => item.type === "mousedown")).toBe(true);
    term.dispose();
    term.dispose();
    expect(host.listeners).toHaveLength(0);
    expect(document.listeners).toHaveLength(0);
    expect(host.children).toHaveLength(0);
    expect(term.wasmTerm).toBeUndefined();
  });

  test(entry + " cleans listeners after open fails at the render loop", async () => {
    const { pkg, document, context } = harness(entry);
    const term = new pkg.Terminal({ ghostty: await pkg.Ghostty.load(wasmPath) });
    const host = new Element();
    context.requestAnimationFrame = () => {
      throw new Error("render loop failed");
    };
    expect(() => term.open(host)).toThrow("render loop failed");
    expect(host.listeners).toHaveLength(0);
    expect(document.listeners).toHaveLength(0);
    expect(host.children).toHaveLength(0);
    term.dispose();
  });

  test(entry + " focuses now without reclaiming a later rename control", async () => {
    const { pkg, context } = harness(entry);
    const pending: (() => void)[] = [];
    context.setTimeout = (callback: () => void) => {
      pending.push(callback);
      return 1;
    };
    let focused = "";
    const host = new Element();
    host.focus = () => {
      focused = "terminal";
    };
    const term = new pkg.Terminal({ ghostty: await pkg.Ghostty.load(wasmPath) });
    term.open(host);
    term.focus();
    expect(focused).toBe("terminal");
    focused = "rename";
    for (const callback of pending) callback();
    expect(focused).toBe("rename");
    term.dispose();
  });

  test(entry + " explicit blur clears unfocused pane fractions without a focus-out report", async () => {
    const { pkg } = harness(entry);
    const term = new pkg.Terminal({ ghostty: await pkg.Ghostty.load(wasmPath) });
    const host = new Element();
    term.open(host);
    const data: string[] = [];
    term.onData((value: string) => data.push(value));
    const wheel = { deltaY: 0.6, deltaMode: 1, clientX: 10, clientY: 10 };
    term.write("\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[?1004h");
    host.fire("wheel", { ...wheel });
    term.blur();
    host.fire("wheel", { ...wheel });
    expect(data).toEqual([]);
    term.write("\x1b[?1000l");
    host.fire("wheel", { ...wheel });
    term.blur();
    host.fire("wheel", { ...wheel });
    expect(data).toEqual([]);
    term.dispose();
  });

  test(entry + " accumulates small alternate wheel deltas and accepts measured row input", async () => {
    const { pkg } = harness(entry);
    const term = new pkg.Terminal({ ghostty: await pkg.Ghostty.load(wasmPath) });
    const host = new Element();
    term.open(host);
    term.write("\x1b[?1049h");
    const data: string[] = [];
    term.onData((value: string) => data.push(value));
    const event = (deltaY: number, deltaMode: number) => ({
      deltaY,
      deltaMode,
      preventDefault() {},
      stopPropagation() {},
    });
    for (let i = 0; i < 20; i++) host.fire("wheel", event(10, 0));
    expect(data).toEqual(Array(Math.trunc(200 / term.renderer.charHeight)).fill("\x1b[B"));
    const before = data.length;
    host.fire("wheel", event(-3, 1));
    expect(data.slice(before)).toEqual(["\x1b[A", "\x1b[A"]);
    // Blur cancels a pane's fractional wheel movement before it can return.
    term.textarea.fire("blur", {});
    const canceled = data.length;
    host.fire("wheel", event(-2, 1));
    expect(data.slice(canceled)).toEqual(["\x1b[A", "\x1b[A"]);
    term.dispose();
  });

  test(entry + " keeps alternate-screen wheel input ASCII and gates disabled stdin", async () => {
    const { pkg } = harness(entry);
    const term = new pkg.Terminal({ ghostty: await pkg.Ghostty.load(wasmPath) });
    const host = new Element();
    term.open(host);
    term.write("\x1b[?1049h");
    const data: string[] = [];
    term.onData((value: string) => data.push(value));
    const wheel = { deltaY: 2, deltaMode: 1, preventDefault() {}, stopPropagation() {} };
    host.fire("wheel", wheel);
    expect(data).toEqual(["\x1b[B", "\x1b[B"]);
    term.options.disableStdin = true;
    host.fire("wheel", wheel);
    expect(data).toHaveLength(2);
    term.dispose();
  });
  test(entry + " reports Pi fullscreen SGR wheel, drag and focus instead of arrows", async () => {
    const { term, canvas, document, host, data, binary } = await mouseHarness(entry, [1000, 1002, 1004, 1006]);
    expect(term.hasMouseTracking()).toBe(true);
    for (const mode of [1000, 1002, 1004, 1006]) expect(term.getMode(mode)).toBe(true);
    canvas.fire("mousemove", mouseEvent(term));
    expect(data).toEqual([]);
    const down = canvas.fire("mousedown", mouseEvent(term, 3, 2, { altKey: true, ctrlKey: true }));
    expect(down.defaultPrevented).toBe(true);
    expect(term.selectionManager.isSelecting).toBe(false);
    canvas.fire("mousemove", mouseEvent(term, 4, 2, { buttons: 1 }));
    canvas.fire("mousemove", mouseEvent(term, 4, 2, { buttons: 1 }));
    document.fire("mousemove", mouseEvent(term, 125, 42, { buttons: 1 }));
    document.fire("mouseup", mouseEvent(term, 125, 42));
    canvas.fire("wheel", mouseEvent(term, 3, 2, { deltaY: 2 }));
    canvas.fire("wheel", mouseEvent(term, 3, 2, { deltaY: -1, deltaX: 1 }));
    // Focus moving between the host and its input textarea stays in the pane.
    host.fire("focusout", { relatedTarget: canvas });
    host.fire("focusin", { relatedTarget: canvas });
    host.fire("focusin");
    host.fire("focusout");
    expect(data).toEqual([
      "\x1b[<24;3;2M",
      "\x1b[<32;4;2M",
      "\x1b[<32;120;40M",
      "\x1b[<0;120;40m",
      "\x1b[<65;3;2M",
      "\x1b[<65;3;2M",
      "\x1b[<64;3;2M",
      "\x1b[<67;3;2M",
      "\x1b[I",
      "\x1b[O",
    ]);
    expect(binary).toEqual([]);
    term.dispose();
  });

  test(entry + " keeps native selection with no mouse mode and with Shift", async () => {
    const { term, canvas, document, data } = await mouseHarness(entry, []);
    term.write("hello");
    canvas.fire("mousedown", mouseEvent(term, 1, 1));
    expect(term.selectionManager.isSelecting).toBe(true);
    document.fire("mouseup", mouseEvent(term));
    term.write("\x1b[?1000;1002;1006h");
    canvas.fire("mousedown", mouseEvent(term, 1, 1, { shiftKey: true }));
    // Stock canvas input prevents browser text editing; its selection manager still owns the drag.
    expect(term.selectionManager.isSelecting).toBe(true);
    // Releasing Shift mid-drag must not hand the local selection to the app.
    canvas.fire("mousemove", mouseEvent(term, 4, 1, { buttons: 1 }));
    document.fire("mouseup", mouseEvent(term, 4, 1, { shiftKey: true }));
    expect(term.getSelection()).toBe("hell");
    canvas.fire("wheel", mouseEvent(term, 1, 1, { shiftKey: true, deltaY: 1 }));
    expect(data).toEqual([]);
    term.dispose();
  });

  test(entry + " uses only requested click and motion modes", async () => {
    const { term, canvas, document, data } = await mouseHarness(entry, [1000, 1006]);
    canvas.fire("mousedown", mouseEvent(term, 3, 2, { button: 2 }));
    canvas.fire("mousemove", mouseEvent(term, 4, 2, { buttons: 2 }));
    document.fire("mouseup", mouseEvent(term, 4, 2, { button: 2 }));
    expect(data.splice(0)).toEqual(["\x1b[<2;3;2M", "\x1b[<2;4;2m"]);
    term.write("\x1b[?1003h");
    canvas.fire("mousemove", mouseEvent(term, 3, 2));
    canvas.fire("mousemove", mouseEvent(term, 3, 2));
    expect(data.splice(0)).toEqual(["\x1b[<35;3;2M"]);
    term.write("\x1b[?1000;1003l\x1b[?9h");
    canvas.fire("mousedown", mouseEvent(term));
    document.fire("mouseup", mouseEvent(term));
    canvas.fire("wheel", mouseEvent(term, 3, 2, { deltaY: 1 }));
    expect(data).toEqual(["\x1b[<0;3;2M"]);
    term.dispose();
  });

  test(entry + " sends legacy high bytes only through disposable onBinary", async () => {
    const { term, canvas, document, data, binary, subscription } = await mouseHarness(entry, [1000]);
    canvas.fire("mousedown", mouseEvent(term, 100, 30));
    document.fire("mouseup", mouseEvent(term, 100, 30));
    canvas.fire("wheel", mouseEvent(term, 100, 30, { deltaY: -1 }));
    expect(binary.map((value) => [...value].map((char) => char.charCodeAt(0)))).toEqual([
      [27, 91, 77, 32, 132, 62],
      [27, 91, 77, 35, 132, 62],
      [27, 91, 77, 96, 132, 62],
    ]);
    expect(data).toEqual([]);
    subscription.dispose();
    canvas.fire("wheel", mouseEvent(term, 100, 30, { deltaY: 1 }));
    expect(binary).toHaveLength(3);
    term.dispose();
  });

  test(entry + " accumulates pixel wheel cells and gates all disabled input", async () => {
    const { term, host, canvas, document, data, binary } = await mouseHarness(entry, [1002, 1004, 1006]);
    const pixel = mouseEvent(term, 3, 2, { deltaMode: 0, deltaY: term.renderer.charHeight / 2 });
    canvas.fire("wheel", { ...pixel });
    expect(data).toEqual([]);
    canvas.fire("wheel", { ...pixel });
    expect(data.splice(0)).toEqual(["\x1b[<65;3;2M"]);
    term.options.disableStdin = true;
    canvas.fire("mousedown", mouseEvent(term));
    canvas.fire("mousemove", mouseEvent(term, 4, 2, { buttons: 1 }));
    document.fire("mouseup", mouseEvent(term));
    canvas.fire("wheel", mouseEvent(term, 3, 2, { deltaY: 1 }));
    host.fire("focusin");
    host.fire("focusout");
    term.write("\x1b[?1006l");
    canvas.fire("wheel", mouseEvent(term, 3, 2, { deltaY: 1 }));
    expect(data).toEqual([]);
    expect(binary).toEqual([]);
    term.options.disableStdin = false;
    document.fire("mouseup", mouseEvent(term));
    expect(binary).toEqual([]);
    term.dispose();
  });

  test(entry + " does not invent a fallback for unsupported mouse encodings", async () => {
    const { term, canvas, document, data, binary } = await mouseHarness(entry, [1000]);
    // The pinned WASM recognizes each flag. The package input seam deliberately
    // does not implement UTF-8, urxvt or pixel-SGR. It consumes, but emits nothing.
    for (const mode of [1005, 1015, 1016]) {
      term.write("\x1b[?" + mode + "h");
      expect(term.getMode(mode)).toBe(true);
      canvas.fire("mousedown", mouseEvent(term));
      document.fire("mouseup", mouseEvent(term));
      canvas.fire("wheel", mouseEvent(term, 3, 2, { deltaY: 1 }));
      term.write("\x1b[?" + mode + "l");
    }
    expect(data).toEqual([]);
    expect(binary).toEqual([]);
    term.dispose();
  });
}
