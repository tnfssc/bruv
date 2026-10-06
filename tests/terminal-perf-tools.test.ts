import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Container, getCapabilities } from "@earendil-works/pi-tui";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import {
  createToolWorkload,
  createToolWorkloads,
  runToolProbe,
  toolShapes,
  toolStages,
  type ToolSample,
  type ToolWorkload,
} from "../scripts/terminal-perf/tool-workloads";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const visible = (sample: ToolSample) => Bun.stripANSI(sample.screenLines.join("\n"));
function run(fixture: ToolWorkload) {
  try {
    return [fixture.setup(), ...toolStages.map((stage) => fixture.action(stage))];
  } finally {
    fixture.dispose();
  }
}
// Clocks are observed, never gated: these tests establish content/work/lifecycle meaning.
function deterministic(sample: ToolSample) {
  const { frames: _frames, segments: _segments, mutationMs: _mutation, renderDrainMs: _drain, ...rest } = sample;
  return rest;
}

describe("SDK tool mutation + complete-frame fixtures", () => {
  for (const shape of toolShapes) {
    test(shape + " changes real screen content on reveal and records mutation/frame separately", () => {
      const caps = getCapabilities();
      const random = Math.random;
      const render = ToolExecutionComponent.prototype.render;
      const containerRender = Container.prototype.render;
      const fixture = createToolWorkload({ shape, historySize: 8 });
      const samples = run(fixture);
      expect(samples.map((sample) => sample.stage)).toEqual(["setup", ...toolStages]);
      for (const sample of samples) {
        expect(sample.frames).toHaveLength(1);
        expect(sample.frames[0]!.failed).toBe(false);
        expect(Number.isFinite(sample.frames[0]!.durationMs)).toBe(true);
        expect(sample.frames[0]!.requestDelayMs).not.toBeNull();
        expect(sample.segments.every((segment) => Number.isFinite(segment.durationMs))).toBe(true);
        expect(sample.mutationMs).toBe(sample.segments.reduce((sum, segment) => sum + segment.durationMs, 0));
        expect(sample.outputBytes).toBe(Buffer.byteLength(sample.output));
        expect(sample.outputBytes).toBe(
          sample.outsideFrameOutputBytes + sample.frames.reduce((sum, frame) => sum + frame.outputBytes, 0),
        );
        expect(sample.outputWrites).toBe(
          sample.outsideFrameWriteCount + sample.frames.reduce((sum, frame) => sum + frame.writeCount, 0),
        );
        expect(sample.outputHash).toBe(hash(sample.output));
        expect(sample.screenHash).toBe(hash(sample.screenLines.join("\n")));
        expect(sample.workHash).toBe(hash(JSON.stringify(sample.work)));
        expect(sample.content.hash).toBe(fixture.content.hash);
        expect(sample.work.documentRenders).toBeGreaterThan(0);
        expect(sample.work.branchCalls).toBeGreaterThan(0);
        expect(sample.work.snapshotRows).toBe(
          sample.work.snapshotCalls *
            (sample.stage === "complete" || ["reveal", "collapse", "error"].includes(sample.stage)
              ? 8 + sample.content.taskRows
              : 8),
        );
      }
      const construct = samples.find((sample) => sample.stage === "construct")!;
      const complete = samples.find((sample) => sample.stage === "complete")!;
      const reveal = samples.find((sample) => sample.stage === "reveal")!;
      const collapse = samples.find((sample) => sample.stage === "collapse")!;
      const error = samples.find((sample) => sample.stage === "error")!;
      expect(construct.work.constructions).toBe(1);
      expect(complete.work.updateResult).toBe(1);
      expect(reveal.changedRows).toBeGreaterThan(0);
      expect(reveal.screenHash).not.toBe(complete.screenHash);
      expect(reveal.renderedDocumentLines).toBeGreaterThan(complete.renderedDocumentLines);
      // Revealing measures only the changed group; the scheduled frame renders history once.
      expect(complete.work.documentRenders).toBe(1);
      expect(reveal.work.documentRenders).toBe(1);
      expect(reveal.segments.map((segment) => segment.name)).toContain("ActivityController.toggleDetails/withAnchor");
      expect(reveal.work.expansions).toBe(1);
      if (shape !== "sdk-json-args") expect(collapse.changedRows).toBeGreaterThan(0);
      // SDK generic fallback prints complete args regardless of expansion.
      else expect(collapse.work.expansions).toBe(1);
      expect(visible(error)).toContain("failed");
      if (shape === "artifact-warning") expect(visible(complete)).toContain("couldn’t save full output");
      if (shape === "handoff") expect(visible(complete)).toContain("Review the bounded task evidence");
      if (shape === "markdown") expect(visible(reveal)).toContain("**item**"); // Execute output is plain wrapped text, not a Markdown parser.
      if (shape === "task-rows") {
        expect(visible(complete)).toContain("7 jobs failed");
        expect(visible(error)).toContain("deterministic module");
      }
      if (shape === "code-preview") expect(reveal.renderedDocumentLines).toBeGreaterThan(1024);
      if (shape === "png-image") {
        expect(reveal.output).toContain("\x1b_G");
        expect(reveal.content.imageProcessing).toBe("synchronous-png-kitty");
      }
      expect(getCapabilities()).toEqual(caps);
      expect(Math.random).toBe(random);
      expect(ToolExecutionComponent.prototype.render).toBe(render);
      expect(Container.prototype.render).toBe(containerRender);
      expect(run(fixture).map(deterministic)).toEqual(samples.map(deterministic));
    });
  }

  test("reports invisible args/start mutations honestly, and reveals a large preview before results", () => {
    const fixture = createToolWorkload({ shape: "code-preview", historySize: 0 });
    try {
      fixture.setup();
      fixture.action("construct");
      const stream = fixture.action("args-stream");
      expect(stream.changedRows).toBe(0);
      expect(stream.work.updateArgs).toBe(1);
      fixture.action("args-complete");
      const reveal = fixture.action("reveal");
      expect(visible(reveal)).toContain("const value0");
      expect(reveal.renderedDocumentLines).toBeGreaterThan(1024);
      const again = fixture.action("reveal");
      expect(again.work.expansions).toBe(0);
      expect(again.changedRows).toBe(0);
      const partial = fixture.action("partial");
      expect(partial.work.updateResult).toBe(1);
      expect(visible(partial)).toContain("result incomplete");
      expect(partial.renderedDocumentHash).not.toBe(reveal.renderedDocumentHash);
    } finally {
      fixture.dispose();
    }
  });

  test("large generic args reach constructor as well as update paths", () => {
    const fixture = createToolWorkload({ shape: "sdk-json-args", historySize: 0, initialArgs: "complete" });
    try {
      fixture.setup();
      const sample = fixture.action("construct");
      expect(sample.segments[0]!.name).toBe("ToolExecutionComponent.constructor");
      expect(sample.content.codeBytes).toBeGreaterThan(20000);
      expect(sample.content.renderer).toBe("sdk-generic");
      const reveal = fixture.action("reveal");
      expect(reveal.renderedDocumentLines).toBeGreaterThan(1000);
    } finally {
      fixture.dispose();
    }
  });

  test("normal histories and scale perform different branch/snapshot work", () => {
    const samples = [0, 8, 100].map(
      (historySize) =>
        run(createToolWorkload({ shape: "short", historySize })).find((sample) => sample.stage === "reveal")!,
    );
    expect(new Set(samples.map((sample) => sample.content.hash)).size).toBe(3);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.work.branchEntries).toBeGreaterThan(samples[i - 1]!.work.branchEntries);
      expect(samples[i]!.work.snapshotRows).toBeGreaterThan(samples[i - 1]!.work.snapshotRows);
      expect(samples[i]!.renderedDocumentLines).toBeGreaterThan(samples[i - 1]!.renderedDocumentLines);
    }
    expect(createToolWorkloads()).toHaveLength(toolShapes.length + 3);
  });

  test("repeated completions do not grow the retained branch, and lifecycle restores ownership", () => {
    const first = createToolWorkload({ shape: "short" });
    const second = createToolWorkload({ shape: "short" });
    expect(() => first.action("construct")).toThrow("setup()");
    try {
      first.setup();
      expect(() => second.setup()).toThrow("sequential");
      expect(() => first.action("partial")).toThrow("Construct");
      first.action("construct");
      expect(() => first.action("construct")).toThrow("Construct");
      const sample = first.action("complete");
      for (let i = 0; i < 12; i++)
        expect(first.action(i % 2 ? "complete" : "error").work.branchEntries).toBe(sample.work.branchEntries);
      first.dispose();
      first.dispose();
      second.setup();
      second.action("construct");
    } finally {
      first.dispose();
      second.dispose();
    }
    expect(() => createToolWorkload({ shape: "short", historySize: 1001 })).toThrow("historySize");
    expect(() => runToolProbe({ shape: "short" }, 21)).toThrow("repetitions");
    const probe = runToolProbe({ shape: "short", historySize: 0 }, 2);
    expect(probe.runs).toHaveLength(2);
    expect(probe.runs[0]!.samples.map(deterministic)).toEqual(probe.runs[1]!.samples.map(deterministic));
  });
});
