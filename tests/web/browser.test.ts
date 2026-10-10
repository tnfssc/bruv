import { expect, test } from "bun:test";
import { CellFlags } from "ghostty-web";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

// Exercise the browser entry point without a server or devices. The parent
// integration checks use the real renderer, sockets and two browser windows.
const source = new Bun.Transpiler({ loader: "ts" }).transformSync(
  readFileSync(new URL("../../src/web/browser.ts", import.meta.url), "utf8").replace(/^import .*;\n/gm, ""),
);
const touchSource = new Bun.Transpiler({ loader: "ts" }).transformSync(
  readFileSync(new URL("../../src/web/browser-terminal-touch.ts", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace("export function", "function"),
);
const accessibilitySource = new Bun.Transpiler({ loader: "ts" }).transformSync(
  readFileSync(new URL("../../src/web/browser-terminal-accessibility.ts", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replaceAll("export function", "function"),
);

class Element {
  hidden = false;
  inert = false;
  disabled = false;
  textContent = "";
  set innerHTML(html: string) {
    this.replaceChildren();
    for (const match of html.matchAll(/<([a-z]+)(?: class="([^"]+)")?>/g)) {
      this.append(Object.assign(new Element(), { tagName: match[1].toUpperCase(), className: match[2] ?? "" }));
    }
  }
  children: Element[] = [];
  attributes: Record<string, string> = {};
  listeners = new Map<string, { listener: (event: any) => any; capture: boolean }[]>();
  tagName = "DIV";
  clientWidth = 1000;
  clientHeight = 600;
  scrollLeft = 0;
  scrollWidth = 1000;
  id = "";
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
  }
  style: Record<string, string> = {};
  getBoundingClientRect() {
    return { left: 0, right: this.clientWidth, width: this.clientWidth };
  }
  removeAttribute(key: string) {
    delete this.attributes[key];
  }
  setSelectionRange() {}
  get lastElementChild(): Element | null {
    return this.children.at(-1) ?? null;
  }
  parentElement: Element | null = null;
  get isConnected() {
    return this.parentElement !== null;
  }
  className = "";
  classList = { contains: (name: string) => this.className.split(" ").includes(name) };
  onFocus?: () => void;
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  append(...elements: Element[]) {
    for (const element of elements) this.insertBefore(element, null);
  }
  insertBefore(element: Element, before: Element | null) {
    element.remove();
    element.parentElement = this;
    const index = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(index, 0, element);
  }
  replaceWith(element: Element) {
    const parent = this.parentElement!;
    parent.insertBefore(element, this);
    this.remove();
  }
  replaceChildren() {
    this.children = [];
  }
  addEventListener(type: string, listener: (event: any) => any, options?: boolean | { capture?: boolean }) {
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), { listener, capture }]);
  }
  removeEventListener(type: string, listener: (event: any) => any) {
    const remaining = (this.listeners.get(type) ?? []).filter((entry) => entry.listener !== listener);
    if (remaining.length) this.listeners.set(type, remaining);
    else this.listeners.delete(type);
  }
  fire(type: string, event: any = {}) {
    let stopped = false;
    event.stopImmediatePropagation = () => {
      stopped = true;
    };
    event.stopPropagation = () => {
      stopped = true;
    };
    event.preventDefault ??= () => {};
    let result: any;
    if (type === "touchend") {
      const ancestors: Element[] = [];
      for (let parent = this.parentElement; parent; parent = parent.parentElement) ancestors.unshift(parent);
      for (const ancestor of ancestors) {
        for (const { listener, capture } of ancestor.listeners.get(type) ?? []) {
          // The pane capture guard runs before Ghostty's canvas target listener.
          if (capture) listener(event);
          if (stopped) return result;
        }
      }
    }
    for (const { listener } of [...(this.listeners.get(type) ?? [])].sort(
      (a, b) => Number(b.capture) - Number(a.capture),
    )) {
      result = listener(event);
      if (stopped) break;
    }
    return result;
  }
  querySelector(selector: string): Element | null {
    for (const child of this.children) {
      if (
        selector.startsWith(".")
          ? child.classList.contains(selector.slice(1))
          : child.tagName === selector.toUpperCase()
      )
        return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  querySelectorAll() {
    return this.children;
  }
  value = "";
  required = false;
  returnValue = "";
  open = false;
  showModal() {
    this.open = true;
  }
  close(value = "") {
    this.open = false;
    this.returnValue = value;
    this.fire("close");
  }
  select() {}
  scrollIntoView() {}
  click() {
    this.fire("click");
  }
  focus() {
    this.onFocus?.();
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
}
async function browser(
  device?: (options: any) => Promise<{ close(): Promise<void> }>,
  hash = "#token=secret",
  loading: { fonts?: Promise<void>; wasm?: Promise<void> } = {},
) {
  const nodes = new Map<string, Element>();
  const node = (id: string) => {
    if (!nodes.has(id)) {
      const element = new Element();
      element.id = id;
      if (id === "empty-terminal") {
        for (const tagName of ["H1", "P"]) element.append(Object.assign(new Element(), { tagName }));
      }
      element.onFocus = () => {
        document.activeElement = element;
      };
      nodes.set(id, element);
    }
    return nodes.get(id)!;
  };
  const startup: string[] = [];
  const ghostty = {};
  const Ghostty = {
    async load(path: string) {
      startup.push("wasm:" + path);
      await loading.wasm;
      return ghostty;
    },
  };
  const terminals: any[] = [];
  class Terminal {
    cols = 80;
    rows = 24;
    disposed = false;
    writes: Uint8Array[] = [];
    options: any;
    element?: Element;
    renderListeners = new Set<(event: any) => void>();
    scrollListeners = new Set<(event: any) => void>();
    resizeListeners = new Set<(event: any) => void>();
    constructor(options: any) {
      this.options = options;
      terminals.push(this);
    }
    loadAddon(addon: any) {
      addon.activate?.(this);
    }
    screen: string[] = [];
    buffer = {
      active: {
        type: "normal",
        viewportY: 0,
        getLine: (row: number) =>
          this.screen[row] === undefined
            ? undefined
            : {
                translateToString: (trimRight: boolean) => (trimRight ? this.screen[row].trimEnd() : this.screen[row]),
              },
      },
    };
    wasmTerm = {
      getScrollbackLength: () => Math.max(0, this.screen.length - this.rows),
      getScrollbackLine: (row: number) => this.cells(this.screen[row]),
      getLine: (row: number) => this.cells(this.screen[Math.max(0, this.screen.length - this.rows) + row]),
    };
    cells(line?: string) {
      return line === undefined
        ? null
        : Array.from(line, (char) => ({ codepoint: char.codePointAt(0), width: 1, flags: 0, grapheme_len: 0 }));
    }
    getViewportY() {
      return Math.max(0, this.screen.length - this.rows - this.buffer.active.viewportY);
    }
    setScreen(lines: string[], viewportY = 0) {
      this.screen = lines;
      this.buffer.active.viewportY = viewportY;
    }
    render() {
      for (const listener of this.renderListeners) listener({ start: 0, end: this.rows - 1 });
    }
    onRender(callback: (event: any) => void) {
      this.renderListeners.add(callback);
      return { dispose: () => this.renderListeners.delete(callback) };
    }
    onScroll(callback: (event: any) => void) {
      this.scrollListeners.add(callback);
      return { dispose: () => this.scrollListeners.delete(callback) };
    }
    onResize(callback: (event: any) => void) {
      this.resizeListeners.add(callback);
      return { dispose: () => this.resizeListeners.delete(callback) };
    }
    lines: number[] = [];
    wheels: any[] = [];
    data = (_data: string) => {};
    binary = (_data: string) => {};
    scrollLines(lines: number) {
      this.lines.push(lines);
      for (const listener of this.scrollListeners) listener(this.buffer.active.viewportY);
    }
    open(element: Element) {
      this.element = element;
      const canvas = Object.assign(new Element(), {
        tagName: "CANVAS",
        dispatchEvent: (event: any) => {
          this.wheels.push(event);
          this.data("\x1b[A");
        },
      });
      canvas.addEventListener("touchend", () => this.focus());
      element.append(canvas);
    }
    focused = 0;
    focus() {
      this.focused++;
    }
    blur() {}
    dispose() {
      this.disposed = true;
      this.renderListeners.clear();
      this.scrollListeners.clear();
      this.resizeListeners.clear();
    }
    onData(callback: (data: string) => void) {
      this.data = callback;
      return {
        dispose: () => {
          this.data = () => {};
        },
      };
    }
    onBinary(callback: (data: string) => void) {
      this.binary = callback;
      return {
        dispose: () => {
          this.binary = () => {};
        },
      };
    }
    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
      for (const listener of this.resizeListeners) listener({ cols, rows });
    }
    writeReplies: string[] = [];
    write(bytes: Uint8Array, callback?: () => void) {
      this.writes.push(bytes);
      for (const reply of this.writeReplies.splice(0)) this.data(reply);
      callback?.();
      this.render();
    }
  }
  let dimensions = { cols: 120, rows: 40 };
  class FitAddon {
    proposeDimensions() {
      return dimensions;
    }
  }
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    sent: any[] = [];
    onmessage?: (event: any) => void;
    onclose?: (event: any) => void;
    constructor(
      public url: string,
      public protocols: string[],
    ) {
      sockets.push(this);
    }
    send(message: string) {
      this.sent.push(JSON.parse(message));
    }
    message(message: any) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
    close(code = 1000) {
      this.readyState = 3;
      this.onclose?.({ code });
    }
  }
  const document = Object.assign(new Element(), {
    hidden: false,
    body: new Element(),
    activeElement: null as Element | null,
    fonts: {
      load: async () => {
        startup.push("fonts");
        await loading.fonts;
        startup.push("fonts-ready");
        return [];
      },
    },
    querySelector: (selector: string) => node(selector.slice(1)),
    createElement: (tag: string) => {
      const element = new Element();
      element.tagName = tag.toUpperCase();
      element.onFocus = () => {
        document.activeElement = element;
      };
      return element;
    },
    getElementById: (id: string) => {
      const find = (element: Element): Element | undefined =>
        element.id === id ? element : element.children.map(find).find(Boolean);
      return [...nodes.values()].map(find).find(Boolean) ?? nodes.get(id) ?? null;
    },
  });
  const window = new Element();
  const frames = new Map<number, () => void>();
  let frameId = 0;
  const timers: (() => void)[] = [];
  let resize = () => {};
  class ResizeObserver {
    constructor(callback: () => void) {
      if (callback.name === "resizeSelected") resize = callback;
    }
    observe() {}
  }
  const requests: {
    path: string;
    options: any;
    resolve: (state: any) => void;
    fail: (status: number, detail: string) => void;
  }[] = [];
  let deviceClosed = 0;
  let audioOptions: any;
  const context = createContext({
    Terminal,
    Ghostty,
    CellFlags,
    WheelEvent: class {
      constructor(
        public type: string,
        options: any,
      ) {
        Object.assign(this, options);
      }
    },
    FitAddon,
    document,
    window,
    WebSocket: Socket,
    ResizeObserver,
    location: { hash, pathname: "/", origin: "http://localhost" },
    history: { replaceState() {} },
    sessionStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    URLSearchParams,
    Uint8Array,
    TextEncoder,
    AbortController,
    Error,
    atob,
    btoa,
    requestAnimationFrame: (callback: () => void) => {
      const id = ++frameId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout: (callback: () => void) => timers.push(callback),
    clearTimeout() {},
    fetch: (path: string, options: any) =>
      new Promise((resolve) => {
        requests.push({
          path,
          options,
          resolve: (state) => resolve({ ok: true, json: async () => state }),
          fail: (status, detail) => resolve({ ok: false, status, text: async () => detail }),
        });
      }),
    connectBrowserAudio: async (options: any) => {
      audioOptions = options;
      if (device) return device(options);
      options.onState("enabled");
      return {
        close: async () => {
          deviceClosed++;
        },
      };
    },
  });
  runInContext(touchSource + "\n" + accessibilitySource + "\n" + source, context);
  await tick();
  const events = () => sockets.filter((socket) => socket.url.endsWith("/api/events")).at(-1)!;
  const terminal = (id: string) => sockets.filter((socket) => socket.url.includes("tab=" + id + "&")).at(-1)!;
  const flushFrames = () => {
    while (frames.size) {
      const [id, callback] = frames.entries().next().value!;
      frames.delete(id);
      callback();
    }
  };
  return {
    node,
    document,
    window,
    sockets,
    requests,
    terminals,
    startup,
    ghostty,
    timers,
    events,
    terminal,
    flushFrames,
    resize: (next = dimensions) => {
      dimensions = next;
      resize();
    },
    snapshot: (state: any) => {
      events().message({ type: "state", state });
      flushFrames();
    },
    ready: (id: string) => {
      terminal(id).message({ type: "ready", cols: 70, rows: 20 });
      terminal(id).message({ type: "audio-owner", id: "cap-" + id, ownerId: "owner-" + id });
    },
    get deviceClosed() {
      return deviceClosed;
    },
    get audioOptions() {
      return audioOptions;
    },
  };
}
const snapshot = (revision: number, voice: any = null) => ({
  revision,
  voice,
  defaultCwd: "/one",
  workspaces: [
    {
      id: "one",
      name: "One",
      cwd: "/one",
      tabs: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
    },
    { id: "two", name: "Two", cwd: "/two", tabs: [{ id: "c", name: "C" }] },
  ],
});
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

test("fonts finish before Ghostty loads once, then every pane uses that instance", async () => {
  let finishFonts!: () => void;
  let finishWasm!: () => void;
  const b = await browser(undefined, "#token=secret", {
    fonts: new Promise<void>((resolve) => {
      finishFonts = resolve;
    }),
    wasm: new Promise<void>((resolve) => {
      finishWasm = resolve;
    }),
  });
  expect(b.startup).toEqual(["fonts"]);
  expect(b.sockets).toEqual([]);
  finishFonts();
  await tick();
  expect(b.startup).toEqual(["fonts", "fonts-ready", "wasm:/ghostty-vt.wasm"]);
  expect(b.sockets).toEqual([]);
  finishWasm();
  await tick();
  b.snapshot(snapshot(1));
  expect(b.terminals).toHaveLength(3);
  expect(b.terminals.every((term) => term.options.ghostty === b.ghostty)).toBe(true);
  b.snapshot(snapshot(2));
  expect(b.startup.filter((step) => step.startsWith("wasm:"))).toHaveLength(1);
});

test("text and binary input stay with their pane socket", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.ready("a");
  b.ready("b");
  b.terminals[0].data("a-input");
  b.terminals[1].binary("\x1b[M\xff\x80\x00");
  expect(b.terminal("a").sent.filter((message) => message.type === "input")).toEqual([
    { type: "input", data: "a-input" },
  ]);
  expect(b.terminal("b").sent.filter((message) => message.type === "input")).toEqual([
    { type: "input", data: btoa("\x1b[M\xff\x80\x00"), encoding: "base64" },
  ]);
});

test("events reconcile monotonically without remote focus or duplicate deletes", async () => {
  const b = await browser();
  expect(b.events().protocols).toEqual(["bruv-state", "bruv-token.secret"]);
  b.snapshot(snapshot(2));
  b.node("tab-list").children[1].children[0].fire("click");
  b.flushFrames();
  const next = snapshot(3);
  next.workspaces[0].tabs.push({ id: "d", name: "D" });
  next.workspaces[0].tabs[0].name = "Renamed";
  b.snapshot(next);
  expect(b.node("tab-list").children[1].children[0].attributes["aria-selected"]).toBe("true");
  expect(b.node("tab-list").children[0].children[0].textContent).toBe("Renamed");
  b.snapshot(snapshot(3));
  expect(b.node("tab-list").children).toHaveLength(3);
  b.requests[0].resolve(snapshot(1));
  await tick();
  expect(b.node("tab-list").children).toHaveLength(3);
  const removed = snapshot(4);
  removed.workspaces[0].tabs = [{ id: "a", name: "A" }];
  b.snapshot(removed);
  expect(b.terminals[1].disposed).toBe(true);
  expect(b.terminal("b").readyState).toBe(3);
  expect(b.requests.filter((request) => request.options.method === "DELETE")).toHaveLength(0);
  b.events().close(1006);
  expect(b.node("sync-status").textContent).toContain("retrying");
  b.timers.shift()!();
  b.snapshot(snapshot(5));
  expect(b.node("tab-list").children).toHaveLength(2);
  expect(b.node("sync-status").textContent).toBe("");
});

test("viewport reports never echo shared size and hidden attachments stay inactive", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  for (const id of ["a", "b", "c"]) b.ready(id);
  expect(b.terminal("a").sent).toEqual([{ type: "resize", cols: 120, rows: 40 }]);
  expect(b.terminal("b").sent).toEqual([]);
  expect(b.terminals[0].cols).toBe(70);
  expect(b.terminals[1].cols).toBe(70);
  expect(b.terminals[1].rows).toBe(20);
  b.terminal("a").message({ type: "size", cols: 70, rows: 20 });
  b.resize();
  expect(b.terminals[0].cols).toBe(70);
  expect(b.terminal("a").sent).toHaveLength(1);
  b.snapshot(snapshot(2));
  expect(b.terminal("a").sent).toHaveLength(1);
  b.node("tab-list").children[1].children[0].fire("click");
  b.flushFrames();
  expect(b.terminal("a").sent.at(-1)).toEqual({ type: "visibility", active: false });
  expect(b.terminal("b").sent.at(-1)).toEqual({ type: "resize", cols: 120, rows: 40 });
  b.document.hidden = true;
  b.document.fire("visibilitychange");
  b.resize({ cols: 50, rows: 10 });
  expect(b.terminal("b").sent.at(-1)).toEqual({ type: "visibility", active: false });
  b.document.hidden = false;
  b.document.fire("visibilitychange");
  b.flushFrames();
  expect(b.terminal("b").sent.at(-1)).toEqual({ type: "resize", cols: 50, rows: 10 });
});

test("each tab keeps replay sequence and terminal across reconnect", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.ready("a");
  b.ready("b");
  b.terminal("a").message({ type: "output", seq: 1, data: btoa("first") });
  b.terminal("a").message({ type: "output", seq: 1, data: btoa("duplicate") });
  b.terminal("b").message({ type: "output", seq: 1, data: btoa("other") });
  b.terminal("a").close(1006);
  b.timers.shift()!();
  expect(b.terminal("a").url).toContain("after=1");
  b.ready("a");
  b.terminal("a").message({ type: "output", seq: 2, data: btoa("second") });
  expect(b.terminals[0].writes).toHaveLength(2);
  expect(b.terminals[1].writes).toHaveLength(1);
  expect(b.terminals).toHaveLength(3);
});

test("global voice is named, observers cannot disable it, and selection never transfers it", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.ready("a");
  b.ready("b");
  b.ready("c");
  b.snapshot(snapshot(2, { tabId: "c", ownerId: "another-browser" }));
  expect(b.node("audio-status").textContent).toBe("Voice in another browser · Two / C");
  expect(b.node("voice-status").hidden).toBe(false);
  b.terminal("c").close();
  expect(b.deviceClosed).toBe(0);
  b.snapshot(snapshot(3));
  expect(b.node("voice-status").hidden).toBe(true);
  b.terminal("a").message({ type: "audio-request", request: "request-a" });
  await tick();
  b.snapshot(snapshot(4, { tabId: "a", ownerId: "owner-a" }));
  b.snapshot(snapshot(3));
  b.node("workspace-list").children[1].children[0].fire("click");
  b.flushFrames();
  expect(b.audioOptions.owner).toBe("cap-a");
  expect(b.node("audio-status").textContent).toContain("One / A");
  expect(b.node("audio-status").textContent).toContain("One / A");
  expect(b.deviceClosed).toBe(0);
  b.terminal("b").close();
  expect(b.deviceClosed).toBe(0);
  b.terminal("a").close(1006);
  await tick();
  expect(b.deviceClosed).toBe(1);
  b.snapshot(snapshot(5));
  expect(b.node("audio-status").textContent).toBe("");
});

test("request cancellation closes only the local owner device", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.ready("a");
  b.terminal("a").message({ type: "audio-request", request: "request-a" });
  await tick();
  b.snapshot(snapshot(2, { tabId: "a", ownerId: "owner-a" }));
  b.snapshot(snapshot(3));
  await tick();
  expect(b.deviceClosed).toBe(0);
  b.terminal("a").message({ type: "audio-cancel", request: "request-a" });
  await tick();
  expect(b.deviceClosed).toBe(1);
  expect(b.node("audio-status").textContent).toBe("");
  b.terminal("a").message({ type: "audio-request", request: "request-a" });
  await tick();
  b.snapshot(snapshot(4, { tabId: "a", ownerId: "owner-a" }));
  b.audioOptions.onState("closed");
  await tick();
  expect(b.deviceClosed).toBe(2);
  expect(b.audioOptions.signal.aborted).toBe(true);
  expect(b.node("audio-status").textContent).toContain("Releasing microphone");
  b.snapshot(snapshot(5));
  expect(b.node("voice-status").hidden).toBe(true);
});

test("compact status keeps connection and voice labels accessible", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.ready("a");
  expect(b.node("terminal-status").hidden).toBe(true);
  b.terminal("a").message({ type: "exit", code: 1 });
  expect(b.node("terminal-status").hidden).toBe(false);
  expect(b.node("status").textContent).toContain("CLI ended");
});

const key = (key: string) => ({ key, preventDefault() {}, stopPropagation() {} });
test("inline rename saves only its captured tab and retains its input through snapshots", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.requests[0].resolve(snapshot(1));
  await tick();
  const count = b.requests.length;
  b.node("tab-list").children[0].children[0].fire("dblclick");
  const input = b.node("tab-list").children[0].children[0];
  input.value = "  Build  ";
  const next = snapshot(2);
  next.workspaces[0].tabs[0].name = "Remote name";
  b.snapshot(next);
  expect(b.node("tab-list").children[0].children[0]).toBe(input);
  expect(b.document.activeElement).toBe(input);
  expect(input.value).toBe("  Build  ");
  input.fire("keydown", key("Enter"));
  await tick();
  expect(b.requests).toHaveLength(count + 1);
  expect(b.requests.at(-1)?.path).toBe("/api/tabs/a");
  expect(JSON.parse(b.requests.at(-1)?.options.body)).toEqual({ name: "Build" });
});

test("deleting another tab before the editor preserves the input and saves the right ID", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.requests[0].resolve(snapshot(1));
  await tick();
  b.node("tab-list").children[1].children[0].fire("dblclick");
  const input = b.node("tab-list").children[1].children[0];
  input.value = "Second draft";
  const next = snapshot(2);
  next.workspaces[0].tabs.shift();
  b.snapshot(next);
  expect(b.node("tab-list").children[0].children[0]).toBe(input);
  expect(b.document.activeElement).toBe(input);
  input.fire("keydown", key("Enter"));
  expect(b.requests.at(-1)?.path).toBe("/api/tabs/b");
  expect(JSON.parse(b.requests.at(-1)?.options.body)).toEqual({ name: "Second draft" });
});

test("F2, Escape, blur and blank names do not submit; a removed editor exits safely", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.requests[0].resolve(snapshot(1));
  await tick();
  const count = b.requests.length;
  const entry = () => b.node("tab-list").children[0].children[0];
  for (const end of ["Escape", "blur", "Enter"]) {
    entry().fire("keydown", key("F2"));
    expect(entry().classList.contains("tab-name-input")).toBe(true);
    expect(entry().classList.contains("input")).toBe(true);
    entry().value = end === "Enter" ? "   " : "Never saved";
    if (end === "blur") entry().fire("blur");
    else entry().fire("keydown", key(end));
    expect(entry().classList.contains("tab-select")).toBe(true);
    expect(entry().classList.contains("btn")).toBe(true);
    expect(b.requests).toHaveLength(count);
  }
  entry().fire("dblclick");
  const removed = entry();
  const next = snapshot(2);
  next.workspaces[0].tabs.shift();
  b.snapshot(next);
  removed.fire("keydown", key("Enter"));
  expect(b.requests).toHaveLength(count);
  expect(entry().textContent).toBe("B");
});

test("touch double-tap starts inline rename and close still needs confirmation", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.requests[0].resolve(snapshot(1));
  await tick();
  const entry = b.node("tab-list").children[0].children[0];
  entry.fire("pointerup", { pointerType: "touch", timeStamp: 100, preventDefault() {} });
  entry.fire("pointerup", { pointerType: "touch", timeStamp: 300, preventDefault() {} });
  const input = b.node("tab-list").children[0].children[0];
  expect(input.classList.contains("tab-name-input")).toBe(true);
  expect(input.classList.contains("input")).toBe(true);
  input.fire("keydown", key("Escape"));
  void b.node("tab-list").children[0].children[1].fire("click");
  expect(b.node("workspace-dialog").open).toBe(true);
  expect(b.node("dialog-description").textContent).toContain("for everyone");
  b.node("dialog-cancel").fire("click");
  await tick();
  expect(b.requests).toHaveLength(1);
});

test("Escape then immediate reopen cannot lose destructive confirmation to a late close event", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.requests[0].resolve(snapshot(1));
  await tick();
  void b.node("tab-list").children[0].children[1].fire("click");
  b.node("workspace-dialog").fire("cancel", { preventDefault() {} });
  void b.node("tab-list").children[0].children[1].fire("click");
  // This event belongs to the cancelled dialog, not the fresh confirmation.
  b.node("workspace-dialog").fire("close");
  b.node("dialog-form").fire("submit", { preventDefault() {} });
  await tick();
  expect(b.requests.at(-1)?.path).toBe("/api/tabs/a");
  expect(b.requests.at(-1)?.options.method).toBe("DELETE");
});

test("per-tab close cancels safely and deletes the captured inactive tab", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.requests[0].resolve(snapshot(1));
  await tick();
  const count = b.requests.length;
  b.node("tab-list").children[1].children[1].fire("click");
  expect(b.node("tab-list").children[0].children[0].attributes["aria-selected"]).toBe("true");
  expect(b.node("dialog-title").textContent).toBe("Close “B”?");
  b.node("dialog-cancel").fire("click");
  await tick();
  expect(b.requests).toHaveLength(count);
  b.node("tab-list").children[1].children[1].fire("click");
  b.node("workspace-list").children[1].children[0].fire("click");
  b.node("dialog-form").fire("submit", { preventDefault() {} });
  await tick();
  expect(b.requests.at(-1)?.path).toBe("/api/tabs/b");
  expect(b.requests.at(-1)?.options.method).toBe("DELETE");
  expect(JSON.parse(b.requests.at(-1)?.options.body)).toEqual({ confirm: true });
});

test("only a targeted request opens audio; active voice cannot be moved", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.ready("a");
  b.ready("b");
  expect(b.audioOptions).toBeUndefined();
  b.terminal("b").message({ type: "audio-request", request: "request-b" });
  await tick();
  expect(b.audioOptions.owner).toBe("cap-b");
  expect(b.audioOptions.url).toContain("request=request-b");
  b.terminal("a").message({ type: "audio-request", request: "request-a" });
  await tick();
  expect(b.audioOptions.owner).toBe("cap-b");
  expect(b.terminal("a").sent.at(-1)).toMatchObject({ type: "audio-error", request: "request-a" });
  b.terminal("b").message({ type: "audio-cancel", request: "old-request" });
  await tick();
  expect(b.deviceClosed).toBe(0);
  b.terminal("b").message({ type: "audio-cancel", request: "request-b" });
  await tick();
  expect(b.deviceClosed).toBe(1);
  b.terminal("a").message({ type: "audio-request", request: "new-request" });
  await tick();
  expect(b.audioOptions.owner).toBe("cap-a");
});

test("permission denial reports to the owning CLI and a fresh request can retry", async () => {
  let attempts = 0;
  const b = await browser(async () => {
    if (++attempts === 1) throw new Error("Microphone permission denied. Allow it, then type /live to retry.");
    return { close: async () => {} };
  });
  b.snapshot(snapshot(1));
  b.ready("a");
  b.terminal("a").message({ type: "audio-request", request: "denied" });
  await tick();
  expect(b.terminal("a").sent.at(-1)).toMatchObject({ type: "audio-error", request: "denied" });
  expect(b.node("audio-status").textContent).toContain("permission denied");
  b.terminal("a").message({ type: "audio-request", request: "retry" });
  await tick();
  expect(attempts).toBe(2);
  expect(b.audioOptions.url).toContain("request=retry");
});

test("cancelled permission does not occupy voice; a late device cannot replace a retry", async () => {
  let finish!: (device: { close(): Promise<void> }) => void;
  let attempts = 0,
    lateClosed = 0;
  const b = await browser(async () => {
    if (++attempts === 1)
      return new Promise((resolve) => {
        finish = resolve;
      });
    return { close: async () => {} };
  });
  b.snapshot(snapshot(1));
  b.ready("a");
  b.ready("b");
  b.terminal("a").message({ type: "audio-request", request: "pending" });
  await tick();
  const signal = b.audioOptions.signal;
  b.terminal("a").message({ type: "audio-cancel", request: "pending" });
  await tick();
  expect(signal.aborted).toBe(true);
  b.terminal("b").message({ type: "audio-request", request: "retry" });
  await tick();
  expect(b.audioOptions.owner).toBe("cap-b");
  finish({
    close: async () => {
      lateClosed++;
    },
  });
  await tick();
  expect(lateClosed).toBe(1);
  expect(b.audioOptions.owner).toBe("cap-b");
  expect(b.node("audio-status").textContent).toContain("One / B");
});

test("a late presence release cannot close a fresh request from the same attachment", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.ready("a");
  b.terminal("a").message({ type: "audio-request", request: "old" });
  await tick();
  b.snapshot(snapshot(2, { tabId: "a", ownerId: "owner-a" }));
  b.terminal("a").message({ type: "audio-cancel", request: "old" });
  await tick();
  b.terminal("a").message({ type: "audio-request", request: "fresh" });
  await tick();
  b.snapshot(snapshot(3));
  await tick();
  expect(b.deviceClosed).toBe(1);
  expect(b.audioOptions.url).toContain("request=fresh");
});

test("each terminal uses the pure-black Vesper palette", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  for (const terminal of b.terminals) {
    expect(terminal.options.theme).toEqual({
      background: "#000000",
      foreground: "#ffffff",
      cursor: "#ffc799",
      cursorAccent: "#000000",
      selectionBackground: "#ffffff25",
      selectionForeground: "#ffffff",
      black: "#101010",
      red: "#f5a191",
      green: "#90b99f",
      yellow: "#e6b99d",
      blue: "#aca1cf",
      magenta: "#e29eca",
      cyan: "#ea83a5",
      white: "#a0a0a0",
      brightBlack: "#7e7e7e",
      brightRed: "#ff8080",
      brightGreen: "#99ffe4",
      brightYellow: "#ffc799",
      brightBlue: "#b9aeda",
      brightMagenta: "#ecaad6",
      brightCyan: "#f591b2",
      brightWhite: "#ffffff",
    });
  }
});

test("overflow cues show only the edges with hidden tabs", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  const list = b.node("tab-list");
  list.clientWidth = 320;
  list.scrollWidth = 900;
  list.fire("scroll");
  expect(list.attributes["data-start-clipped"]).toBe("false");
  expect(list.attributes["data-end-clipped"]).toBe("true");
  list.scrollLeft = 580;
  list.fire("scroll");
  expect(list.attributes["data-start-clipped"]).toBe("true");
  expect(list.attributes["data-end-clipped"]).toBe("false");
  list.scrollLeft = 0;
  list.scrollWidth = 320;
  list.fire("scroll");
  expect(list.attributes["data-start-clipped"]).toBe("false");
  expect(list.attributes["data-end-clipped"]).toBe("false");
});

test("keyed workspace rows retain focused remove through snapshots without selecting it", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.requests[0].resolve(snapshot(1));
  await tick();
  const row = b.node("workspace-list").children[1];
  const remove = row.children[1];
  remove.focus();
  b.snapshot(snapshot(2));
  expect(b.node("workspace-list").children[1]).toBe(row);
  expect(b.document.activeElement).toBe(remove);
  remove.fire("click");
  expect(b.node("dialog-description").textContent).toContain("/two");
  expect(b.node("workspace-list").children[0].children[0].attributes["aria-pressed"]).toBe("true");
  b.node("dialog-cancel").click();
  await tick();
  expect(b.document.activeElement).toBe(remove);
});

test("folder failures retain draft and local error; resolved identity selects an existing workspace", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.requests[0].resolve(snapshot(1));
  await tick();
  b.node("add-workspace").click();
  const field = b.node("folder-input");
  field.value = "/two";
  b.node("folder-form").fire("submit", { preventDefault() {} });
  b.requests.at(-1)!.fail(503, "Server busy. Try again.");
  await tick();
  expect(field.value).toBe("/two");
  expect(b.document.activeElement).toBe(field);
  expect(b.node("folder-error").textContent).toContain("Server busy");
  expect(b.node("folder-form").hidden).toBe(false);
  b.node("folder-form").fire("submit", { preventDefault() {} });
  b.requests.at(-1)!.resolve({ ...snapshot(2), workspaceId: "two", created: false });
  await tick();
  expect(b.node("workspace-list").children[1].children[0].attributes["aria-pressed"]).toBe("true");
  expect(field.value).toBe("");
  expect(b.node("folder-form").hidden).toBe(true);
});

test("missing and known-invalid access are not empty workspaces or endless retry", async () => {
  const missing = await browser(undefined, "");
  expect(missing.requests).toHaveLength(0);
  expect(missing.node("folder-form").hidden).toBe(true);
  expect(missing.node("empty-action").hidden).toBe(true);
  const invalid = await browser();
  invalid.requests[0].fail(403, "Forbidden");
  await tick();
  expect(invalid.node("folder-form").hidden).toBe(true);
  expect(invalid.node("add-workspace").hidden).toBe(true);
  expect(invalid.node("empty-action").hidden).toBe(true);
});

test("replay loss freezes output without marking the live CLI ended", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.ready("a");
  b.terminal("a").message({ type: "output", seq: 1, data: btoa("kept screen") });
  b.terminal("a").message({ type: "output", seq: 3, data: btoa("incomplete") });
  expect(b.terminals[0].writes).toHaveLength(1);
  expect(b.terminals[0].options.disableStdin).toBe(true);
  expect(b.node("status").textContent).toContain("original work still runs");
  expect(b.node("tab-list").children[0].children[0].textContent).toContain("view lost");
  expect(b.node("tab-list").children[0].children[0].attributes["aria-label"]).toContain("view lost");
  expect(b.node("tab-list").children[0].children[0].textContent).not.toContain("ended");
  expect(b.node("lost-new-tab").hidden).toBe(false);
});

test("only the active pane exposes rendered viewport text", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.ready("a");
  b.ready("b");
  const pane = (id: string) => b.document.getElementById("terminal-" + id)!;
  const output = (id: string) => pane(id).querySelector(".terminal-accessible-output")!;
  const exposed = () =>
    ["a", "b", "c"].filter(
      (id) =>
        !pane(id).hidden && !pane(id).inert && !output(id).hidden && output(id).attributes["aria-hidden"] !== "true",
    );
  expect(["a", "b", "c"].map(output).every(Boolean)).toBe(true);
  expect(b.terminals.every((term) => term.options.screenReaderMode === undefined)).toBe(true);
  b.terminals[0].setScreen(["outside viewport", "rendered A   ", "next row", "outside viewport"], 1);
  b.terminal("a").message({ type: "size", cols: 70, rows: 2 });
  b.terminal("b").message({ type: "size", cols: 70, rows: 2 });
  b.flushFrames();
  b.terminal("a").message({ type: "output", seq: 1, data: btoa("\x1b[2Jraw input is not the screen") });
  b.flushFrames();
  expect(output("a").textContent).toBe("rendered A\nnext row");
  expect(exposed()).toEqual(["a"]);
  expect(output("a").attributes.role).toBe("region");
  expect(output("a").attributes["aria-label"]).toBe("Terminal output");
  expect(output("b").textContent).toBe("");
  b.terminals[1].setScreen(["rendered B"]);
  b.terminals[1].render();
  b.flushFrames();
  expect(exposed()).toEqual(["a"]);
  b.node("tab-list").children[1].children[0].click();
  b.flushFrames();
  expect(exposed()).toEqual(["b"]);
  expect(output("a").textContent).toBe("");
  expect(output("b").textContent.trimEnd()).toBe("rendered B");
  b.terminals[1].setScreen(["old line", "scrolled B", "last B"], 1);
  b.terminals[1].scrollLines(1);
  b.flushFrames();
  expect(output("b").textContent.trimEnd()).toBe("scrolled B\nlast B");
  b.document.hidden = true;
  b.document.fire("visibilitychange");
  expect(exposed()).toEqual([]);
  b.terminals[1].setScreen(["resumed B"]);
  b.document.hidden = false;
  b.document.fire("visibilitychange");
  b.flushFrames();
  expect(exposed()).toEqual(["b"]);
  expect(output("b").textContent.trimEnd()).toBe("resumed B");
  const removedOutput = output("b");
  const removedPane = pane("b");
  const lastText = removedOutput.textContent;
  b.terminals[1].setScreen(["queued output"]);
  b.terminals[1].scrollLines(1);
  const next = snapshot(2);
  next.workspaces[0].tabs = [{ id: "a", name: "A" }];
  b.snapshot(next);
  expect(removedPane.isConnected).toBe(false);
  expect(b.terminals[1].disposed).toBe(true);
  b.terminals[1].setScreen(["late render"]);
  b.terminals[1].render();
  b.flushFrames();
  expect(removedOutput.textContent).toBe(lastText);
  expect(b.terminals[1].renderListeners.size).toBe(0);
});

test("pending Cancel notifies the matching owner and releases a late device", async () => {
  let resolveDevice!: (device: { close(): Promise<void> }) => void;
  let closed = 0;
  const b = await browser(
    () =>
      new Promise((resolve) => {
        resolveDevice = resolve;
      }),
  );
  b.snapshot(snapshot(1));
  b.ready("a");
  b.terminal("a").message({ type: "audio-owner", id: "cap-a", ownerId: "owner-a" });
  b.terminal("a").message({ type: "audio-request", request: "pending-a" });
  expect(b.node("cancel-voice").hidden).toBe(false);
  b.node("cancel-voice").click();
  await tick();
  expect(b.terminal("a").sent.at(-1)).toEqual({
    type: "audio-error",
    request: "pending-a",
    message: "Microphone request cancelled.",
  });
  resolveDevice({
    close: async () => {
      closed++;
    },
  });
  await tick();
  expect(closed).toBe(1);
  expect(b.node("voice-status").hidden).toBe(true);
});

test("a pending folder failure reopens its phone drawer and keeps the draft", async () => {
  const b = await browser();
  (b.window as any).innerWidth = 390;
  b.snapshot(snapshot(1));
  b.requests[0].resolve(snapshot(1));
  await tick();
  b.node("open-drawer").click();
  b.node("add-workspace").click();
  b.node("folder-input").value = "/my/draft";
  b.node("folder-form").fire("submit", { preventDefault() {} });
  expect(b.node("cancel-folder").disabled).toBe(true);
  b.node("close-drawer").click();
  b.requests.at(-1)!.fail(503, "Server busy. Try again.");
  await tick();
  expect(b.document.body.attributes["data-drawer"]).toBe("open");
  expect(b.node("folder-input").value).toBe("/my/draft");
  expect(b.document.activeElement).toBe(b.node("folder-input"));
  expect(b.node("cancel-folder").disabled).toBe(false);
});

test("removing a preceding workspace keeps the surviving row and its focused control", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.requests[0].resolve(snapshot(1));
  await tick();
  const row = b.node("workspace-list").children[1];
  const remove = row.children[1];
  remove.focus();
  const next = snapshot(2);
  next.workspaces.shift();
  b.snapshot(next);
  expect(b.node("workspace-list").children[0]).toBe(row);
  expect(b.document.activeElement).toBe(remove);
});

test("Enter saves the visible draft even if a shared rename changed its original name", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.requests[0].resolve(snapshot(1));
  await tick();
  b.node("tab-list").children[0].children[0].fire("keydown", key("F2"));
  const input = b.node("tab-list").children[0].children[0];
  const next = snapshot(2);
  next.workspaces[0].tabs[0].name = "Remote name";
  b.snapshot(next);
  expect(input.value).toBe("A");
  input.fire("keydown", key("Enter"));
  expect(b.requests.at(-1)?.path).toBe("/api/tabs/a");
  expect(JSON.parse(b.requests.at(-1)!.options.body)).toEqual({ name: "A" });
});

test("a failed rename keeps the editor, draft and focus for retry", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.requests[0].resolve(snapshot(1));
  await tick();
  b.node("tab-list").children[0].children[0].fire("keydown", key("F2"));
  const input = b.node("tab-list").children[0].children[0];
  input.value = "Keep my draft";
  input.fire("keydown", key("Enter"));
  b.requests.at(-1)!.fail(503, "Try again");
  await tick();
  expect(b.node("tab-list").children[0].children[0]).toBe(input);
  expect(input.value).toBe("Keep my draft");
  expect(b.document.activeElement).toBe(input);
  input.fire("keydown", key("Enter"));
  expect(JSON.parse(b.requests.at(-1)!.options.body)).toEqual({ name: "Keep my draft" });
});

const touch = (y: number) => ({
  touches: [{ identifier: 1, clientX: 20, clientY: y }],
  preventDefault() {},
});
for (const type of ["alternate", "normal"]) {
  test(type + " held touch cannot forward after tab hide or resume on return", async () => {
    const b = await browser();
    b.snapshot(snapshot(1));
    b.ready("a");
    b.ready("b");
    const pane = b.document.getElementById("terminal-a")!;
    const term = b.terminals[0];
    term.buffer.active.type = type;
    const socket = b.terminal("a");
    const inputs = () => socket.sent.filter((message: any) => message.type === "input");
    const select = (index: number) => {
      b.node("tab-list").children[index].children[0].fire("click");
      b.flushFrames();
    };
    pane.fire("touchstart", touch(100));
    select(1);
    expect(pane.hidden).toBe(true);
    expect(socket.readyState).toBe(1);
    pane.fire("touchmove", touch(140));
    expect(inputs()).toEqual([]);
    expect(term.lines).toEqual([]);
    expect(term.wheels).toEqual([]);
    select(0);
    pane.fire("touchstart", touch(100));
    select(1);
    select(0);
    pane.fire("touchmove", touch(140));
    expect(inputs()).toEqual([]);
    expect(term.lines).toEqual([]);
    expect(term.wheels).toEqual([]);
    pane.fire("touchstart", touch(100));
    pane.fire("touchmove", touch(140));
    if (type === "alternate") {
      expect(inputs()).toEqual([{ type: "input", data: "\x1b[A" }]);
      expect(term.wheels).toHaveLength(1);
    } else {
      expect(inputs()).toEqual([]);
      expect(term.lines.length).toBe(1);
      expect(term.lines[0]).toBeLessThan(0);
    }
  });
}

test("touch end focuses only a fresh tap, never a held gesture after hide or drag", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.ready("a");
  b.ready("b");
  const pane = b.document.getElementById("terminal-a")!;
  const canvas = pane.querySelector("canvas")!;
  const term = b.terminals[0];
  const end = () =>
    canvas.fire("touchend", { touches: [], changedTouches: [{ identifier: 1, clientX: 20, clientY: 100 }] });
  let focused = term.focused;
  pane.fire("touchstart", touch(100));
  end();
  expect(term.focused).toBe(focused + 1);
  pane.fire("touchstart", touch(100));
  pane.fire("touchmove", touch(140));
  focused = term.focused;
  end();
  expect(term.focused).toBe(focused);
  pane.fire("touchstart", touch(100));
  b.node("tab-list").children[1].children[0].click();
  b.node("tab-list").children[0].children[0].click();
  b.flushFrames();
  focused = term.focused;
  end();
  expect(term.focused).toBe(focused);
  pane.fire("touchstart", touch(100));
  b.document.hidden = true;
  b.document.fire("visibilitychange");
  b.document.hidden = false;
  b.document.fire("visibilitychange");
  b.flushFrames();
  focused = term.focused;
  end();
  expect(term.focused).toBe(focused);
  pane.fire("touchstart", touch(100));
  end();
  expect(term.focused).toBe(focused + 1);
});

test("document hide and pane disposal cancel held touches", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.ready("a");
  const pane = b.document.getElementById("terminal-a")!;
  const term = b.terminals[0];
  term.buffer.active.type = "alternate";
  pane.fire("touchstart", touch(100));
  b.document.hidden = true;
  b.document.fire("visibilitychange");
  b.document.hidden = false;
  b.document.fire("visibilitychange");
  pane.fire("touchmove", touch(140));
  expect(term.wheels).toEqual([]);
  pane.fire("touchstart", touch(100));
  const next = snapshot(2);
  next.workspaces[0].tabs = [{ id: "b", name: "B" }];
  b.snapshot(next);
  expect(term.disposed).toBe(true);
  expect(pane.isConnected).toBe(false);
  for (const event of ["touchstart", "touchmove", "touchend", "touchcancel"])
    expect(pane.listeners.has(event)).toBe(false);
  expect(term.scrollListeners.size).toBe(0);
  expect(term.resizeListeners.size).toBe(0);
  // Reattach the old node to prove disposal cleared the gesture, not just the guard.
  b.node("terminal").append(pane);
  pane.hidden = false;
  pane.fire("touchmove", touch(140));
  expect(term.wheels).toEqual([]);
});

test("removing the last workspace closes its drawer and focuses folder entry", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.requests[0].resolve(snapshot(1));
  await tick();
  b.node("open-drawer").click();
  expect(b.document.body.attributes["data-drawer"]).toBe("open");
  const next = snapshot(2);
  next.workspaces = [];
  b.snapshot(next);
  expect(b.document.body.attributes["data-drawer"]).toBe("closed");
  expect(b.node("drawer-backdrop").hidden).toBe(true);
  expect(b.document.querySelector("main")!.inert).toBe(false);
  expect(b.document.activeElement).toBe(b.node("folder-input"));
});

test("initial list failure uses the recovery view without stacked notices", async () => {
  const b = await browser();
  b.requests[0].fail(503, "Fixture list outage");
  await tick();
  expect(b.node("sync-status").hidden).toBe(true);
  expect(b.node("notice").hidden).toBe(true);
  expect(b.node("empty-action").hidden).toBe(false);
  expect(b.node("empty-action").textContent).toBe("Retry");
  b.snapshot(snapshot(1));
  expect(b.node("sync-status").hidden).toBe(false);
  expect(b.node("notice").hidden).toBe(false);
  expect(b.node("notice").textContent).toBe("");
});

test("output replies are one batch, never human input, and survive socket handover until ack", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.ready("a");
  b.ready("b");
  const term = b.terminals[1]; // Hidden panes still render and answer queries.
  term.writeReplies.push("\x1b[1;1R", "\x1b[0n");
  b.terminal("b").message({ type: "output", seq: 1, data: btoa("query tail") });
  expect(b.terminal("b").sent.filter((m: any) => m.type === "terminal-reply")).toEqual([
    { type: "terminal-reply", seq: 1, data: "\x1b[1;1R\x1b[0n" },
  ]);
  expect(b.terminal("b").sent.some((m: any) => m.type === "input")).toBe(false);
  term.data("shared typing");
  term.binary("\xff");
  expect(b.terminal("b").sent.slice(-2)).toEqual([
    { type: "input", data: "shared typing" },
    { type: "input", data: btoa("\xff"), encoding: "base64" },
  ]);
  const old = b.terminal("b");
  old.onclose!({ code: 1006, reason: "lost" });
  b.timers.at(-1)!();
  const next = b.terminal("b");
  expect(next.url).toContain("after=1");
  b.ready("b");
  expect(next.sent.find((m: any) => m.type === "terminal-reply")).toEqual({
    type: "terminal-reply",
    seq: 1,
    data: "\x1b[1;1R\x1b[0n",
  });
  // An event from the old socket cannot erase the new socket's pending batch.
  old.message({ type: "terminal-reply-ack", seq: 1 });
  next.onclose!({ code: 1006, reason: "lost again" });
  b.timers.at(-1)!();
  b.ready("b");
  const newest = b.terminal("b");
  expect(newest.sent.some((m: any) => m.type === "terminal-reply")).toBe(true);
  newest.message({ type: "terminal-reply-ack", seq: 1 });
  newest.onclose!({ code: 1006, reason: "after ack" });
  b.timers.at(-1)!();
  b.ready("b");
  expect(b.terminal("b").sent.some((m: any) => m.type === "terminal-reply")).toBe(false);
});

test("unacknowledged protocol replies stay within the replay byte budget", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  b.ready("a");
  for (let seq = 1; seq <= 33; seq++) {
    b.terminals[0].writeReplies.push("r".repeat(64 * 1024));
    b.terminal("a").message({ type: "output", seq, data: btoa("query") });
  }
  expect(b.terminal("a").sent.filter((m: any) => m.type === "terminal-reply")).toHaveLength(32);
  expect(b.terminal("a").sent.some((m: any) => m.type === "input")).toBe(false);
  expect(b.terminals[0].options.disableStdin).toBe(true);
  expect(b.node("status").textContent).toContain("View lost");
});
