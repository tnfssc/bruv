import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";

// Exercise the actual deterministic provider's generated execute, without SSH or a paid provider.
let provider: Bun.Subprocess<"ignore", "ignore", "pipe">;
let url: string;
beforeAll(async () => {
  provider = Bun.spawn([process.execPath, resolve(import.meta.dir, "fixtures/remote-e2e/fake-provider.ts")], {
    env: { PATH: process.env.PATH, FIXTURE_PROVIDER_PORT: "0", FIXTURE_PROVIDER_HOST: "127.0.0.1" },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const reader = provider.stderr.getReader();
  let text = "";
  try {
    while (!/fixture provider bound \d+\n/.test(text)) {
      const chunk = await reader.read();
      if (chunk.done) throw Error("fixture provider exited: " + text);
      text += new TextDecoder().decode(chunk.value);
    }
    url = "http://127.0.0.1:" + text.match(/fixture provider bound (\d+)/)![1];
  } finally {
    reader.releaseLock();
  }
});
afterAll(async () => {
  provider?.kill();
  if (provider) await provider.exited;
});
async function code(messages: object[]) {
  const response = await fetch(url + "/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "fixture-parent", messages }),
  });
  expect(response.ok).toBe(true);
  const chunk = (await response.text()).split("\n").find((line) => line.startsWith("data: {"))!;
  const call = JSON.parse(chunk.slice(6)).choices[0].delta.tool_calls[0];
  expect(call.function.name).toBe("execute");
  return JSON.parse(call.function.arguments).code as string;
}
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const quiet = { log() {} };
test("parent fixture discovers pinned alias and launches normal async placement with returned ID", async () => {
  const source = await code([{ role: "user", content: "REMOTE_JOBS_PROOF_A" }]);
  const execute = new AsyncFunction("jobs", "subagent", "Bun", "process", "console", source);
  const launches: any[] = [],
    writes: any[] = [];
  const discovery = {
    targets: [
      { name: "local", kind: "local" },
      { name: "fixture-owner", kind: "ssh", authorized: true },
    ],
  };
  await execute(
    { targets: async () => discovery },
    async (args: any) => {
      launches.push(args);
      return { id: "ssh:c3RhYmxl", background: true };
    },
    { write: async (path: string, text: string) => writes.push([path, JSON.parse(text)]) },
    { env: { HOME: "/fixture-home" } },
    quiet,
  );
  expect(launches).toEqual([
    { target: "fixture-owner", type: "normal", prompt: "REMOTE_JOBS_PROOF_A", waitSeconds: 0 },
  ]);
  expect(writes).toEqual([
    ["/fixture-home/jobs-A.json", { discovery, launch: { id: "ssh:c3RhYmxl", background: true } }],
  ]);
  await expect(
    execute(
      { targets: async () => ({ targets: [] }) },
      async () => {
        throw Error("must not launch");
      },
      {},
      {},
      quiet,
    ),
  ).rejects.toThrow("Missing pinned fixture target");
  await expect(
    execute({ targets: async () => discovery }, async () => ({ id: "local-id", background: false }), {}, {}, quiet),
  ).rejects.toThrow("Expected stable async SSH job");
});
test("parent fixture probes its exact jobs ID and rejects foreign and unknown inspect/stop", async () => {
  const own = "ssh:b3du",
    foreign = "ssh:Zm9yZWlnbg";
  const source = await code([
    { role: "user", content: "REMOTE_JOBS_PROOF_B" },
    { role: "user", content: "REMOTE_JOBS_CHECK " + own + " " + foreign },
  ]);
  const execute = new AsyncFunction("jobs", "Bun", "process", "console", source);
  const attempted: string[] = [];
  const jobs = {
    list: async () => ({ jobs: [{ id: own }] }),
    inspect: async (id: string) => {
      if (id === own) return { id, status: "completed" };
      attempted.push("inspect:" + id);
      throw Error("Unknown SSH job");
    },
    stop: async (id: string) => {
      attempted.push("stop:" + id);
      throw Error("Unknown SSH job");
    },
  };
  const writes: any[] = [];
  await execute(
    jobs,
    { write: async (_path: string, text: string) => writes.push(JSON.parse(text)) },
    { env: { HOME: "/fixture-home" } },
    quiet,
  );
  expect(writes[0].inspected.id).toBe(own);
  expect(writes[0].rejected).toHaveLength(4);
  expect(attempted).toHaveLength(4);
  await expect(execute({ ...jobs, stop: async () => ({}) }, {}, { env: {} }, quiet)).rejects.toThrow(
    "Foreign/unknown job accepted",
  );
});
