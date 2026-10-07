import { createHash } from "node:crypto";
import type { SendEvidence } from "./send-workloads";
import type { ToolSample } from "./tool-workloads";
import type { ToolEventEvidence } from "./tool-event-workloads";
import type { NavigationSample, runOfflineNavigationSdkProbe } from "./navigation-workloads";
import type { TerminalActionProfilerSnapshot } from "./action-profiler";
import type { TerminalProfilerSnapshot } from "./profiler";
import type { InteractionCase, InteractionSample, InteractionSpan } from "./interaction-report";

type Lifecycle = Awaited<ReturnType<typeof runOfflineNavigationSdkProbe>>;
type SendRaw = {
  evidence: SendEvidence;
  init: { actionProfiler: TerminalActionProfilerSnapshot; frameProfiler: TerminalProfilerSnapshot };
  actionProfiler: TerminalActionProfilerSnapshot;
  frameProfiler: TerminalProfilerSnapshot;
};
const actionSpans = (snapshot: TerminalActionProfilerSnapshot): InteractionSpan[] =>
  snapshot.spans.map((s) => ({
    name: s.label,
    durationMs: s.syncDurationMs,
    kind: s.kind === "frame" ? "frame" : "sync",
    startedAtMs: s.startedAtMs,
    endedAtMs: s.endedAtMs,
    exclusiveMs: s.syncExclusiveMs,
    parentId: s.parentId,
    depth: undefined,
  }));
const frameDurations = (frames: { durationMs: number; failed?: boolean }[]) => {
  if (frames.some((f) => f.failed)) throw new Error("Renderer failed during interaction");
  return frames.map((f) => f.durationMs);
};
/** Reconcile independent fixture counters and timing records before deriving any report measurements. */
function validateToolEventEvidence(id: string, e: ToolEventEvidence): string {
  if (e.counts.networkAttempts !== 0) throw new Error(id + " attempted network activity");
  if (!e.visibility.finalSeen || !e.visibility.finalStateMatches || e.visibility.pendingAfterFinal !== 0)
    throw new Error(id + " final visible tool state is invalid");
  if (!e.content.events.length || !e.callbacks.length || !e.frames.length || !e.inputs.length)
    throw new Error(id + " incomplete event/frame/input evidence");
  // The direct burst is a subset of callbacks: subscribed-session callbacks belong only to total counts.
  const directCallbacks = e.callbacks.filter((c) => c.source === "direct-handleEvent");
  if (
    e.counts.callback !== e.callbacks.length ||
    e.counts.frame !== e.frames.length ||
    e.counts.input !== e.inputs.length ||
    e.burst.callbackCount !== directCallbacks.length ||
    e.burst.frameCount !== e.frames.filter((f) => f.phase === "burst").length ||
    e.content.events.length !== e.burst.callbackCount ||
    e.burst.updateDisplayCount !== directCallbacks.reduce((n, c) => n + c.updateDisplayCount, 0) ||
    e.burst.renderResultCount !== directCallbacks.reduce((n, c) => n + c.renderResultCount, 0)
  )
    throw new Error(id + " malformed event timing/count evidence");

  const validTiming = (startMs: number, endMs: number) =>
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs;
  if (
    !validTiming(e.burst.startMs, e.burst.endMs) ||
    e.callbacks.some((c) => !validTiming(c.startMs, c.endMs)) ||
    e.frames.some((f) => !validTiming(f.startMs, f.endMs)) ||
    e.inputs.some((i) => !validTiming(i.enteredAtMs, i.returnedAtMs))
  )
    throw new Error(id + " malformed event timing/count evidence");
  const t = e.trace;
  if (t.droppedSpans || t.droppedFrameEntries || t.droppedHeartbeats || t.droppedPendingActionLinks)
    throw new Error(id + " profiler trace lost evidence");
  const lines = e.frames.flatMap((f) => f.lines);
  const screenText = lines.map((line) => Bun.stripANSI(line)).join("\n");
  if (!screenText.includes(e.visibility.finalMarker)) throw new Error(id + " final marker absent from captured screen");
  return screenText;
}

export function normalizeInteraction(
  id: string,
  raw: unknown,
  iteration: number,
  rawEvidence: string,
): InteractionCase[] {
  const base = (action: string): InteractionSample => ({
    action,
    iteration,
    spans: [],
    frameMs: [],
    contentHash: "",
    screenHash: "",
    outputHash: "",
    work: {},
    rawEvidence,
    boundary: "missing",
    phase: "action",
    limits: [],
  });
  const result = (
    suffix: string,
    sample: InteractionSample,
    scope: string,
    parameters: InteractionCase["parameters"] = {},
  ): InteractionCase => ({
    id: id + "/" + suffix,
    group: id.split("/")[0] as InteractionCase["group"],
    scope,
    parameters,
    samples: [sample],
  });
  if (id.startsWith("send/")) {
    const r = raw as SendRaw,
      e = r.evidence;
    if (!e.visibleAcknowledgment || !e.outputBytes) throw new Error(id + " missing visible send acknowledgment");
    for (const capture of [r.init, { actionProfiler: r.actionProfiler, frameProfiler: r.frameProfiler }]) {
      const a = capture.actionProfiler;
      if (
        a.droppedSpans ||
        a.droppedFrameEntries ||
        a.droppedHeartbeats ||
        a.droppedPendingActionLinks ||
        capture.frameProfiler.droppedFrames
      )
        throw new Error(id + " truncated profiler evidence");
      if (a.spans.some((s) => s.syncThrew)) throw new Error(id + " synchronous profiler scope threw");
    }
    const sample = Object.assign(base("paste+Enter"), {
      spans: [
        ...actionSpans(r.actionProfiler),
        ...e.spans.map((s) => ({
          name: s.name,
          kind: s.name === "tui.doRender" ? ("frame" as const) : s.kind,
          depth: s.depth,
          startedAtMs: s.startMs,
          endedAtMs: s.endMs,
          durationMs: s.endMs - s.startMs,
        })),
      ],
      frameMs: frameDurations(r.frameProfiler.frames),
      contentHash: e.messageHash + ":" + e.historyHash,
      screenHash: e.screenHash,
      outputHash: e.outputHash,
      work: e.work,
      outputBytes: e.outputBytes,
      outputWrites: e.outputWrites,
      visible: e.visibleAcknowledgment,
      firstVisibleAckMs: e.firstAcknowledgmentFrameMs == null ? null : e.firstAcknowledgmentFrameMs - e.actionStartMs,
      firstProviderAdmissionMs: e.providerRequests[0] ? e.providerRequests[0].atMs - e.actionStartMs : null,
      requestToFrameMs: e.requestToFrameMs,
      providerWaitMs: e.providerWaits.map((w) => w.endMs - w.startMs),
      heartbeatDelayMs: r.actionProfiler.heartbeats.map((h) => h.eventLoopDelayMs),
      heartbeatGapMs: r.actionProfiler.heartbeats.map((h) => h.elapsedSincePreviousMs),
      elapsedMs: e.actionEndMs - e.actionStartMs,
      limits: [
        "Input dispatch and sync method prefixes observed; async continuations only where fixture spans instrument them. No contiguous scope across asynchronous turns.",
      ],
    });
    sample.boundary = "separate-turns";
    const init = Object.assign(base("initialized SDK UI"), {
      phase: "init" as const,
      spans: actionSpans(r.init.actionProfiler),
      frameMs: frameDurations(r.init.frameProfiler.frames),
      contentHash: sample.contentHash,
      limits: [
        "Renderer callback attaches before init; constructor/startup before callback and init screen hashes not captured.",
      ],
    });
    const params = {
      messageBytes: e.messageBytes,
      historyTurns: e.historyTurns,
      journal: e.journal,
      providerDelayMs: e.requestedProviderDelayMs,
    };
    return [
      result("init", init, "SDK InteractiveMode init with counting terminal; not full Bruv extension startup", params),
      result("action", sample, "real SDK editor paste/Enter, offline recording provider, " + e.journal, params),
    ];
  }
  if (id.startsWith("tools/events/")) {
    const e = (raw as { evidence?: ToolEventEvidence }).evidence;
    if (!e || e.fixtureVersion !== 1) throw new Error(id + " missing/unsupported tool-event evidence");
    const screenText = validateToolEventEvidence(id, e);
    const t = e.trace;
    const sample = Object.assign(base("tool-event-burst"), {
      spans: [
        ...e.callbacks.map((c) => ({
          name: "handleEvent:" + c.type + ":" + c.source,
          kind: "async-prefix" as const,
          startedAtMs: c.startMs,
          endedAtMs: c.endMs,
          durationMs: c.endMs - c.startMs,
        })),
        ...e.inputs.map((i) => ({
          name: "input:" + i.action,
          kind: "sync" as const,
          startedAtMs: i.enteredAtMs,
          endedAtMs: i.returnedAtMs,
          durationMs: i.returnedAtMs - i.enteredAtMs,
        })),
      ],
      frameMs: e.frames.map((f) => f.endMs - f.startMs),
      contiguousSyncMs: e.burst.endMs - e.burst.startMs,
      contentHash: e.content.hash + ":" + e.historyHash,
      screenHash: createHash("sha256").update(screenText).digest("hex"),
      outputHash: e.outputHash,
      outputBytes: e.outputBytes,
      visible: e.visibility.finalSeen,
      heartbeatDelayMs: t.heartbeats.map((h) => h.eventLoopDelayMs),
      heartbeatGapMs: t.heartbeats.map((h) => h.elapsedSincePreviousMs),
      inputLatenessMs: e.inputs.map((i) => i.latenessMs),
      work: {
        eventCount: e.content.events.length,
        callbackCount: e.counts.callback,
        updateDisplayCount: e.counts.updateDisplay,
        renderResultCount: e.counts.renderResult,
        frameCount: e.counts.frame,
        inputCount: e.counts.input,
        networkAttempts: e.counts.networkAttempts,
        recordingProviderRequests: e.providerRequests.length,
        burstCallbackCount: e.burst.callbackCount,
        burstFrameCount: e.burst.frameCount,
      },
      boundary: "separate-turns",
      limits: [
        e.seam,
        "Controlled direct handleEvent same-turn burst plus real subscribed Enter; burst alone is a contiguous measured slice, but overall action has multiple turns and unobserved async continuations.",
        "Setup, init and grammar warmup are unmeasured; input lateness and heartbeat diagnostics are not CPU. No parser/network/stream ingress or journal proof.",
        "This event fixture uses fixed 100-column/32-row geometry; global width/height options do not resize it.",
      ],
    });
    return [
      result("events", sample, "real SDK tool event dispatch/render fixture; controlled direct seam, no provider", {
        fixtureVersion: e.fixtureVersion,
        columns: 100,
        rows: 32,
        shape: e.options.shape,
        outcome: e.options.outcome,
        argsBytes: e.content.argsBytes,
        finalBytes: e.content.finalBytes,
      }),
    ];
  }
  if (id.startsWith("tools/")) {
    return (raw as { samples: ToolSample[] }).samples.map((s) => {
      const sample = Object.assign(base(s.stage), {
        phase: s.stage === "setup" ? ("cold" as const) : ("action" as const),
        spans: s.segments.map((p) => ({ ...p, kind: "sync" as const })),
        mutationBatchMs: s.mutationMs,
        frameMs: frameDurations(s.frames),
        contentHash: s.content.hash,
        screenHash: s.screenHash,
        outputHash: s.outputHash,
        outputBytes: s.outputBytes,
        outputWrites: s.outputWrites,
        changedRows: s.changedRows,
        work: { ...s.work },
        limits: [
          "Mutations and renderNow are contiguous in fixture, but full slice boundary is missing; mutation sum is a lower bound, NOT mutation+frame total. Hashing/cleanup excluded.",
        ],
      });
      return result(s.stage, sample, "real tool component mutations and drained full frame; no scheduled paint", {
        historySize: 8,
        renderer: s.content.renderer,
        imageProcessing: s.content.imageProcessing,
      });
    });
  }
  if (id === "navigation/lifecycle") {
    const e = (raw as { evidence: Lifecycle }).evidence;
    if (e.providerCalls || e.fetchCalls || !e.diskBacked) throw new Error("Invalid offline SDK lifecycle evidence");
    const names = [
      ...new Set([
        ...e.elapsed.map((s) => s.name),
        ...e.appInput.map((s) => s.name),
        ...e.segments.map((s) => s.operation),
      ]),
    ];
    return names
      .filter((n) => n !== "teardown")
      .map((name) => {
        const elapsed = e.elapsed.find((s) => s.name === name),
          input = e.appInput.find((s) => s.name === name),
          stage = e.appStages.find((s) => s.name === name);
        const sample = Object.assign(base(name), {
          phase: ["InteractiveMode.init", "InteractiveMode.constructor", "setup"].includes(name)
            ? ("init" as const)
            : ("action" as const),
          spans: e.segments.filter((s) => s.operation === name).map((s) => ({ ...s, kind: "sync" as const })),
          frameMs: frameDurations(input?.frames ?? stage?.frames ?? []),
          contentHash: e.contentHash,
          screenHash: input?.screenHash ?? stage?.screenHash ?? "",
          outputHash: input?.outputHash ?? stage?.outputHash ?? "",
          outputBytes: input?.outputBytes ?? stage?.outputBytes,
          elapsedMs: elapsed?.elapsedMs,
          requestToFrameMs: input?.schedulerDelayMs,
          work: {
            providerCalls: e.providerCalls,
            fetchCalls: e.fetchCalls,
            messages: e.messages,
            historyBytes: e.historyBytes,
          },
          limits: [
            e.scope,
            "Lifecycle fixture uses fixed 80x24 terminal (CLI dimensions apply to other fixtures). Awaited elapsed and capture drains are not CPU; async continuations without a named sync span remain unobserved.",
          ],
        });
        if (elapsed)
          sample.spans.push({
            name: name + ".initial-prefix",
            kind: "async-prefix",
            durationMs: elapsed.initialSyncMs,
          });
        if (input) {
          sample.spans.push({ name: name + ".input", kind: "sync", durationMs: input.durationMs });
          sample.boundary = "separate-turns";
        }
        return result(name, sample, e.scope, { size: e.size, width: 80, height: 24 });
      });
  }
  return (raw as { samples: NavigationSample[] }).samples.map((s, i) => {
    const sample = Object.assign(base(i === 0 ? "cold-frame" : s.mode), {
      phase: i === 0 ? ("cold" as const) : ("action" as const),
      spans: s.segments.map((p) => ({ ...p, kind: "sync" as const })),
      frameMs: frameDurations(s.frames),
      contentHash: s.contentHash,
      screenHash: s.screenHash,
      outputHash: s.outputHash,
      outputBytes: s.outputBytes,
      outputWrites: s.outputWrites,
      work: { ...s.work },
      changedRows: s.changedRows,
      elapsedMs: s.actionToFrameCompleteMs,
      requestToFrameMs: s.schedulerDelayMs,
      limits: [
        i === 0
          ? "Cold frame only; fixture setup/mount CPU not measured."
          : "Real synchronous action callback then scheduled frame; no PTY/emulator paint.",
      ],
    });
    sample.spans.push({ name: "synchronous-action-callback", durationMs: s.synchronousMs, kind: "sync" });
    sample.boundary = "separate-turns";
    return result(
      i === 0 ? "cold" : "action",
      sample,
      "real scheduled TuiAltScreen fixture action; SDK seam, not full extension",
      { size: s.size },
    );
  });
}
