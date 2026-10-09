import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const source = new Bun.Transpiler({ loader: "ts" }).transformSync(
  readFileSync(new URL("../../src/web/browser-terminal-touch.ts", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace("export function", "function"),
);
function fixture(type = "normal") {
  const listeners = new Map<string, (event: any) => void>();
  const wheel: any[] = [],
    lines: number[] = [];
  const element = {
    hidden: false,
    isConnected: true,
    addEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, fn),
    querySelector: () => ({ clientHeight: 200, dispatchEvent: (event: any) => wheel.push(event) }),
  };
  const term = { rows: 20, buffer: { active: { type } }, scrollLines: (count: number) => lines.push(count) };
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
  runInContext(source + "\nglobalThis.cancel = installTerminalTouch(element, term);", context);
  let prevented = 0;
  return {
    wheel,
    lines,
    element,
    cancel: () => (context.cancel as () => void)(),
    get prevented() {
      return prevented;
    },
    fire(name: string, y: number, count = 1) {
      listeners.get(name)?.({
        touches: Array.from({ length: count }, () => ({ clientX: 20, clientY: y })),
        preventDefault() {
          prevented++;
        },
      });
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
test("alternate-screen history receives pixel wheel events through xterm", () => {
  const f = fixture("alternate");
  f.fire("touchstart", 100);
  f.fire("touchmove", 140);
  expect(f.lines).toEqual([]);
  expect(f.wheel[0]).toMatchObject({
    type: "wheel",
    deltaY: -40,
    deltaMode: 0,
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
