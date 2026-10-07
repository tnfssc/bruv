import { describe, expect, test } from "bun:test";
import { TuiAltScreen, TuiMainScreen, type Terminal } from "@earendil-works/pi-tui";
import { attachTerminalProfiler } from "../scripts/terminal-perf/profiler";

class FakeTerminal implements Terminal {
  columns = 80;
  rows = 24;
  kittyProtocolActive = false;
  writes: string[] = [];
  onInput?: (data: string) => void;
  onResize?: () => void;
  onWrite = () => {};
  start(input: (data: string) => void, resize: () => void) {
    this.onInput = input;
    this.onResize = resize;
  }
  stop() {}
  async drainInput() {}
  write(data: string) {
    this.onWrite();
    this.writes.push(data);
  }
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setTitle() {}
  setProgress() {}
}

function fixture() {
  let clock = 0;
  const terminal = new FakeTerminal();
  terminal.onWrite = () => {
    clock += 2;
  };
  const tui = {
    terminal,
    requestRender(_force = false) {},
    requestImmediateRender() {},
    render() {
      clock += 3;
      return ["界🙂"];
    },
    compositeOverlays() {
      clock += 1;
      this.terminal.write("é");
      clock += 1;
    },
    handleTerminalInput(_data: string) {
      clock += 4;
      this.requestRender();
      this.requestImmediateRender();
    },
    doRender() {
      const lines = this.render();
      clock += 5; // Inline diff work (not a callable method).
      this.compositeOverlays();
      this.terminal.write(lines.join("\n"));
      return "synchronous-result";
    },
  };
  return {
    tui,
    terminal,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("terminal render profiler", () => {
  test("includes layout, inline diff, nested helpers and synchronous write; excludes wait", () => {
    const { tui, now, advance } = fixture();
    const profiler = attachTerminalProfiler(tui, { now });
    tui.handleTerminalInput("secret input is never retained"); // 4 ms input handling
    advance(20); // event-loop delay
    expect(tui.doRender()).toBe("synchronous-result");
    const frame = profiler.snapshot().frames[0]!;
    expect(frame.durationMs).toBe(14); // layout 3 + diff 5 + helper 2 + writes 4
    expect(frame.requestDelayMs).toBe(20);
    expect(frame.inputDelayMs).toBe(24);
    expect(frame.requestCount).toBe(2);
    expect(frame.inputCount).toBe(1);
    expect(frame.phasesMs).toEqual({ render: 3, compositeOverlays: 2, "terminal.write": 4 });
    expect(frame.unattributedMs).toBe(5);
    expect(frame.outputBytes).toBe(Buffer.byteLength("é界🙂"));
    expect(frame.writeCount).toBe(2);
    expect(frame.failed).toBe(false);
    expect(JSON.stringify(frame)).not.toContain("secret");
    profiler.dispose();
  });

  test("coalesces oldest request/input delays and keeps requests made inside frame for next frame", () => {
    const { tui, now, advance } = fixture();
    const originalRender = tui.render;
    tui.render = function () {
      this.requestRender();
      return originalRender.call(this);
    };
    const profiler = attachTerminalProfiler(tui, { now });
    tui.requestRender();
    advance(10);
    tui.handleTerminalInput("a");
    advance(6);
    tui.handleTerminalInput("b");
    tui.doRender();
    let frame = profiler.snapshot().frames[0]!;
    expect(frame.requestCount).toBe(5);
    expect(frame.requestDelayMs).toBe(24);
    expect(frame.inputCount).toBe(2);
    expect(frame.inputDelayMs).toBe(14);
    advance(6);
    tui.doRender();
    frame = profiler.snapshot().frames[1]!;
    expect(frame.requestCount).toBe(1);
    expect(frame.requestDelayMs).toBe(20);
    expect(frame.inputDelayMs).toBeNull();
    profiler.dispose();
  });

  test("frame entry consumes requests without ending the current input dispatch", () => {
    const { tui, now, advance } = fixture();
    const error = new Error("input failed after rendering");
    tui.handleTerminalInput = () => {
      advance(4);
      tui.requestRender();
      advance(6);
      tui.doRender();
      advance(3);
      tui.requestImmediateRender();
      advance(5);
      tui.doRender();
      throw error;
    };
    const profiler = attachTerminalProfiler(tui, { now });
    try {
      expect(() => tui.handleTerminalInput("input")).toThrow(error);
      const frames = profiler.snapshot().frames;
      expect(frames.map((frame) => frame.requestCount)).toEqual([1, 1]);
      expect(frames.map((frame) => frame.requestDelayMs)).toEqual([6, 5]);
      expect(frames.map((frame) => frame.inputCount)).toEqual([1, 1]);
      expect(frames.map((frame) => frame.inputDelayMs)).toEqual([10, 32]);
      tui.requestRender();
      tui.doRender();
      expect(profiler.snapshot().frames[2]!.inputDelayMs).toBeNull();
    } finally {
      profiler.dispose();
    }
  });

  test("a throwing nested input dispatch restores the outer association", () => {
    const { tui, now, advance } = fixture();
    const error = new Error("nested input failed");
    tui.handleTerminalInput = (data: string) => {
      if (data === "inner") {
        advance(3);
        throw error;
      }
      advance(4);
      expect(() => tui.handleTerminalInput("inner")).toThrow(error);
      tui.requestRender();
      advance(2);
      tui.doRender();
    };
    const profiler = attachTerminalProfiler(tui, { now });
    try {
      tui.handleTerminalInput("outer");
      const frame = profiler.snapshot().frames[0]!;
      expect(frame.inputCount).toBe(1);
      expect(frame.inputDelayMs).toBe(9);
      expect(frame.requestDelayMs).toBe(2);
    } finally {
      profiler.dispose();
    }
  });

  test("ignored input is not associated with an unrelated later frame", () => {
    const { tui, now, advance } = fixture();
    tui.handleTerminalInput = () => {};
    const profiler = attachTerminalProfiler(tui, { now });
    tui.handleTerminalInput("ignored");
    advance(100);
    tui.doRender();
    const frame = profiler.snapshot().frames[0]!;
    expect(frame.inputDelayMs).toBeNull();
    expect(frame.requestDelayMs).toBeNull();
    profiler.dispose();
  });

  test("bounds retained samples, detaches snapshots, separates non-frame writes and clears", () => {
    const { tui, now } = fixture();
    const profiler = attachTerminalProfiler(tui, { now, capacity: 2 });
    tui.terminal.write("outside");
    for (let i = 0; i < 4; i++) tui.doRender();
    const snapshot = profiler.snapshot();
    expect(snapshot.frames.map((frame) => frame.id)).toEqual([3, 4]);
    expect(snapshot.totalFrames).toBe(4);
    expect(snapshot.droppedFrames).toBe(2);
    expect(snapshot.outsideFrameWriteCount).toBe(1);
    expect(snapshot.outsideFrameOutputBytes).toBe(7);
    expect(snapshot.writeCount).toBe(9);
    expect(snapshot.outputBytes).toBe(7 + 4 * 9);
    snapshot.frames[0]!.phasesMs.render = 999;
    expect(profiler.snapshot().frames[0]!.phasesMs.render).toBe(3);
    tui.requestRender();
    profiler.clear();
    expect(profiler.snapshot()).toEqual({
      frames: [],
      totalFrames: 0,
      droppedFrames: 0,
      outputBytes: 0,
      writeCount: 0,
      outsideFrameOutputBytes: 0,
      outsideFrameWriteCount: 0,
    });
    tui.doRender();
    expect(profiler.snapshot().frames[0]!.requestDelayMs).toBeNull();
    profiler.dispose();
  });

  test("records failed sync renders and writes without replacing exceptions", () => {
    const { tui, terminal, now } = fixture();
    const error = new Error("write failed");
    terminal.onWrite = () => {
      throw error;
    };
    const profiler = attachTerminalProfiler(tui, { now });
    let caught: unknown;
    try {
      tui.doRender();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(error);
    const frame = profiler.snapshot().frames[0]!;
    expect(frame.failed).toBe(true);
    expect(frame.durationMs).toBe(9);
    expect(frame.outputBytes).toBe(2);
    expect(frame.writeCount).toBe(1);
    profiler.dispose();
  });

  test("restores descriptors and inherited methods; dispose is idempotent and reattach works", () => {
    const { tui, terminal, now } = fixture();
    const original = Object.getOwnPropertyDescriptor(tui, "doRender");
    const write = terminal.write;
    const profiler = attachTerminalProfiler(tui, { now });
    const retainedWrapper = tui.doRender;
    expect(Object.hasOwn(terminal, "write")).toBe(true);
    expect(() => attachTerminalProfiler(tui)).toThrow("already");
    profiler.dispose();
    profiler.dispose();
    expect(Object.getOwnPropertyDescriptor(tui, "doRender")).toEqual(original);
    expect(Object.hasOwn(terminal, "write")).toBe(false);
    expect(terminal.write).toBe(write);
    retainedWrapper.call(tui);
    expect(profiler.snapshot().totalFrames).toBe(0);
    const again = attachTerminalProfiler(tui, { now });
    tui.doRender();
    expect(again.snapshot().totalFrames).toBe(1);
    again.dispose();
  });

  test("does not overwrite later adapters and rolls back failed attachment", () => {
    const { tui, terminal } = fixture();
    const profiler = attachTerminalProfiler(tui);
    const replacement = () => "replacement";
    tui.doRender = replacement;
    profiler.dispose();
    expect(tui.doRender).toBe(replacement);
    Object.defineProperty(tui, "render", { configurable: false, writable: false, value: tui.render });
    expect(() => attachTerminalProfiler(tui)).toThrow();
    expect(tui.doRender).toBe(replacement);
    expect(Object.hasOwn(terminal, "write")).toBe(false);
  });

  test("validates opt-in configuration", () => {
    const { tui } = fixture();
    for (const capacity of [0, -1, 0.5, Infinity, NaN]) {
      expect(() => attachTerminalProfiler(tui, { capacity })).toThrow("capacity");
    }
    expect(() => attachTerminalProfiler({ terminal: tui.terminal, requestRender() {} })).toThrow("concrete");
  });
});

for (const mode of ["regular", "fullscreen"] as const) {
  test(mode + " real Pi frame includes component layout and terminal writes", () => {
    let clock = 0;
    const terminal = new FakeTerminal();
    terminal.onWrite = () => {
      clock += 2;
    };
    const tui = mode === "regular" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
    const runtime = tui as unknown as { doRender(): void; altScreenActive?: boolean };
    if (mode === "fullscreen") runtime.altScreenActive = true;
    let layoutCalls = 0;
    tui.addChild({
      render() {
        layoutCalls++;
        clock += 3;
        return ["界🙂 layout"];
      },
      invalidate() {},
    });
    const profiler = attachTerminalProfiler(tui, { now: () => clock });
    try {
      runtime.doRender();
      let frame = profiler.snapshot().frames[0]!;
      expect(layoutCalls).toBeGreaterThan(0);
      expect(frame.durationMs).toBe(3 * layoutCalls + 2 * terminal.writes.length);
      expect(frame.phasesMs["terminal.write"]).toBe(2 * terminal.writes.length);
      expect(frame.writeCount).toBe(terminal.writes.length);
      expect(frame.outputBytes).toBe(terminal.writes.reduce((n, s) => n + Buffer.byteLength(s), 0));
      if (mode === "regular") expect(frame.phasesMs.render).toBe(3 * layoutCalls);
      else {
        expect(frame.phasesMs.render).toBeUndefined();
        expect(frame.unattributedMs).toBe(3 * layoutCalls);
      }
      // An unchanged frame is still a synchronous render, even if output is tiny/empty.
      runtime.doRender();
      expect(profiler.snapshot().totalFrames).toBe(2);
      frame = profiler.snapshot().frames[1]!;
      expect(frame.failed).toBe(false);
    } finally {
      profiler.dispose();
    }
  });

  test(mode + " input-immediate microtask excludes input handling and queue delay", async () => {
    let clock = 100;
    const terminal = new FakeTerminal();
    terminal.onWrite = () => {
      clock += 2;
    };
    const tui = mode === "regular" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
    const runtime = tui as unknown as {
      doRender(): void;
      handleTerminalInput(data: string): void;
      altScreenActive?: boolean;
    };
    if (mode === "fullscreen") runtime.altScreenActive = true;
    const component = {
      focused: false,
      render() {
        clock += 3;
        return ["input changed"];
      },
      handleInput() {
        clock += 4;
      },
      invalidate() {},
    };
    tui.addChild(component);
    tui.setFocus(component);
    const profiler = attachTerminalProfiler(tui, { now: () => clock });
    try {
      runtime.handleTerminalInput("a");
      expect(profiler.snapshot().totalFrames).toBe(0); // wrapper must NOT await/doRender early
      clock += 20;
      await Promise.resolve(); // scheduler boundary only, never wrap synchronous doRender in await
      const frame = profiler.snapshot().frames[0]!;
      expect(frame.requestDelayMs).toBe(20);
      expect(frame.inputDelayMs).toBe(24);
      expect(frame.inputCount).toBe(1);
      expect(frame.durationMs).toBe(3 + 2 * frame.writeCount);
    } finally {
      profiler.dispose();
    }
  });
}

for (const mode of ["regular", "fullscreen"] as const) {
  test(mode + " default wall clock encloses measured synchronous layout/write work", () => {
    let workMs = 0;
    function work() {
      const start = performance.now();
      while (performance.now() - start < 1) {} // Known synchronous work, not a performance threshold.
      workMs += performance.now() - start;
    }
    const terminal = new FakeTerminal();
    terminal.onWrite = work;
    const tui = mode === "regular" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
    const runtime = tui as unknown as { doRender(): void; altScreenActive?: boolean };
    if (mode === "fullscreen") runtime.altScreenActive = true;
    tui.addChild({
      render() {
        work();
        return ["wall clock"];
      },
      invalidate() {},
    });
    const profiler = attachTerminalProfiler(tui);
    try {
      const before = performance.now();
      runtime.doRender(); // Deliberately synchronous, no await boundary.
      const outerMs = performance.now() - before;
      const frame = profiler.snapshot().frames[0]!;
      expect(frame.durationMs).toBeGreaterThanOrEqual(workMs);
      expect(frame.durationMs).toBeLessThanOrEqual(outerMs);
      expect(frame.phasesMs["terminal.write"]).toBeGreaterThan(0);
    } finally {
      profiler.dispose();
    }
  });
}

test("custom document methods attribute fullscreen work without imported-function patches", () => {
  let clock = 0;
  const terminal = new FakeTerminal();
  terminal.onWrite = () => {
    clock += 2;
  };
  const tui = new TuiAltScreen(terminal);
  const runtime = tui as unknown as { doRender(): void; altScreenActive: boolean };
  runtime.altScreenActive = true;
  const document = {
    render() {
      clock += 3;
      return ["named document span"];
    },
    invalidate() {},
  };
  const original = document.render;
  tui.addChild(document);
  const profiler = attachTerminalProfiler(tui, {
    now: () => clock,
    observe: [{ target: document, method: "render", name: "history.document.render" }],
  });
  try {
    runtime.doRender();
    const frame = profiler.snapshot().frames[0]!;
    expect(frame.phasesMs["history.document.render"]).toBeGreaterThanOrEqual(3);
    expect(frame.durationMs).toBe(frame.phasesMs["history.document.render"]! + 2 * frame.writeCount);
    expect(frame.unattributedMs).toBe(0);
  } finally {
    profiler.dispose();
  }
  expect(document.render).toBe(original);
  expect(() =>
    attachTerminalProfiler(tui, { observe: [{ target: document, method: "missing", name: "bad" }] }),
  ).toThrow("Observed phase method is missing");
  expect(document.render).toBe(original);
});
