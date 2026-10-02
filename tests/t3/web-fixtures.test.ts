import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { completionSse, executeDelta } from "../../integrations/t3/gates/fixtures/openai";
import { processIdentity, processTree, stopDetachedGroup } from "../../integrations/t3/gates/fixtures/process";

test("shared SSE retains identity, text and tool deltas, finish reason and DONE framing", () => {
  const identity = { id: "fixture", model: "test-model", created: 7 };
  const tool = executeDelta("call-1", "console.log(1)");
  for (const [delta, finish] of [
    [{ role: "assistant", content: "hello" }, "stop"],
    [tool, "tool_calls"],
  ] as const) {
    const encoded = completionSse(identity, delta, finish);
    const frames = encoded.split("\n\n");
    expect(frames.slice(-2)).toEqual(["data: [DONE]", ""]);
    expect(frames.slice(0, 2).map((frame) => JSON.parse(frame.slice(6)))).toEqual([
      { ...identity, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] },
      { ...identity, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: finish }] },
    ]);
  }
  expect(tool.tool_calls[0]).toEqual({
    index: 0,
    id: "call-1",
    type: "function",
    function: { name: "execute", arguments: '{"code":"console.log(1)"}' },
  });
});

test("owned process primitives retain identity, isolate groups and escalate stubborn leaders", async () => {
  const before = await processIdentity(process.pid);
  expect(before?.pid).toBe(process.pid);
  expect(before?.startTime).toMatch(/^\d+$/);
  expect(await processTree([process.pid, process.pid])).toContainEqual(before!);
  const child = spawn("/bin/bash", ["-c", 'trap "" TERM; printf ready; while :; do sleep 1; done'], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  try {
    await once(child.stdout!, "data");
    const owned = await processTree([child.pid!]);
    expect(owned[0]?.pid).toBe(child.pid!);
    await stopDetachedGroup(child, 30);
    expect(child.signalCode).toBe("SIGKILL");
    expect(await processIdentity(child.pid!)).toBeUndefined();
    expect(await processIdentity(process.pid)).toEqual(before);
  } finally {
    if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid!, "SIGKILL");
  }
});
