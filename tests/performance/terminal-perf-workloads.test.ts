import { describe, expect, test } from "bun:test";
import { Container, type TuiAltScreen } from "@earendil-works/pi-tui";
import { attachTerminalProfiler, type TerminalProfiler } from "../../scripts/terminal-perf/profiler";
import {
  createWorkloads,
  FakeTerminal,
  type TerminalWorkload,
  type WorkloadSample,
  workloadModes,
} from "../../scripts/terminal-perf/workloads";

function run(workload: TerminalWorkload, steps = 3): WorkloadSample[] {
  try {
    workload.setup();
    return Array.from({ length: steps }, () => workload.step());
  } finally {
    workload.dispose();
  }
}

describe("real-terminal performance workloads", () => {
  test("catalog is lazy, named, configurable and includes the audited thread scales", () => {
    const catalog = createWorkloads();
    expect(catalog).toHaveLength(workloadModes.length * 3);
    expect(new Set(catalog.map((workload) => workload.name)).size).toBe(catalog.length);
    expect([...new Set(catalog.map((workload) => workload.size))]).toEqual([100, 500, 1000]);
    expect([...new Set(catalog.map((workload) => workload.mode))]).toEqual([...workloadModes]);
    expect(createWorkloads({ sizes: [4], modes: ["input"] }).map((workload) => workload.name)).toEqual([
      "long-thread/input/4",
    ]);
    expect(createWorkloads({ sizes: [] })).toEqual([]);
    expect(() => catalog[0]!.step()).toThrow("setup()");
    for (const fixture of catalog) fixture.dispose();
  });

  for (const mode of workloadModes) {
    test(mode + " mutates visible output through the full TUI layout/diff/write path", () => {
      const workload = createWorkloads({ sizes: [8], modes: [mode], columns: 80, rows: 16 })[0]!;
      const originalRender = Container.prototype.render;
      const originalAdd = Container.prototype.addChild;
      const samples = run(workload);
      for (const [index, sample] of samples.entries()) {
        expect(sample.iteration).toBe(index + 1);
        expect(sample.mutations).toBeGreaterThan(0);
        expect(sample.screenChanged).toBe(true);
        expect(sample.changedRows).toBeGreaterThan(0);
        expect(sample.outputWrites).toBeGreaterThan(0);
        expect(sample.outputBytes).toBe(Buffer.byteLength(sample.output));
        expect(sample.outputBytes).toBeGreaterThan(0);
        expect(sample.output).toContain("\x1b[");
        expect(sample.work.frames).toBe(1);
        expect(sample.work.documentRenders).toBeGreaterThan(0);
        expect(sample.work.documentLines).toBeGreaterThan(0);
        expect(sample.work.componentRenders).toBeGreaterThanOrEqual(workload.size);
        expect(sample.work.branchCalls).toBeGreaterThan(0);
        expect(sample.work.branchEntries).toBeGreaterThan(workload.size);
        expect(sample.work.snapshotCalls).toBeGreaterThan(0);
        expect(sample.work.snapshotRows).toBeGreaterThanOrEqual(workload.size);
      }
      expect(new Set(samples.map((sample) => sample.screenHash)).size).toBeGreaterThan(1);
      expect(Container.prototype.render).toBe(originalRender);
      expect(Container.prototype.addChild).toBe(originalAdd);
      expect(() => workload.step()).toThrow("setup()");
      // Fresh setup starts from the same bounded state, including spinner and stream.
      expect(run(workload)).toEqual(samples);
    });
  }

  test("audited 100/500/1000 scales perform historical work even on single-row input changes", () => {
    const workloads = createWorkloads({ sizes: [100, 500, 1000], modes: ["input"] });
    const samples = workloads.map((workload) => run(workload, 1)[0]!);
    for (const [index, sample] of samples.entries()) {
      expect(sample.changedRows).toBe(1);
      expect(sample.work.componentRenders).toBeGreaterThanOrEqual(workloads[index]!.size);
      expect(sample.work.snapshotRows).toBe(workloads[index]!.size * sample.work.snapshotCalls);
      if (index > 0) {
        expect(sample.work.componentRenders).toBeGreaterThan(samples[index - 1]!.work.componentRenders);
        expect(sample.work.branchEntries).toBeGreaterThan(samples[index - 1]!.work.branchEntries);
        expect(sample.work.documentLines).toBeGreaterThan(samples[index - 1]!.work.documentLines);
      }
    }
  });

  test("a tiny non-scrollable fixture reports no visible progress despite terminal writes", () => {
    const workload = createWorkloads({ sizes: [1], modes: ["scrollback"], rows: 100 })[0]!;
    const [sample] = run(workload, 1);
    expect(sample!.work.frames).toBe(1);
    expect(sample!.work.documentRenders).toBeGreaterThan(0);
    expect(sample!.outputBytes).toBeGreaterThan(0);
    expect(sample!.screenChanged).toBe(false);
    expect(sample!.changedRows).toBe(0);
  });

  test("sequential lifecycle prevents overlapping global adapters and permits reuse", () => {
    const [first, second] = createWorkloads({ sizes: [4], modes: ["input", "resize"] });
    try {
      first!.setup();
      expect(() => first!.setup()).toThrow("sequentially");
      expect(() => second!.setup()).toThrow("sequentially");
      expect(first!.step().screenChanged).toBe(true);
      first!.dispose();
      first!.dispose();
      second!.setup();
      expect(second!.step().screenChanged).toBe(true);
    } finally {
      first!.dispose();
      second!.dispose();
    }
  });

  test("profiler attachment precedes the cold frame, and samples drain only their own output", () => {
    let profiler: TerminalProfiler | undefined;
    let tui: TuiAltScreen | undefined;
    const workload = createWorkloads({
      sizes: [8],
      modes: ["input"],
      onTuiReady: (renderer, document) => {
        tui = renderer;
        profiler = attachTerminalProfiler(renderer, {
          observe: [{ target: document, method: "render", name: "history.document.render" }],
        });
        expect(profiler.snapshot().frames).toEqual([]);
        expect(renderer.getScreenLines()).toEqual([]);
      },
    })[0]!;
    try {
      const mount = workload.setup();
      const cold = profiler!.snapshot();
      expect(cold.frames.length).toBeGreaterThan(0);
      expect(cold.droppedFrames).toBe(0);
      expect(mount.iteration).toBe(0);
      expect(mount.mutations).toBe(0);
      expect(mount.changedRows).toBe(tui!.getScreenLines().length);
      expect(mount.screenChanged).toBe(true);
      expect(mount.work.frames).toBe(1);
      expect(mount.outputBytes).toBe(cold.outputBytes);
      expect(mount.outputWrites).toBe(cold.writeCount);
      const coldWork = { ...mount.work };
      for (let iteration = 1; iteration <= 2; iteration++) {
        profiler!.clear();
        const step = workload.step();
        const snapshot = profiler!.snapshot();
        expect(snapshot.frames).toHaveLength(1);
        expect(snapshot.droppedFrames).toBe(0);
        expect(step.iteration).toBe(iteration);
        expect(step.mutations).toBe(2);
        expect(step.work.frames).toBe(1);
        expect(step.outputBytes).toBe(snapshot.outputBytes);
        expect(step.outputWrites).toBe(snapshot.writeCount);
        expect(snapshot.frames[0]!.phasesMs["history.document.render"]).toBeGreaterThanOrEqual(0);
      }
      expect(mount.work).toEqual(coldWork);
    } finally {
      // Match the runner's ownership: the workload stops its TUI; the caller
      // removes the profiler, including when attachment/setup throws.
      workload.dispose();
      profiler?.dispose();
    }
  });

  test("failed renderer-ready callback releases adapters and terminal before another setup", () => {
    const originalRender = Container.prototype.render;
    const originalAdd = Container.prototype.addChild;
    let stopCalls = 0;
    const failure = new Error("renderer-ready failure");
    const workload = createWorkloads({
      sizes: [8],
      modes: ["input"],
      onTuiReady: (tui) => {
        const stop = tui.terminal.stop.bind(tui.terminal);
        tui.terminal.stop = () => {
          stopCalls++;
          stop();
        };
        throw failure;
      },
    })[0]!;
    const next = createWorkloads({ sizes: [8], modes: ["input"] })[0]!;
    try {
      expect(() => workload.setup()).toThrow(failure);
      expect(Container.prototype.render).toBe(originalRender);
      expect(Container.prototype.addChild).toBe(originalAdd);
      expect(() => workload.step()).toThrow("setup()");
      expect(stopCalls).toBe(1);
      expect(next.setup().iteration).toBe(0);
      expect(next.step().screenChanged).toBe(true);
    } finally {
      workload.dispose();
      next.dispose();
    }
  });

  test("invalid fixture options fail before installing any adapters", () => {
    expect(() => createWorkloads({ sizes: [0] })).toThrow("positive integers");
    expect(() => createWorkloads({ sizes: [2.5] })).toThrow("positive integers");
    expect(() => createWorkloads({ columns: 20 })).toThrow("dimensions");
    expect(() => createWorkloads({ rows: 7 })).toThrow("dimensions");
    expect(() => createWorkloads({ modes: ["unknown" as never] })).toThrow("Unknown");
  });

  test("fake Terminal captures bounded writes and detaches input/resize on stop", async () => {
    const terminal = new FakeTerminal(80, 24);
    let input = "";
    let resizes = 0;
    terminal.start(
      (data) => {
        input += data;
      },
      () => {
        resizes++;
      },
    );
    terminal.input("fixture");
    terminal.resize(90, 30);
    terminal.moveBy(-2);
    terminal.clearLine();
    expect(input).toBe("fixture");
    expect(resizes).toBe(1);
    expect([terminal.columns, terminal.rows]).toEqual([90, 30]);
    expect(terminal.takeOutput()).toEqual({ output: "\x1b[2A\x1b[2K", writes: 2 });
    expect(terminal.takeOutput()).toEqual({ output: "", writes: 0 });
    terminal.stop();
    terminal.input("ignored");
    terminal.resize(100, 32);
    expect(input).toBe("fixture");
    expect(resizes).toBe(1);
    await terminal.drainInput();
  });
});
