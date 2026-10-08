import { stripVTControlCharacters } from "node:util";
import { expect, test } from "bun:test";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Input, type Terminal, TuiAltScreen, TuiMainScreen } from "@earendil-works/pi-tui";
import { attachTerminalActionProfiler, type ActionProfilerScheduler } from "../../scripts/terminal-perf/action-profiler";
import { attachTerminalProfiler } from "../../scripts/terminal-perf/profiler";

class ManualScheduler implements ActionProfilerScheduler {
  clock = 0;
  private id = 0;
  callbacks = new Map<number, { at: number; callback: () => void }>();
  setTimeout(callback: () => void, delay: number) {
    const id = ++this.id;
    this.callbacks.set(id, { at: this.clock + delay, callback });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.callbacks.delete(handle as number);
  }
  advance(ms: number) {
    this.clock += ms;
  }
  fireNext() {
    const first = [...this.callbacks.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (!first) throw new Error("No scheduled callback");
    this.clock = Math.max(this.clock, first[1].at);
    this.callbacks.delete(first[0]);
    first[1].callback();
  }
}

function rendererFixture() {
  const scheduler = new ManualScheduler();
  const advance = (ms: number) => scheduler.advance(ms);
  const terminal = {
    write(_data: string) {
      advance(2);
    },
  };
  const renderer = {
    terminal,
    requestRender() {
      advance(1);
    },
    requestImmediateRender() {
      advance(2);
    },
    handleTerminalInput(_data: string) {
      advance(3);
      this.requestRender();
      advance(4);
    },
    doRender() {
      advance(5);
      terminal.write("frame");
      return "frame-result";
    },
  };
  return { scheduler, advance, renderer };
}

function profiledFixture(capacity = 32, heartbeatIntervalMs: number | null = null) {
  const fixture = rendererFixture();
  const profiler = attachTerminalActionProfiler(fixture.renderer, {
    now: () => fixture.scheduler.clock,
    scheduler: fixture.scheduler,
    heartbeatIntervalMs,
    capacity,
    traceInfo: { fixtureVersion: "action-unit-v1", contentFingerprint: "fixed frame" },
  });
  return { ...fixture, profiler };
}

function span(profiler: ReturnType<typeof attachTerminalActionProfiler>, label: string) {
  const value = profiler.snapshot().spans.find((s) => s.label === label);
  if (!value) throw new Error("Missing span: " + label);
  return value;
}

test("sync input and nested action are distinct from end-to-frame and request latency", () => {
  const { renderer, profiler, advance } = profiledFixture();
  try {
    const result = profiler.runAction("Enter", () => {
      advance(2);
      renderer.handleTerminalInput("private text");
      advance(3);
      return "same result";
    });
    expect(result).toBe("same result");
    expect(span(profiler, "Enter")).toMatchObject({ parentId: null, syncDurationMs: 13, syncExclusiveMs: 5 });
    const input = span(profiler, "renderer.handleTerminalInput");
    expect(input).toMatchObject({ syncDurationMs: 8, syncExclusiveMs: 7, parentId: span(profiler, "Enter").id });
    expect(span(profiler, "renderer.requestRender")).toMatchObject({
      syncDurationMs: 1,
      syncExclusiveMs: 1,
      parentId: input.id,
    });
    advance(20); // Scheduler delay / other work, never CPU attributed to Enter.
    expect(renderer.doRender()).toBe("frame-result");
    expect(profiler.snapshot().frameEntries[0]).toMatchObject({
      enteredAtMs: 33,
      requestCount: 1,
      firstRequestAtMs: 5,
      firstRequestSyncEndedAtMs: 6,
      firstRequestToFrameEntryMs: 28,
      firstRequestSyncEndToFrameEntryMs: 27,
      firstFrameForActions: [
        {
          rootSpanId: span(profiler, "Enter").id,
          label: "Enter",
          actionStartedAtMs: 0,
          actionSyncEndedAtMs: 13,
          actionStartToFirstFrameEntryMs: 33,
          actionSyncEndToFirstFrameEntryMs: 20,
        },
      ],
    });
    expect(span(profiler, "renderer.doRender").syncDurationMs).toBe(7);
    expect(JSON.stringify(profiler.snapshot())).not.toContain("private text");
  } finally {
    profiler.dispose();
  }
});

test("observed async prefix preserves promise identity and excludes awaited work", async () => {
  const { renderer, scheduler, advance } = rendererFixture();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let returned!: Promise<string>;
  const instance = {
    name: "receiver",
    async method(arg: string) {
      expect(this.name).toBe("receiver");
      expect(arg).toBe("argument");
      advance(6);
      await wait;
      advance(40);
      return "done";
    },
    call(arg: string) {
      returned = this.method(arg);
      return returned;
    },
  };
  const profiler = attachTerminalActionProfiler(renderer, {
    now: () => scheduler.clock,
    heartbeatIntervalMs: null,
    observe: [
      { target: instance, method: "call", name: "submit" },
      { target: instance, method: "method", name: "async-prefix" },
    ],
  });
  try {
    const result = profiler.runAction("send", () => instance.call("argument"));
    expect(result).toBe(returned);
    expect(span(profiler, "send").syncDurationMs).toBe(6);
    expect(span(profiler, "send").syncExclusiveMs).toBe(0);
    expect(span(profiler, "submit").syncExclusiveMs).toBe(0);
    expect(span(profiler, "async-prefix").syncDurationMs).toBe(6);
    advance(1000);
    release();
    expect(await result).toBe("done");
    expect(profiler.snapshot().totalSpans).toBe(3);
    expect(span(profiler, "async-prefix").syncDurationMs).toBe(6);
    const rejected = Promise.reject(new Error("async rejection"));
    const observed = profiler.runAction("rejects later", () => rejected);
    expect(observed).toBe(rejected);
    await expect(observed).rejects.toThrow("async rejection");
    expect(span(profiler, "rejects later").syncThrew).toBe(false);
  } finally {
    profiler.dispose();
  }
});

test("sync exceptions retain identity, restore stack, and frame failures remain visible", () => {
  const { renderer, scheduler, advance } = rendererFixture();
  const error = { code: "original exception" };
  const instance = {
    fail() {
      advance(4);
      throw error;
    },
  };
  renderer.doRender = () => {
    advance(5);
    throw error;
  };
  const profiler = attachTerminalActionProfiler(renderer, {
    now: () => scheduler.clock,
    heartbeatIntervalMs: null,
    observe: [{ target: instance, method: "fail", name: "event.fail" }],
  });
  try {
    let caught: unknown;
    try {
      profiler.runAction("failure", () => instance.fail());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(error);
    expect(span(profiler, "event.fail")).toMatchObject({ syncDurationMs: 4, syncThrew: true });
    expect(span(profiler, "failure")).toMatchObject({ syncDurationMs: 4, syncExclusiveMs: 0, syncThrew: true });
    try {
      renderer.doRender();
    } catch (e) {
      expect(e).toBe(error);
    }
    expect(profiler.snapshot().frameEntries[0]?.syncThrew).toBe(true);
    profiler.runAction("next", () => advance(2));
    expect(span(profiler, "next")).toMatchObject({ parentId: null, syncDurationMs: 2 });
  } finally {
    profiler.dispose();
  }
});

test("coalesced requests link multiple roots once and retain requests made during frame", () => {
  const { renderer, scheduler, advance } = rendererFixture();
  renderer.doRender = function () {
    advance(5);
    this.requestRender();
    return "render";
  };
  const profiler = attachTerminalActionProfiler(renderer, { now: () => scheduler.clock, heartbeatIntervalMs: null });
  try {
    profiler.runAction("tool start", () => {
      renderer.requestRender();
      renderer.requestImmediateRender();
    });
    profiler.runAction("tool update", () => renderer.requestRender());
    advance(10);
    renderer.doRender();
    const first = profiler.snapshot().frameEntries[0]!;
    expect(first.requestCount).toBe(3);
    expect(first.firstRequestToFrameEntryMs).toBe(14);
    expect(first.firstFrameForActions.map((link) => link.label)).toEqual(["tool start", "tool update"]);
    advance(10);
    renderer.doRender();
    const second = profiler.snapshot().frameEntries[1]!;
    expect(second.requestCount).toBe(1);
    expect(second.firstFrameForActions[0]?.label).toBe("renderer.doRender");
    expect(second.firstRequestSyncEndToFrameEntryMs).toBe(10);
  } finally {
    profiler.dispose();
  }
});

test("synchronous render request does not report negative post-return scheduling latency", () => {
  const { renderer, scheduler, advance } = rendererFixture();
  renderer.requestImmediateRender = function () {
    advance(2);
    this.doRender();
    advance(1);
  };
  const profiler = attachTerminalActionProfiler(renderer, { now: () => scheduler.clock, heartbeatIntervalMs: null });
  try {
    profiler.runAction("immediate", () => renderer.requestImmediateRender());
    const frame = profiler.snapshot().frameEntries[0]!;
    expect(frame).toMatchObject({
      enteredAtMs: 2,
      firstRequestSyncEndedAtMs: 10,
      firstRequestSyncEndToFrameEntryMs: null,
    });
    expect(frame.firstFrameForActions[0]).toMatchObject({
      actionSyncEndedAtMs: 10,
      actionSyncEndToFirstFrameEntryMs: null,
    });
    expect(span(profiler, "immediate").syncDurationMs).toBe(10);
  } finally {
    profiler.dispose();
  }
});

test("request return finalizes its consumed frame, not the next request batch", () => {
  const { renderer, scheduler, advance } = rendererFixture();
  let renderCount = 0;
  renderer.doRender = function () {
    advance(5);
    if (++renderCount === 1) this.requestRender();
    return "frame-result";
  };
  renderer.requestImmediateRender = function () {
    advance(2);
    this.doRender();
    advance(1);
  };
  const profiler = attachTerminalActionProfiler(renderer, { now: () => scheduler.clock, heartbeatIntervalMs: null });
  try {
    const duringAction = profiler.runAction("two immediate frames", () => {
      renderer.requestImmediateRender();
      const snapshot = profiler.snapshot();
      renderer.requestImmediateRender();
      return snapshot;
    });
    const [first, second] = profiler.snapshot().frameEntries;
    expect(first).toMatchObject({
      enteredAtMs: 2,
      requestCount: 1,
      firstRequestAtMs: 0,
      firstRequestSyncEndedAtMs: 9,
      firstRequestSyncEndToFrameEntryMs: null,
    });
    expect(first!.firstFrameForActions).toHaveLength(1);
    expect(first!.firstFrameForActions[0]).toMatchObject({
      label: "two immediate frames",
      actionSyncEndedAtMs: 17,
      actionSyncEndToFirstFrameEntryMs: null,
    });
    // The in-frame request starts the next batch; the second immediate request joins it.
    expect(second).toMatchObject({
      enteredAtMs: 11,
      requestCount: 2,
      firstRequestAtMs: 7,
      firstRequestSyncEndedAtMs: 8,
      firstRequestSyncEndToFrameEntryMs: 3,
      firstFrameForActions: [],
    });
    expect(duringAction.frameEntries[0]!.firstFrameForActions[0]!.actionSyncEndedAtMs).toBeNull();
    expect(span(profiler, "two immediate frames").syncDurationMs).toBe(17);
  } finally {
    profiler.dispose();
  }
});

test("heartbeat exposes deferred work independent of span CPU, with no catch-up storm", () => {
  const { scheduler, profiler, advance } = profiledFixture(2, 4);
  try {
    advance(3); // Below interval: heartbeat cannot resolve this segment individually.
    scheduler.fireNext(); // at 4
    expect(profiler.snapshot().heartbeats[0]).toMatchObject({ expectedAtMs: 4, observedAtMs: 4, eventLoopDelayMs: 0 });
    scheduler.setTimeout(() => advance(30), 1);
    scheduler.fireNext(); // deferred main-thread work at 5 through 35, outside runAction
    scheduler.fireNext(); // heartbeat scheduled for 8, actually observed at 35
    expect(profiler.snapshot().heartbeats[1]).toEqual({
      expectedAtMs: 8,
      observedAtMs: 35,
      previousObservedAtMs: 4,
      intervalMs: 4,
      eventLoopDelayMs: 27,
      elapsedSincePreviousMs: 31,
    });
    expect(profiler.snapshot().totalSpans).toBe(0); // not inferred from the delay
    expect(scheduler.callbacks.size).toBe(1);
    scheduler.fireNext(); // next due 39, not 12
    expect(profiler.snapshot().heartbeats.at(-1)?.expectedAtMs).toBe(39);
    expect(profiler.snapshot().droppedHeartbeats).toBe(1);
  } finally {
    profiler.dispose();
  }
  expect(scheduler.callbacks.size).toBe(0);
});

test("bounded buffers, pending links, copies, clear, and monotonic trace IDs", () => {
  const { renderer, profiler, advance } = profiledFixture(2);
  try {
    for (let i = 0; i < 5; i++) profiler.runAction("action " + i, () => renderer.requestRender());
    renderer.doRender();
    expect(profiler.snapshot()).toMatchObject({ totalSpans: 11, droppedSpans: 9, droppedPendingActionLinks: 3 });
    const copy = profiler.snapshot();
    expect(copy.frameEntries[0]?.firstFrameForActions.length).toBe(2);
    expect(copy.frameEntries[0]?.droppedActionLinks).toBe(3);
    copy.spans[0]!.label = "edited";
    copy.frameEntries[0]!.firstFrameForActions[0]!.label = "edited";
    copy.traceInfo.fixtureVersion = "edited";
    expect(JSON.stringify(profiler.snapshot())).not.toContain("edited");
    renderer.doRender();
    renderer.doRender();
    expect(profiler.snapshot().droppedFrameEntries).toBe(1);
    const previousId = profiler.snapshot().spans.at(-1)!.id;
    profiler.runAction("pending before clear", () => renderer.requestRender());
    profiler.clear();
    expect(profiler.snapshot()).toMatchObject({ totalSpans: 0, totalFrameEntries: 0, droppedPendingActionLinks: 0 });
    advance(10);
    renderer.doRender();
    expect(profiler.snapshot().frameEntries[0]).toMatchObject({ requestCount: 0, firstFrameForActions: [] });
    expect(profiler.snapshot().spans[0]!.id).toBeGreaterThan(previousId);
  } finally {
    profiler.dispose();
  }
});

test("instance descriptors restored, disposal idempotent, failures roll back, later patches survive", () => {
  const { renderer, scheduler } = rendererFixture();
  class Events {
    method() {
      return this;
    }
  }
  const instance = new Events();
  const before = Object.getOwnPropertyDescriptors(renderer);
  const profiler = attachTerminalActionProfiler(renderer, {
    scheduler,
    now: () => scheduler.clock,
    observe: [{ target: instance, method: "method", name: "event" }],
  });
  expect(Object.hasOwn(instance, "method")).toBe(true);
  expect(instance.method()).toBe(instance);
  expect(() => attachTerminalActionProfiler(renderer)).toThrow("already");
  profiler.dispose();
  profiler.dispose();
  expect(Object.getOwnPropertyDescriptors(renderer)).toEqual(before);
  expect(Object.hasOwn(instance, "method")).toBe(false);
  expect(scheduler.callbacks.size).toBe(0);
  const total = profiler.snapshot().totalSpans;
  expect(profiler.runAction("disposed", () => "value")).toBe("value");
  expect(profiler.snapshot().totalSpans).toBe(total);
  expect(() =>
    attachTerminalActionProfiler(renderer, {
      observe: [
        { target: instance, method: "method", name: "good" },
        { target: instance, method: "missing", name: "bad" },
      ],
    }),
  ).toThrow("missing");
  expect(Object.getOwnPropertyDescriptors(renderer)).toEqual(before);
  expect(Object.hasOwn(instance, "method")).toBe(false);
  expect(() =>
    attachTerminalActionProfiler(renderer, { observe: [{ target: renderer, method: "doRender", name: "duplicate" }] }),
  ).toThrow("twice");
  const another = attachTerminalActionProfiler(renderer, { heartbeatIntervalMs: null });
  const replacement = () => "new adapter";
  renderer.doRender = replacement;
  another.dispose();
  expect(renderer.doRender).toBe(replacement);
  for (const capacity of [0, -1, 1.5])
    expect(() => attachTerminalActionProfiler(renderer, { capacity })).toThrow("capacity");
  for (const heartbeatIntervalMs of [0, -1, NaN])
    expect(() => attachTerminalActionProfiler(renderer, { heartbeatIntervalMs })).toThrow("interval");
});

class FakeTerminal implements Terminal {
  columns = 80;
  rows = 24;
  kittyProtocolActive = false;
  writes: string[] = [];
  start(_input: (data: string) => void, _resize: () => void) {}
  stop() {}
  async drainInput() {}
  write(data: string) {
    this.writes.push(data);
  }
  moveBy() {}
  hideCursor() {}
  showCursor() {}
  clearLine() {}
  clearFromCursor() {}
  clearScreen() {}
  setProgramStatus() {}
  setTitle() {}
  setProgress() {}
}

for (const mode of ["regular", "fullscreen"] as const) {
  for (const order of ["frame-first", "action-first"] as const) {
    test(mode + " " + order + " composes real SDK Input Enter prefix with scheduled frame", async () => {
      let clock = 100;
      const terminal = new FakeTerminal();
      const tui = mode === "regular" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
      const runtime = tui as unknown as { handleTerminalInput(data: string): void; altScreenActive?: boolean };
      if (mode === "fullscreen") runtime.altScreenActive = true;
      const input = new Input();
      input.setValue("deterministic send");
      let release!: () => void;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const submission = {
        async send(value: string) {
          expect(value).toBe("deterministic send");
          clock += 12;
          await wait;
          clock += 100;
        },
      };
      let sent!: Promise<void>;
      input.onSubmit = (value) => {
        sent = submission.send(value);
      };
      tui.addChild(input);
      tui.setFocus(input);
      const original = Object.getOwnPropertyDescriptors(tui);
      const actionOptions = {
        now: () => clock,
        heartbeatIntervalMs: null,
        observe: [
          { target: input, method: "handleInput", name: "sdk.Input.handleInput" },
          { target: submission, method: "send", name: "submission.sync-prefix" },
        ],
      };
      const frameProfiler = order === "frame-first" ? attachTerminalProfiler(tui, { now: () => clock }) : undefined;
      const actions = attachTerminalActionProfiler(tui, actionOptions);
      const frames = frameProfiler ?? attachTerminalProfiler(tui, { now: () => clock });
      try {
        runtime.handleTerminalInput("\r");
        expect(span(actions, "renderer.handleTerminalInput").syncDurationMs).toBe(12);
        expect(span(actions, "submission.sync-prefix").syncDurationMs).toBe(12);
        expect(frames.snapshot().totalFrames).toBe(0);
        expect(actions.snapshot().totalFrameEntries).toBe(0);
        clock += 20;
        await Promise.resolve(); // SDK requestImmediateRender microtask, not forced renderNow.
        expect(frames.snapshot().frames[0]).toMatchObject({ durationMs: 0, requestDelayMs: 20, inputDelayMs: 32 });
        expect(actions.snapshot().frameEntries[0]?.firstFrameForActions[0]).toMatchObject({
          actionStartToFirstFrameEntryMs: 32,
          actionSyncEndToFirstFrameEntryMs: 20,
        });
        expect(stripVTControlCharacters(terminal.writes.join(""))).toContain("deterministic send");
        release();
        await sent;
        expect(span(actions, "submission.sync-prefix").syncDurationMs).toBe(12);
      } finally {
        if (order === "frame-first") {
          actions.dispose();
          frames.dispose();
        } else {
          frames.dispose();
          actions.dispose();
        }
      }
      for (const key of ["doRender", "handleTerminalInput", "requestRender", "requestImmediateRender"]) {
        expect(Object.getOwnPropertyDescriptor(tui, key)).toEqual(original[key]);
      }
    });
  }
}

test("real SDK tool update/finish methods are observed before render", () => {
  initTheme("dark", false);
  const tui = new TuiMainScreen(new FakeTerminal());
  const tool = new ToolExecutionComponent(
    "bash",
    "fixed-call",
    { command: "printf fixture" },
    { showImages: false },
    undefined,
    tui,
    process.cwd(),
  );
  tui.addChild(tool);
  const original = tool.updateResult;
  const profiler = attachTerminalActionProfiler(tui, {
    heartbeatIntervalMs: null,
    observe: [
      { target: tool, method: "updateArgs", name: "sdk.tool.updateArgs" },
      { target: tool, method: "markExecutionStarted", name: "sdk.tool.start" },
      { target: tool, method: "updateResult", name: "sdk.tool.updateResult" },
      { target: tool, method: "updateDisplay", name: "sdk.tool.updateDisplay" },
    ],
  });
  try {
    profiler.runAction("tool lifecycle", () => {
      tool.updateArgs({ command: "printf changed" });
      tool.markExecutionStarted();
      tool.updateResult({ content: [{ type: "text", text: "chunk" }], isError: false }, true);
      tool.updateResult({ content: [{ type: "text", text: "finished" }], isError: false });
    });
    const samples = profiler.snapshot().spans;
    expect(samples.filter((s) => s.label === "sdk.tool.updateResult")).toHaveLength(2);
    expect(samples.filter((s) => s.label === "sdk.tool.updateDisplay")).toHaveLength(4);
    expect(samples.filter((s) => s.label === "sdk.tool.updateDisplay").every((s) => s.parentId !== null)).toBe(true);
    expect(profiler.snapshot().totalFrameEntries).toBe(0);
    expect(tool.render(80).join("\n")).toContain("finished");
  } finally {
    profiler.dispose();
  }
  expect(tool.updateResult).toBe(original);
});

test("real induced pre-frame Enter stall encloses known synchronous work; heartbeat is separate", async () => {
  const terminal = new FakeTerminal();
  const tui = new TuiMainScreen(terminal);
  const runtime = tui as unknown as { handleTerminalInput(data: string): void };
  const input = new Input();
  input.setValue("stall fixture");
  let workStarted = 0,
    workEnded = 0;
  input.onSubmit = () => {
    workStarted = performance.now();
    while (performance.now() - workStarted < 12) {} // Induced work, NOT a pass/fail timing budget.
    workEnded = performance.now();
  };
  tui.addChild(input);
  tui.setFocus(input);
  let tick!: () => void;
  const firstTick = new Promise<void>((resolve) => {
    tick = resolve;
  });
  const scheduler: ActionProfilerScheduler = {
    setTimeout(callback, delay) {
      return setTimeout(() => {
        callback();
        tick();
      }, delay);
    },
    clearTimeout(handle) {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
  const frames = attachTerminalProfiler(tui);
  const actions = attachTerminalActionProfiler(tui, { scheduler, heartbeatIntervalMs: 4 });
  try {
    const outerStart = performance.now();
    runtime.handleTerminalInput("\r");
    const outerEnd = performance.now();
    const inputSpan = span(actions, "renderer.handleTerminalInput");
    expect(inputSpan.syncDurationMs).toBeGreaterThanOrEqual(workEnded - workStarted);
    expect(inputSpan.syncDurationMs).toBeLessThanOrEqual(outerEnd - outerStart);
    expect(frames.snapshot().totalFrames).toBe(0); // Stall happened before doRender could run.
    await firstTick;
    const heartbeat = actions.snapshot().heartbeats[0]!;
    expect(heartbeat.observedAtMs).toBeGreaterThanOrEqual(workEnded);
    expect(heartbeat.eventLoopDelayMs).toBe(Math.max(0, heartbeat.observedAtMs - heartbeat.expectedAtMs));
    const frame = frames.snapshot().frames[0]!;
    expect(frame.startedAtMs).toBeGreaterThanOrEqual(inputSpan.endedAtMs);
    expect(actions.snapshot().frameEntries[0]?.firstFrameForActions[0]?.actionSyncEndedAtMs).toBe(inputSpan.endedAtMs);
  } finally {
    actions.dispose();
    frames.dispose();
  }
});

test("actions without requests are not associated with unrelated later frames", () => {
  const { renderer, profiler, advance } = profiledFixture();
  try {
    profiler.runAction("no visible mutation", () => advance(3));
    renderer.doRender();
    expect(profiler.snapshot().frameEntries[0]?.firstFrameForActions).toEqual([]);
    expect(span(profiler, "no visible mutation").syncDurationMs).toBe(3);
    profiler.runAction("requested", () => renderer.requestRender());
    renderer.doRender();
    renderer.doRender();
    expect(profiler.snapshot().frameEntries[1]?.firstFrameForActions.map((link) => link.label)).toEqual(["requested"]);
    expect(profiler.snapshot().frameEntries[2]?.firstFrameForActions).toEqual([]);
  } finally {
    profiler.dispose();
  }
});
