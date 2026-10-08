import { describe, expect, test } from "bun:test";
import { placementCode, placementReply } from "./fixtures/remote-e2e/placement-parent";
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const targets = { targets: [{ name: "fixture-owner", kind: "ssh", authorized: true }] };
async function run(prompt: string, options: { discovery?: unknown; result?: unknown; retry?: boolean } = {}) {
  const calls: any[] = [],
    writes: any[] = [];
  const execute = new AsyncFunction(
    "jobs",
    "subagent",
    "Bun",
    "process",
    "console",
    placementCode(prompt, options.retry),
  );
  await execute(
    { targets: async () => options.discovery ?? targets },
    async (args: any) => {
      calls.push(args);
      return options.result ?? { id: "ssh:c3RhYmxl", background: true };
    },
    {
      write: async (path: string, data: string) => writes.push({ path, data: JSON.parse(data) }),
      file: () => ({
        text: async () => JSON.stringify({ launch: { sourceApproval: { taskId: "task_reserved" } } }),
      }),
    },
    { env: { HOME: "/fixture-home" } },
    { log() {} },
  );
  return { calls, writes };
}
describe("normal async SSH placement", () => {
  test("migrated prompts preserve full names and acknowledge delivery without relaunch", async () => {
    for (const prompt of [
      "REMOTE_FIXTURE_BASIC",
      "REMOTE_FIXTURE_QUESTION",
      "REMOTE_FIXTURE_REPO_CONFLICT",
      "REMOTE_FIXTURE_CAPABILITY",
      "REMOTE_FIXTURE_CANCEL",
      "REMOTE_FIXTURE_MENU_CHOICE",
      "REMOTE_FIXTURE_MENU_LONG_NAME_segment_VISIBLE_TAIL",
      "REMOTE_FIXTURE_FINISH_WHILE_MENU_OPEN",
      "REMOTE_FIXTURE_CAPABILITY_PTY",
    ]) {
      const reply = placementReply([{ role: "user", content: prompt }]);
      expect(JSON.parse(reply.tool_calls![0].function.arguments).code).toBe(placementCode(prompt));
      const { calls, writes } = await run(prompt);
      expect(calls).toEqual([
        {
          target: "fixture-owner",
          type: "normal",
          prompt: prompt + " REMOTE_FIXTURE_NORMAL_PLACEMENT",
          waitSeconds: 0,
        },
      ]);
      expect(writes[0].data.launch.id).toBe("ssh:c3RhYmxl");
      expect(
        placementReply([
          { role: "user", content: prompt },
          { role: "tool", tool_call_id: reply.tool_calls![0].id },
        ]).tool_calls,
      ).toBeUndefined();
    }
  });
  test("discovery rejects missing, unauthorized or non-SSH targets", async () => {
    for (const discovery of [
      { targets: [] },
      { targets: [{ name: "fixture-owner", kind: "ssh", authorized: false }] },
      { targets: [{ name: "fixture-owner", kind: "local", authorized: true }] },
    ])
      await expect(run("REMOTE_FIXTURE_BASIC", { discovery })).rejects.toThrow("Missing pinned fixture target");
  });
  test("launch rejects non-SSH IDs or synchronous results", async () => {
    for (const result of [
      { id: "task_bad", background: true },
      { id: "ssh:c3RhYmxl", background: false },
    ])
      await expect(run("REMOTE_FIXTURE_BASIC", { result })).rejects.toThrow("Expected stable async SSH job");
  });
});
test("source inclusion requests human preflight and retry pins the reserved ID", async () => {
  expect((await run("REMOTE_FIXTURE_REPO_SAFE")).calls[0].source).toEqual({ includeUntracked: ["on-demand.txt"] });
  expect((await run("REMOTE_FIXTURE_REPO_SAFE", { retry: true })).calls[0].source).toEqual({
    includeUntracked: ["on-demand.txt"],
    retryTaskId: "task_reserved",
  });
});
test("cancellation reads the saved launch and uses jobs.stop with its exact ID", async () => {
  const reply = placementReply([{ role: "user", content: "REMOTE_FIXTURE_CANCEL PLACEMENT_STOP" }]);
  const calls: string[] = [];
  await new AsyncFunction(
    "jobs",
    "Bun",
    "process",
    "console",
    JSON.parse(reply.tool_calls![0].function.arguments).code,
  )(
    { stop: async (id: string) => calls.push(id) },
    { file: () => ({ text: async () => JSON.stringify({ launch: { id: "ssh:c3RhYmxl" } }) }) },
    { env: { HOME: "/fixture-home" } },
    { log() {} },
  );
  expect(calls).toEqual(["ssh:c3RhYmxl"]);
});
test("migrated runners contain no prohibited agent launch", async () => {
  for (const runner of ["remote-e2e", "remote-pty-e2e", "remote-capability-pty-e2e"]) {
    const source = await Bun.file(new URL("../../scripts/" + runner + ".ts", import.meta.url)).text();
    expect(source).not.toMatch(/remote\.launch/);
  }
});
