import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const source = new Bun.Transpiler({ loader: "ts" }).transformSync(
  readFileSync(new URL("../../src/web/browser-terminal-touch.ts", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace("export function", "function"),
);
function fixture(type = "normal", tracking = false) {
  const listeners = new Map<string, { fn: (event: any) => void; capture: boolean }[]>();
  const wheel: any[] = [],
    lines: number[] = [],
    selectors: string[] = [];
  const removed: string[] = [];
  let focused = 0;
  const element = {
    hidden: false,
    isConnected: true,
    addEventListener(name: string, fn: (event: any) => void, options?: boolean | { capture?: boolean }) {
      const capture = typeof options === "boolean" ? options : !!options?.capture;
      listeners.set(name, [...(listeners.get(name) ?? []), { fn, capture }]);
    },
    removeEventListener(name: string, fn: (event: any) => void) {
      removed.push(name);
      const remaining = (listeners.get(name) ?? []).filter((entry) => entry.fn !== fn);
      if (remaining.length) listeners.set(name, remaining);
      else listeners.delete(name);
    },
    querySelector(selector: string) {
      selectors.push(selector);
      return selector === "canvas" ? { clientHeight: 200, dispatchEvent: (event: any) => wheel.push(event) } : null;
    },
  };
  const term = {
    rows: 20,
    hasMouseTracking: () => tracking,
    buffer: { active: { type } },
    scrollLines: (count: number) => lines.push(count),
    focus: () => {
      focused++;
    },
  };
  const context = createContext({
    WheelEvent: class {
      constructor(
        public type: string,
        options: any,
      ) {
        Object.assign(this, options);
      }
    },
    element,
    term,
  });
  runInContext(source + "\nglobalThis.touch = installTerminalTouch(element, term);", context);
  let prevented = 0;
  return {
    wheel,
    lines,
    setTracking(value: boolean) {
      tracking = value;
    },
    element,
    listeners,
    removed,
    selectors,
    cancel: () => (context.touch as { cancel(): void }).cancel(),
    dispose: () => (context.touch as { dispose(): void }).dispose(),
    get prevented() {
      return prevented;
    },
    get focused() {
      return focused;
    },
    fire(name: string, y: number, count = 1, x = 20) {
      let stopped = false;
      const event = {
        touches: Array.from({ length: count }, () => ({ identifier: 1, clientX: x, clientY: y })),
        changedTouches: [{ identifier: 1, clientX: x, clientY: y }],
        preventDefault() {
          prevented++;
        },
        stopPropagation() {
          stopped = true;
        },
        stopImmediatePropagation() {
          stopped = true;
        },
      };
      const entries = listeners.get(name) ?? [];
      for (const { fn } of entries.filter((entry) => entry.capture)) fn(event);
      // Ghostty focuses its textarea from the canvas's target touchend listener.
      if (!stopped && name === "touchend") focused++;
      if (!stopped) for (const { fn } of entries.filter((entry) => !entry.capture)) fn(event);
    },
  };
}
test("finger drag scrolls normal history in the same direction as wheel", () => {
  const f = fixture();
  f.fire("touchstart", 100);
  f.fire("touchmove", 140);
  f.fire("touchmove", 180);
  expect(f.lines).toEqual([-4, -4]);
  expect(f.wheel).toEqual([]);
  expect(f.prevented).toBe(2);
});
test("alternate-screen history receives measured row wheel events through Ghostty", () => {
  const f = fixture("alternate");
  f.fire("touchstart", 100);
  f.fire("touchmove", 140);
  expect(f.lines).toEqual([]);
  expect(f.wheel[0]).toMatchObject({
    type: "wheel",
    deltaY: -4,
    deltaMode: 1,
    clientX: 20,
    clientY: 140,
    bubbles: true,
    cancelable: true,
  });
});
test("taps and multi-touch do not scroll or steal input", () => {
  const f = fixture();
  f.fire("touchstart", 100);
  f.fire("touchmove", 103);
  f.fire("touchmove", 140, 2);
  f.fire("touchmove", 180);
  expect(f.lines).toEqual([]);
  expect(f.prevented).toBe(0);
});

for (const type of ["normal", "alternate"]) {
  for (const unavailable of ["hidden", "disconnected"]) {
    test(type + " buffer ignores " + unavailable + " pane touches", () => {
      const f = fixture(type);
      f.fire("touchstart", 100);
      if (unavailable === "hidden") f.element.hidden = true;
      else f.element.isConnected = false;
      f.fire("touchmove", 140);
      f.fire("touchstart", 100);
      f.element.hidden = false;
      f.element.isConnected = true;
      f.fire("touchmove", 180);
      expect(f.wheel).toEqual([]);
      expect(f.lines).toEqual([]);
      expect(f.prevented).toBe(0);
    });
  }
}

for (const type of ["normal", "alternate"]) {
  test(type + " buffer cancellation survives hide and show before the next move", () => {
    const f = fixture(type);
    f.fire("touchstart", 100);
    f.element.hidden = true;
    f.cancel();
    f.element.hidden = false;
    f.fire("touchmove", 140);
    expect(f.wheel).toEqual([]);
    expect(f.lines).toEqual([]);
    expect(f.prevented).toBe(0);
    f.fire("touchstart", 100);
    f.fire("touchmove", 140);
    expect(f.prevented).toBe(1);
    if (type === "normal") expect(f.lines).toEqual([-4]);
    else expect(f.wheel).toHaveLength(1);
  });
}

test("a tap focuses once, then clears its gesture", () => {
  const f = fixture();
  expect(f.listeners.get("touchend")?.some((listener) => listener.capture)).toBe(true);
  f.fire("touchstart", 100);
  f.fire("touchend", 100, 0);
  expect(f.focused).toBe(1);
  f.fire("touchmove", 140);
  expect(f.lines).toEqual([]);
  expect(f.prevented).toBe(1);
});

for (const reason of ["cancel", "touchcancel", "drag", "horizontal drag", "hidden", "disconnected", "multi-touch"]) {
  test(reason + " touch end cannot focus the canvas input", () => {
    const f = fixture();
    f.fire("touchstart", 100);
    if (reason === "cancel") f.cancel();
    else if (reason === "touchcancel") f.fire("touchcancel", 100, 0);
    else if (reason === "drag") f.fire("touchmove", 140);
    else if (reason === "horizontal drag") f.fire("touchmove", 100, 1, 60);
    else if (reason === "hidden") f.element.hidden = true;
    else if (reason === "disconnected") f.element.isConnected = false;
    else f.fire("touchmove", 100, 2);
    f.fire("touchend", 100, 0);
    expect(f.focused).toBe(0);
    f.element.hidden = false;
    f.element.isConnected = true;
    f.fire("touchstart", 100);
    f.fire("touchend", 100, 0);
    expect(f.focused).toBe(1);
  });
}

test("cancel survives hide and show before touch end", () => {
  const f = fixture();
  f.fire("touchstart", 100);
  f.element.hidden = true;
  f.cancel();
  f.element.hidden = false;
  f.fire("touchend", 100, 0);
  expect(f.focused).toBe(0);
});

test("dispose removes listeners and a queued touch end cannot focus input", () => {
  const f = fixture("alternate");
  f.fire("touchstart", 100);
  const end = f.listeners.get("touchend")!.find((listener) => listener.capture)!.fn;
  f.dispose();
  expect(f.listeners.size).toBe(0);
  expect(f.removed).toEqual(expect.arrayContaining(["touchstart", "touchmove", "touchend", "touchcancel"]));
  f.fire("touchmove", 140);
  expect(f.wheel).toEqual([]);
  expect(f.lines).toEqual([]);
  let stopped = false;
  end({
    touches: [],
    changedTouches: [{ clientX: 20, clientY: 100 }],
    preventDefault() {},
    stopPropagation() {
      stopped = true;
    },
    stopImmediatePropagation() {
      stopped = true;
    },
  });
  expect(stopped).toBe(true);
});

test("small alternate swipes accumulate rows and cancel discards the fraction", () => {
  const f = fixture("alternate");
  f.fire("touchstart", 100);
  for (const y of [104, 108, 112, 116]) f.fire("touchmove", y);
  expect(f.wheel.map((event) => event.deltaY)).toEqual([-1]);
  expect(f.wheel.every((event) => event.deltaMode === 1)).toBe(true);
  f.cancel();
  f.fire("touchstart", 100);
  f.fire("touchmove", 108);
  expect(f.wheel).toHaveLength(1);
  f.fire("touchmove", 110);
  expect(f.wheel.map((event) => event.deltaY)).toEqual([-1, -1]);
});

test("normal-buffer tracking uses wheel packets and follows the public mode state", () => {
  const f = fixture("normal", true);
  f.fire("touchstart", 100);
  f.fire("touchmove", 140);
  expect(f.wheel.map((event) => event.deltaY)).toEqual([-4]);
  expect(f.wheel[0]).toMatchObject({ deltaMode: 1, clientX: 20, clientY: 140 });
  expect(f.lines).toEqual([]);
  f.setTracking(false);
  f.fire("touchmove", 180);
  expect(f.lines).toEqual([-4]);
  f.setTracking(true);
  f.cancel();
  f.fire("touchmove", 220);
  expect(f.wheel).toHaveLength(1);
  f.fire("touchstart", 100);
  f.dispose();
  f.fire("touchmove", 140);
  expect(f.wheel).toHaveLength(1);
});
