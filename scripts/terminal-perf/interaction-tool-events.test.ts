import { describe, expect, test } from "bun:test";
import { interactionCatalog } from "./interaction-catalog";
import { normalizeInteraction } from "./interaction-normalize";
import { samplePeakSync } from "./interaction-report";
import { toolShapes } from "./tool-workloads";
import type { ToolEventEvidence } from "./tool-event-workloads";

function evidence(): ToolEventEvidence {
  return {
    fixtureVersion: 1,
    seam: "controlled event seam",
    options: { shape: "normal", outcome: "success", historyTurns: 4, burstCount: 8, argsBytes: 100, finalBytes: 100 },
    environment: { bun: "test", platform: "test", release: "test", arch: "test", cpu: "test" },
    sourceHashes: {},
    historyHash: "history",
    content: {
      events: [{ type: "tool_execution_start" } as never],
      hash: "events",
      argsBytes: 100,
      finalBytes: 100,
      finalHash: "content",
    },
    callbacks: [
      {
        scope: "async-prefix",
        index: 0,
        type: "tool_execution_start",
        source: "direct-handleEvent",
        startMs: 10,
        endMs: 11,
        updateDisplayCount: 1,
        renderResultCount: 0,
        returnedPromise: false,
        settledAtMs: null,
        rejected: null,
      },
    ],
    frames: [{ startMs: 20, endMs: 22, phase: "send-enter", callbackCount: 1, lines: ["final-marker"] }],
    inputs: [
      {
        action: "enter",
        data: "\r",
        queuedAtMs: 25,
        expectedAtMs: 26,
        enteredAtMs: 30,
        returnedAtMs: 31,
        latenessMs: 4,
        editorText: "",
      },
    ],
    burst: { startMs: 10, endMs: 18, callbackCount: 1, updateDisplayCount: 1, renderResultCount: 0, frameCount: 0 },
    visibility: {
      intermediateMarkers: [],
      intermediateSeen: [],
      intermediateNotSeen: [],
      finalMarker: "final-marker",
      finalSeen: true,
      finalStateMatches: true,
      pendingAfterFinal: 0,
    },
    counts: { callback: 1, updateDisplay: 1, renderResult: 0, frame: 1, input: 1, networkAttempts: 0 },
    providerRequests: [],
    journalGrowthBytes: 0,
    output: "screen",
    outputBytes: 6,
    outputHash: "output",
    trace: {
      schemaVersion: 1,
      clock: "performance.now",
      traceInfo: {},
      heartbeatIntervalMs: null,
      spans: [],
      frameEntries: [],
      heartbeats: [],
      totalSpans: 0,
      droppedSpans: 0,
      totalFrameEntries: 0,
      droppedFrameEntries: 0,
      totalHeartbeats: 0,
      droppedHeartbeats: 0,
      droppedPendingActionLinks: 0,
    },
  };
}

describe("tool-event interactions", () => {
  test("catalog keeps 13 component shapes distinct from 8 event workloads", () => {
    expect(toolShapes).toHaveLength(13);
    expect(interactionCatalog.filter((id) => id.startsWith("tools/events/"))).toHaveLength(8);
  });
  test("records contiguous same-turn burst peak separately from scheduled frame", () => {
    const sample = normalizeInteraction("tools/events/normal", { evidence: evidence() }, 0, "raw unchanged")[0]!
      .samples[0]!;
    expect(sample.rawEvidence).toBe("raw unchanged");
    expect(sample.contiguousSyncMs).toBe(8);
    expect(sample.frameMs).toEqual([2]);
    expect(samplePeakSync(sample)).toBe(8);
    expect(sample.boundary).toBe("separate-turns");
    expect(sample.inputLatenessMs).toEqual([4]);
    expect(sample.outputWrites).toBeUndefined();
    expect(sample.contentHash).toBe("events:history");
    sample.inputLatenessMs = [999];
    expect(samplePeakSync(sample)).toBe(8);
  });
  test("rejects missing final visible state, network activity, and lost traces", () => {
    for (const mutate of [
      (e: ToolEventEvidence) => {
        e.visibility.finalSeen = false;
      },
      (e: ToolEventEvidence) => {
        e.counts.networkAttempts = 1;
      },
      (e: ToolEventEvidence) => {
        e.trace.droppedSpans = 1;
      },
    ]) {
      const e = evidence();
      mutate(e);
      expect(() => normalizeInteraction("tools/events/normal", { evidence: e }, 0, "raw")).toThrow();
    }
  });
});
