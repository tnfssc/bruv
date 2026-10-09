import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

// Exercise the browser entry point without a server or devices. The parent
// integration checks use real xterm, sockets and two browser windows.
const source = new Bun.Transpiler({ loader: "ts" }).transformSync(
  readFileSync(new URL("../../src/web/browser.ts", import.meta.url), "utf8").replace(/^import .*;\n/gm, ""),
);
class Element {
  hidden = false;
  disabled = false;
  textContent = "";
  children: Element[] = [];
  attributes: Record<string, string> = {};
  listeners = new Map<string, (event: any) => any>();
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
  addEventListener(type: string, listener: (event: any) => any) {
    this.listeners.set(type, listener);
  }
  fire(type: string, event: any = {}) {
    return this.listeners.get(type)?.(event);
  }
  querySelector() {
    return new Element();
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
async function browser(device?: (options: any) => Promise<{ close(): Promise<void> }>, hash = "#token=secret") {
  const nodes = new Map<string, Element>();
  const node = (id: string) => {
    if (!nodes.has(id)) {
      const element = new Element();
      element.id = id;
      element.onFocus = () => {
        document.activeElement = element;
      };
      nodes.set(id, element);
    }
    return nodes.get(id)!;
  };
  const terminals: any[] = [];
  class Terminal {
    cols = 80;
    rows = 24;
    disposed = false;
    writes: Uint8Array[] = [];
    options: any;
    constructor(options: any) {
      this.options = options;
      terminals.push(this);
    }
    loadAddon() {}
    open() {}
    focused = 0;
    focus() {
      this.focused++;
    }
    dispose() {
      this.disposed = true;
    }
    onData() {}
    onBinary() {}
    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
    }
    write(bytes: Uint8Array) {
      this.writes.push(bytes);
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
    fonts: { load: async () => [] },
    querySelector: (selector: string) => node(selector.slice(1)),
    createElement: () => {
      const element = new Element();
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
  const frames: (() => void)[] = [];
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
    installTerminalTouch() {},
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
    AbortController,
    Error,
    atob,
    btoa,
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
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
  runInContext(source, context);
  await tick();
  const events = () => sockets.filter((socket) => socket.url.endsWith("/api/events")).at(-1)!;
  const terminal = (id: string) => sockets.filter((socket) => socket.url.includes("tab=" + id + "&")).at(-1)!;
  const flushFrames = () => {
    while (frames.length) frames.shift()!();
  };
  return {
    node,
    document,
    window,
    sockets,
    requests,
    terminals,
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
    expect(entry().className).toBe("tab-name-input");
    entry().value = end === "Enter" ? "   " : "Never saved";
    if (end === "blur") entry().fire("blur");
    else entry().fire("keydown", key(end));
    expect(entry().className).toBe("tab-select");
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
  expect(input.className).toBe("tab-name-input");
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

test("only the visible xterm enables screen-reader output", async () => {
  const b = await browser();
  b.snapshot(snapshot(1));
  expect(b.terminals.map((term) => term.options.screenReaderMode)).toEqual([true, false, false]);
  b.node("tab-list").children[1].children[0].click();
  expect(b.terminals.map((term) => term.options.screenReaderMode)).toEqual([false, true, false]);
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
