import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildToolEventBurst,
  createToolEventWorkload,
  toolEventShapes,
  type ToolEventEvidence,
  type ToolEventOptions,
} from "../../scripts/terminal-perf/tool-event-workloads";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function runIsolatedProbe(argv: string[]): Promise<string> {
  // Retain the owned HOME/config/SDK fixture; never inherit credentials or user paths.
  const home = await mkdtemp(join(tmpdir(), "bruv-tool-event-test-"));
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_DATA_HOME: join(home, "data"),
    TMPDIR: join(home, "tmp"),
    PI_CODING_AGENT_DIR: join(home, "pi-agent"),
    BRUV_CODING_AGENT_DIR: join(home, "bruv-agent"),
    PI_OFFLINE: "1",
  };
  await Promise.all(
    [
      env.XDG_CONFIG_HOME,
      env.XDG_CACHE_HOME,
      env.XDG_DATA_HOME,
      env.TMPDIR,
      env.PI_CODING_AGENT_DIR,
      env.BRUV_CODING_AGENT_DIR,
    ].map((dir) => mkdir(dir, { recursive: true })),
  );
  const child = Bun.spawn([process.execPath, ...argv], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exit !== 0) throw new Error("Isolated tool-event probe failed (fixture " + home + "): " + stderr);
  return stdout;
}

async function probe(options: ToolEventOptions): Promise<ToolEventEvidence> {
  // Permanent SDK disk adapter and singleton registrations never contaminate this test process.
  return JSON.parse(
    await runIsolatedProbe(["scripts/terminal-perf/tool-event-workloads.ts", JSON.stringify(options)]),
  ) as ToolEventEvidence;
}

function check(e: ToolEventEvidence) {
  expectBurstCallbacks(e);
  expectSettledOutput(e);
  expectBackloggedInputAndSend(e);
  expectTraceAccounting(e);
}

function expectBurstCallbacks(e: ToolEventEvidence) {
  expect(e.seam).toContain("direct InteractiveMode.handleEvent");
  expect(e.seam).toContain("real subscribed SDK session events");
  expect(e.burst.callbackCount).toBe(e.content.events.length);
  expect(e.burst.callbackCount).toBe(2 * e.options.burstCount + 9);
  expect(e.burst.frameCount).toBe(0); // Same-turn callbacks are not a drained renderNow benchmark.
  expect(e.burst.updateDisplayCount).toBeGreaterThan(e.options.burstCount);
  expect(e.counts.networkAttempts).toBe(0);
  const direct = e.callbacks.filter((c) => c.source === "direct-handleEvent");
  expect(direct).toHaveLength(e.content.events.length);
  expect(direct.map((c) => c.type)).toEqual(e.content.events.map((event) => event.type));
  expect(
    direct.every(
      (c) =>
        c.returnedPromise &&
        c.endMs >= c.startMs &&
        c.settledAtMs !== null &&
        c.settledAtMs >= c.endMs &&
        c.rejected === null,
    ),
  ).toBe(true);
  expect(e.callbacks.some((c) => c.source === "subscribed-session" && c.type === "agent_settled")).toBe(true);
  expect(e.counts.callback).toBe(e.callbacks.length);
  const lastFive = direct.slice(-5);
  expect(lastFive.every((c) => c.updateDisplayCount === 0 && c.renderResultCount === 0)).toBe(true);
  for (const c of direct) {
    const action = e.trace.spans.find((s) => s.kind === "action" && s.label === "event:" + c.type + ":" + c.index);
    expect(action).toBeDefined();
    expect(action!.startedAtMs).toBeGreaterThanOrEqual(c.startMs);
    expect(action!.endedAtMs).toBeLessThanOrEqual(c.endMs);
  }
}

function expectSettledOutput(e: ToolEventEvidence) {
  expect(e.visibility.finalStateMatches).toBe(true);
  expect(e.visibility.pendingAfterFinal).toBe(0);
  expect(e.visibility.finalSeen).toBe(true);
  expect(e.visibility.intermediateSeen).toEqual([]);
  expect(e.visibility.intermediateNotSeen).toEqual(e.visibility.intermediateMarkers);
  const plain = e.frames
    .flatMap((f) => f.lines)
    .map(Bun.stripANSI)
    .join("\n");
  expect(plain).not.toContain("IGNORED_LATE_DUPLICATE_ORPHAN");
  expect(plain).toContain("tool-event send acknowledged");
  expect(e.outputBytes).toBe(Buffer.byteLength(e.output));
  expect(e.outputHash).toBe(hash(e.output));
  expect(e.content.hash).toBe(hash(JSON.stringify(e.content.events)));
  expect(e.content.finalHash).toHaveLength(64);
  expect(e.content.finalBytes).toBeGreaterThanOrEqual(e.options.finalBytes);
  expect(e.sourceHashes.interactive).toHaveLength(64);
  expect(e.sourceHashes.executeAdapter).toHaveLength(64);
  expect(e.historyHash).toHaveLength(64);
}

function expectBackloggedInputAndSend(e: ToolEventEvidence) {
  for (const frame of e.frames) expect(frame.endMs).toBeGreaterThanOrEqual(frame.startMs);
  expect(e.frames[0]!.startMs).toBeGreaterThanOrEqual(e.burst.endMs);
  for (const input of e.inputs.slice(0, 4)) {
    expect(input.queuedAtMs).toBeLessThanOrEqual(e.burst.startMs);
    expect(input.enteredAtMs).toBeGreaterThanOrEqual(e.burst.endMs);
    expect(input.latenessMs).toBe(input.enteredAtMs - input.expectedAtMs);
  }
  expect(e.inputs.map((i) => i.action)).toEqual([
    "type-after-burst",
    "paste-after-burst",
    "cursor-left-after-burst",
    "backspace-after-burst",
    "collapse-tool",
    "reveal-tool",
    "scroll-up",
    "scroll-down",
    "send-enter",
  ]);
  expect(e.inputs[0]!.editorText).toBe("event-input");
  expect(e.inputs[1]!.editorText).toBe("event-input first line\nsecond line");
  expect(e.inputs[2]!.editorText).toBe(e.inputs[1]!.editorText);
  expect(e.inputs[3]!.editorText).toBe("event-input first line\nsecond lie");
  expect(e.inputs.at(-1)!.editorText).toBe("");
  expect(e.providerRequests).toHaveLength(1);
  expect(e.providerRequests[0]!.bytes).toBeGreaterThan(0);
  expect(e.journalGrowthBytes).toBeGreaterThan(0);
}

function expectTraceAccounting(e: ToolEventEvidence) {
  expect(e.counts.frame).toBe(e.frames.length);
  expect(e.counts.input).toBe(e.inputs.length);
  expect(e.trace.droppedSpans).toBe(0);
  expect(e.trace.droppedFrameEntries).toBe(0);
  expect(e.trace.droppedPendingActionLinks).toBe(0);
  expect(e.trace.heartbeats.length).toBeGreaterThan(0);
  expect(e.trace.frameEntries.length).toBe(e.frames.length);
  const firstLinks = e.trace.frameEntries[0]!.firstFrameForActions.map((l) => l.label);
  expect(firstLinks).toContain("event:tool_execution_end:" + (2 * e.options.burstCount + 3));
  expect(firstLinks).toContain("input:type-after-burst");
  expect(e.trace.spans.some((s) => s.label === "renderer.handleTerminalInput")).toBe(true);
  expect(e.trace.spans.some((s) => s.label === "renderer.doRender")).toBe(true);
}

test("bounded options fail before installing irreversible adapters", () => {
  for (const options of [
    { burstCount: 0 },
    { burstCount: 65 },
    { historyTurns: 65 },
    { argsBytes: -1 },
    { finalBytes: 262145 },
  ])
    expect(() => createToolEventWorkload(options)).toThrow("Bounded sequential probe");
});

test("deterministic typed event fixtures include args, result, and unexpected lifecycle ordering", () => {
  const options = {
    shape: "structured" as const,
    outcome: "warning" as const,
    historyTurns: 8,
    burstCount: 3,
    argsBytes: 512,
    finalBytes: 2048,
  };
  expect(buildToolEventBurst(options)).toEqual(buildToolEventBurst(options));
  const payload = buildToolEventBurst(options);
  expect(payload.events.some((e) => e.type === "tool_execution_start" && e.parentToolCallId)).toBe(true);
  expect(payload.result.details).toHaveProperty("stdoutLost", true);
  expect(payload.finalMarker).toBe("FINAL_EVENT_PAYLOAD_WARNING");
});

test("actual initialized callback pipeline, burst coalescing, backlog inputs and real Enter", async () => {
  const e = await probe({ historyTurns: 8, burstCount: 4, argsBytes: 64, finalBytes: 8192 });
  check(e);
  expect(e.burst.renderResultCount).toBe(e.options.burstCount + 1);
  expect(e.counts.renderResult).toBeGreaterThan(e.burst.renderResultCount);
}, 20000);

test("actual long ASCII/ANSI/Unicode/newline and structured SDK args paths", async () => {
  // Functional shape checks sequentially, not a concurrent or latency-threshold timing matrix.
  for (const shape of toolEventShapes.filter((s) => s !== "normal")) {
    const e = await probe({
      shape,
      historyTurns: 0,
      burstCount: 3,
      argsBytes: shape === "ascii" ? 65536 : 8192,
      finalBytes: 8192,
    });
    check(e);
    expect(e.content.argsBytes).toBeGreaterThanOrEqual(e.options.argsBytes);
    if (shape === "structured")
      expect(e.burst.renderResultCount).toBe(0); // Actual SDK generic fallback, not production execute rendering.
    else expect(e.burst.renderResultCount).toBe(e.options.burstCount + 1);
  }
}, 30000);

test("settled error and artifact warning preserve final state through late/duplicate/orphan events", async () => {
  for (const outcome of ["error", "warning"] as const) {
    const e = await probe({ outcome, historyTurns: 0, burstCount: 2, finalBytes: 4096 });
    check(e);
    const final = e.content.events.find((event) => event.type === "tool_execution_end")!;
    expect(final.type).toBe("tool_execution_end");
    if (final.type === "tool_execution_end") {
      expect(final.isError).toBe(outcome === "error");
      if (outcome === "warning") expect(final.result.details.stdoutLost).toBe(true);
    }
    const screen = e.frames
      .flatMap((f) => f.lines)
      .map(Bun.stripANSI)
      .join("\n");
    if (outcome === "warning") expect(screen).toContain("execute could not save all output");
  }
}, 20000);

test("network guard denies fetch/HTTP/TCP and disposal restores process seams", async () => {
  const out = await runIsolatedProbe(["tests/ui/fixtures/terminal-perf-tool-event-guard.ts"]);
  expect(JSON.parse(out)).toEqual({
    denied: [true, true, true, true],
    restored: true,
    freshProcessRequired: true,
    attempts: 4,
  });
}, 10000);
