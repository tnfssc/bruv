import { describe, expect, test } from "bun:test";
import { normalizeInteraction } from "../../scripts/terminal-perf/interaction-normalize";
import { samplePeakSync } from "../../scripts/terminal-perf/interaction-report";

// Synthetic records exercise normalization only; these durations are not latency evidence.
const actionProfiler = (label: string, durationMs: number) => ({
  spans: [
    {
      label,
      kind: "action",
      syncDurationMs: durationMs,
      syncExclusiveMs: durationMs,
      startedAtMs: 100,
      endedAtMs: 100 + durationMs,
      parentId: null,
    },
  ],
  heartbeats: [],
  droppedSpans: 0,
  droppedFrameEntries: 0,
  droppedHeartbeats: 0,
  droppedPendingActionLinks: 0,
});

describe("interaction normalization contracts", () => {
  test("send keeps init captures separate and preserves zero versus absent acknowledgment and admission", () => {
    const raw = {
      init: {
        actionProfiler: actionProfiler("init-prefix", 7),
        frameProfiler: { frames: [{ durationMs: 2 }], droppedFrames: 0 },
      },
      actionProfiler: actionProfiler("paste-prefix", 3),
      frameProfiler: { frames: [{ durationMs: 4 }], droppedFrames: 0 },
      evidence: {
        visibleAcknowledgment: true,
        outputBytes: 10,
        outputWrites: 1,
        actionStartMs: 100,
        actionEndMs: 300,
        messageHash: "message",
        historyHash: "history",
        screenHash: "screen",
        outputHash: "output",
        spans: [{ name: "tui.doRender", kind: "sync", depth: 1, startMs: 101, endMs: 105 }],
        providerRequests: [{ atMs: 100 }],
        firstAcknowledgmentFrameMs: 100,
        requestToFrameMs: null,
        providerWaits: [{ startMs: 110, endMs: 280 }],
        work: { sends: 1 },
        messageBytes: 20,
        historyTurns: 4,
        journal: "sdk-disk",
        requestedProviderDelayMs: 5,
      },
    };
    const cases = normalizeInteraction("send/short", raw, 2, "raw/send-short-2.json");
    expect(cases.map((c) => c.id)).toEqual(["send/short/init", "send/short/action"]);
    const [init, action] = cases.map((c) => c.samples[0]!);
    expect(init!.phase).toBe("init");
    expect(init!.spans.map((s) => s.name)).toEqual(["init-prefix"]);
    expect(init!.frameMs).toEqual([2]);
    expect(init!.outputBytes).toBeUndefined();
    expect(init!.screenHash).toBe("");
    expect(init!.boundary).toBe("missing");
    expect(action!.phase).toBe("action");
    expect(action!.spans.map((s) => [s.name, s.kind])).toEqual([
      ["paste-prefix", "sync"],
      ["tui.doRender", "frame"],
    ]);
    expect(action!.firstVisibleAckMs).toBe(0);
    expect(action!.firstProviderAdmissionMs).toBe(0);
    expect(action!.requestToFrameMs).toBeNull();
    expect(action!.providerWaitMs).toEqual([170]);
    expect(action!.elapsedMs).toBe(200);
    expect(action!.boundary).toBe("separate-turns");
    expect(samplePeakSync(action!)).toBe(4);
    for (const sample of [init!, action!]) {
      expect(sample.rawEvidence).toBe("raw/send-short-2.json");
      expect(sample.iteration).toBe(2);
      expect(sample.contentHash).toBe("message:history");
    }
    const absent = normalizeInteraction(
      "send/short",
      {
        ...raw,
        evidence: { ...raw.evidence, firstAcknowledgmentFrameMs: null, providerRequests: [] },
      },
      2,
      "raw/absent.json",
    )[1]!.samples[0]!;
    expect(absent.firstVisibleAckMs).toBeNull();
    expect(absent.firstProviderAdmissionMs).toBeNull();
  });

  test("lifecycle joins by operation, excludes teardown, and prefers input capture even when zero", () => {
    const evidence = {
      providerCalls: 0,
      fetchCalls: 0,
      diskBacked: true,
      size: 4,
      messages: 8,
      historyBytes: 50,
      scope: "synthetic lifecycle",
      contentHash: "content",
      elapsed: [
        { name: "setup", elapsedMs: 90, initialSyncMs: 2 },
        { name: "teardown", elapsedMs: 80, initialSyncMs: 1 },
      ],
      appInput: [
        {
          name: "branch",
          durationMs: 0,
          schedulerDelayMs: 0,
          frames: [{ durationMs: 0 }],
          screenHash: "",
          outputHash: "",
          outputBytes: 0,
        },
      ],
      appStages: [
        {
          name: "setup",
          frames: [{ durationMs: 3 }],
          screenHash: "init-screen",
          outputHash: "init-output",
          outputBytes: 8,
        },
        {
          name: "branch",
          frames: [{ durationMs: 9 }],
          screenHash: "stage-screen",
          outputHash: "stage-output",
          outputBytes: 9,
        },
      ],
      segments: [
        { operation: "branch", name: "branch-sync", startedAtMs: 100, durationMs: 1 },
        { operation: "unframed", name: "other-sync", startedAtMs: 101, durationMs: 0 },
      ],
    };
    const cases = normalizeInteraction("navigation/lifecycle", { evidence }, 1, "raw/lifecycle.json");
    expect(cases.map((c) => c.id)).toEqual([
      "navigation/lifecycle/setup",
      "navigation/lifecycle/branch",
      "navigation/lifecycle/unframed",
    ]);
    const [init, action, unframed] = cases.map((c) => c.samples[0]!);
    expect(init!.phase).toBe("init");
    expect(init!.elapsedMs).toBe(90);
    expect(init!.spans.map((s) => s.kind)).toEqual(["async-prefix"]);
    expect(init!.frameMs).toEqual([3]);
    expect(init!.boundary).toBe("missing");
    expect(action!.phase).toBe("action");
    expect(action!.spans.map((s) => s.name)).toEqual(["branch-sync", "branch.input"]);
    expect(action!.frameMs).toEqual([0]);
    expect(action!.outputBytes).toBe(0);
    expect(action!.screenHash).toBe("");
    expect(action!.outputHash).toBe("");
    expect(action!.requestToFrameMs).toBe(0);
    expect(action!.elapsedMs).toBeUndefined();
    expect(action!.boundary).toBe("separate-turns");
    expect(unframed!.frameMs).toEqual([]);
    expect(unframed!.outputBytes).toBeUndefined();
    expect(unframed!.requestToFrameMs).toBeUndefined();
    for (const c of cases) {
      expect(c.parameters).toEqual({ size: 4, width: 80, height: 24 });
      expect(c.samples[0]!.rawEvidence).toBe("raw/lifecycle.json");
      expect(c.samples[0]!.iteration).toBe(1);
    }
  });

  test("navigation keeps cold and scheduled action separate without summing elapsed or frames", () => {
    const sample = {
      mode: "scroll-page",
      size: 4,
      segments: [{ name: "scroll", durationMs: 3 }],
      synchronousMs: 5,
      frames: [{ durationMs: 7 }],
      contentHash: "content",
      screenHash: "screen",
      outputHash: "output",
      outputBytes: 0,
      outputWrites: 0,
      work: {},
      changedRows: 0,
      actionToFrameCompleteMs: 100,
      schedulerDelayMs: null,
    };
    const cases = normalizeInteraction(
      "navigation/scroll-page",
      { samples: [sample, sample] },
      4,
      "raw/navigation.json",
    );
    expect(cases.map((c) => c.id)).toEqual(["navigation/scroll-page/cold", "navigation/scroll-page/action"]);
    expect(cases.map((c) => c.samples[0]!.phase)).toEqual(["cold", "action"]);
    expect(cases.map((c) => c.samples[0]!.action)).toEqual(["cold-frame", "scroll-page"]);
    for (const c of cases) {
      const s = c.samples[0]!;
      expect(s.boundary).toBe("separate-turns");
      expect(s.contiguousSyncMs).toBeUndefined();
      expect(s.requestToFrameMs).toBeNull();
      expect(s.outputWrites).toBe(0);
      expect(s.elapsedMs).toBe(100);
      expect(samplePeakSync(s)).toBe(7);
      expect(s.rawEvidence).toBe("raw/navigation.json");
    }
  });
});
