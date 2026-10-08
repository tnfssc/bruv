import { expect, test } from "bun:test";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { createSendWorkload, type SendEvidence, type SendOptions } from "../../scripts/terminal-perf/send-workloads";

async function run(options: SendOptions): Promise<SendEvidence> {
  const modeInit = InteractiveMode.prototype.init;
  const fixture = createSendWorkload(options);
  try {
    await fixture.setup();
    return await fixture.action();
  } finally {
    await fixture.dispose();
    expect(InteractiveMode.prototype.init).toBe(modeInit);
  }
}
function checkEvidence(e: SendEvidence) {
  expect(e.work["action.paste-dispatch"]).toBe(1);
  expect(e.work["action.enter-dispatch"]).toBe(1);
  expect(e.work["editor.handlePaste"]).toBe(1);
  expect(e.visibleAcknowledgment).toBe(true);
  expect(e.acknowledgmentScreen.length).toBeGreaterThan(0);
  expect(e.outputBytes).toBe(Buffer.byteLength(e.output));
  expect(e.outputWrites).toBeGreaterThan(0);
  expect(e.messageHash).toHaveLength(64);
  expect(e.screenHash).toHaveLength(64);
  expect(e.sourceHashes.interactive).toHaveLength(64);
  expect(e.spans.every((s) => s.endMs >= s.startMs)).toBe(true);
  expect(e.firstRequestMs).not.toBeNull();
  expect(e.firstFrameMs).not.toBeNull();
  expect(e.firstAcknowledgmentFrameMs).not.toBeNull();
  // Order/content assertions, never wall-clock budget gates on a unit runner.
  expect(e.actionEndMs).toBeGreaterThanOrEqual(e.actionStartMs);
}

test("actual TUI Enter consumes input and sends a short user message through SDK and journal", async () => {
  const e = await run({ message: "send-probe short request" });
  checkEvidence(e);
  expect(e.work["editor.submitValue"]).toBe(1);
  expect(e.work["interactive.onSubmit"]).toBe(1);
  expect(e.work["session.prompt"]).toBe(1);
  expect(e.work["journal.appendMessage"]).toBeGreaterThanOrEqual(2);
  expect(e.journalGrowthBytes).toBeGreaterThan(0);
  expect(e.acknowledgmentText).toBe("send-probe short request");
  expect(e.providerRequests).toHaveLength(1);
  expect(e.providerWaits).toHaveLength(1);
  expect(e.marks.some((m) => m.name === "user-message-created")).toBe(true);
  expect(e.marks.some((m) => m.name === "session-prompt-settled")).toBe(true);
});

test("multiline and large bracketed paste markers expand at real editor submit", async () => {
  for (const message of [
    "send-probe first line\nsecond line\nlast line",
    "send-probe big paste\n" + "large deterministic line\n".repeat(10000),
  ]) {
    const e = await run({ message });
    checkEvidence(e);
    expect(e.acknowledgmentText).toBe(message.trim());
    expect(e.messageBytes).toBe(Buffer.byteLength(message));
    expect(e.work["editor.expandPasteMarkers"]).toBeGreaterThan(0);
    expect(e.providerRequests[0]!.bytes).toBeGreaterThan(e.messageBytes);
  }
});

test("same actual send on a populated session includes history in admission", async () => {
  const short = await run({ historyTurns: 0 });
  const long = await run({ historyTurns: 200 });
  checkEvidence(long);
  expect(long.historyHash).not.toBe(short.historyHash);
  expect(long.messageHash).toBe(short.messageHash);
  expect(long.providerRequests[0]!.messages).toBeGreaterThan(short.providerRequests[0]!.messages);
  expect(long.providerRequests[0]!.bytes).toBeGreaterThan(short.providerRequests[0]!.bytes);
});

test("Enter steering and Alt+Enter follow-up use real streaming queues, not a new provider request", async () => {
  for (const path of ["steer", "follow-up"] as const) {
    const e = await run({ path, message: "send-probe queued " + path });
    checkEvidence(e);
    expect(e.acknowledgmentText).toBe("send-probe queued " + path);
    expect(e.work["session.prompt"]).toBe(1);
    expect(e.providerRequests).toHaveLength(0);
    expect(e.marks.some((m) => m.name === "event:queue_update")).toBe(true);
    if (path === "follow-up") expect(e.work["interactive.handleFollowUp"]).toBe(1);
    else expect(e.work["interactive.onSubmit"]).toBe(1);
  }
});

test("actual slash command callback updates session name and screen without provider admission", async () => {
  const e = await run({ path: "command" });
  checkEvidence(e);
  expect(e.acknowledgmentText).toBe("send-probe");
  expect(e.providerRequests).toHaveLength(0);
  expect(e.work["session.prompt"] ?? 0).toBe(0);
  // SDK leaves an empty session journal lazy until its first assistant message.
  expect(e.work["journal.appendSessionInfo"]).toBe(1);
});

test("setup exclusivity and disposal allow a fresh fixture and renderer profiler cleanup", async () => {
  let cleaned = false;
  const first = createSendWorkload({
    onRendererReady: () => () => {
      cleaned = true;
    },
  });
  const second = createSendWorkload();
  await first.setup();
  try {
    await expect(second.setup()).rejects.toThrow("sequentially");
  } finally {
    await first.dispose();
    await first.dispose();
  }
  expect(cleaned).toBe(true);
  await second.setup();
  await second.dispose();
});

test("fresh-process probe exercises Bruv disk-backed journal without installing permanent adapters in test runner", async () => {
  const child = Bun.spawn(
    [process.execPath, "scripts/terminal-perf/send-workloads.ts", "normal", "20", "0", "bruv-disk"],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exitCode, stderr).toBe(0);
  const e = JSON.parse(stdout) as SendEvidence;
  checkEvidence(e);
  expect(e.journal).toBe("bruv-disk");
  expect(e.journalGrowthBytes).toBeGreaterThan(0);
  expect(e.providerRequests).toHaveLength(1);
  expect(e.providerRequests[0]!.messages).toBeGreaterThan(20);
  expect(e.networkWaitMs).toBe(0);
  expect(e.providerWaits[0]!.requestedDelayMs).toBe(10);
});
