import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadAppWorkerPolicy,
  bindNormalAppWorker,
  loadNormalAppWorkerProfile,
  prepareAppWorkerCall,
  assertAppWorkerCall,
  type AppWorkerPolicy,
} from "../src/claude-compat/app-worker";
import { profilesPath } from "../src/tasks/subagent-profiles";
import type { PermissionRequest } from "../src/claude-compat/permissions";
const root: AppWorkerPolicy = {
  role: "orchestrator",
  depth: 0,
  worker: {
    type: "normal",
    thinking: "high",
    target: { providerInstanceId: "bruv-normal", model: "worker/test", options: [{ id: "effort", value: "high" }] },
    runtimeMode: "full-access",
    interactionMode: "default",
  },
};
const call: PermissionRequest = {
  toolUseId: "use",
  toolName: "mcp__t3-code__delegate_task",
  owner: "app_owned",
  effect: "mcp",
  signal: new AbortController().signal,
  input: { prompt: "Work", target: { model: "root/expensive" } },
};
test("one actual CLI profile source, not connector-local subagents.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "app-worker-"));
  try {
    await writeFile(join(dir, "native-app-worker.json"), JSON.stringify(root));
    await writeFile(join(dir, "subagents.json"), JSON.stringify({ normal: { model: "root/wrong", thinking: "low" } }));
    const path = join(dir, "actual-cli-subagents.json");
    await writeFile(path, JSON.stringify({ normal: { model: "worker/test", thinking: "high" } }));
    expect(await loadAppWorkerPolicy(dir, path)).toEqual(root);
    await writeFile(path, JSON.stringify({ normal: { model: "worker/test", thinking: "low" } }));
    await expect(loadAppWorkerPolicy(dir, path)).rejects.toThrow("CLI subagents.json");
    expect(profilesPath()).toMatch(/\.bruv\/subagents.json$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("root replaces model input with explicit normal instance/model/thinking", () => {
  const actual = prepareAppWorkerCall(root, call);
  expect(actual.input.target).toEqual(root.worker.target);
  expect(call.input.target).toEqual({ model: "root/expensive" });
  expect(() => assertAppWorkerCall(root, actual)).not.toThrow();
  expect(() => assertAppWorkerCall(root, call)).toThrow("Human-updated");
});
test("ordinary MCP is not an app task; missing policy and normal workers cannot launch", () => {
  expect(prepareAppWorkerCall(undefined, { ...call, owner: "external" })).toEqual({ ...call, owner: "external" });
  for (const policy of [undefined, { role: "normal", depth: 1 } as const, { role: "normal", depth: 2 } as const]) {
    expect(() => prepareAppWorkerCall(policy, call)).toThrow("normal workers cannot delegate");
    for (const tool of ["create_threads", "t3_thread_launch"])
      expect(() => prepareAppWorkerCall(policy, { ...call, toolName: "mcp__t3-code__" + tool })).toThrow();
    expect(prepareAppWorkerCall(policy, { ...call, toolName: "mcp__t3-code__task_status" })).toEqual({
      ...call,
      toolName: "mcp__t3-code__task_status",
    });
  }
  expect(() => prepareAppWorkerCall(root, { ...call, input: { profile: "orchestrator" } })).toThrow("normal workers");
});
test("malformed role/depth and mismatched thinking options fail before admission", async () => {
  const dir = await mkdtemp(join(tmpdir(), "app-worker-"));
  try {
    const path = join(dir, "cli.json");
    await writeFile(path, JSON.stringify({ normal: { model: "worker/test", thinking: "high" } }));
    for (const value of [
      { role: "normal", depth: 0 },
      { role: "orchestrator", depth: 1, worker: root.worker },
      { ...root, worker: { ...root.worker, target: { ...root.worker.target, options: [] } } },
    ]) {
      await writeFile(join(dir, "native-app-worker.json"), JSON.stringify(value));
      await expect(loadAppWorkerPolicy(dir, path)).rejects.toThrow();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normal native launch pins the CLI model/thinking without inheriting root settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "normal-app-worker-"));
  try {
    const path = join(dir, "cli.json");
    await expect(loadNormalAppWorkerProfile(path)).rejects.toThrow("explicit CLI");
    await writeFile(path, JSON.stringify({ normal: { model: "worker/test", thinking: "medium" } }));
    const profile = await loadNormalAppWorkerProfile(path);
    expect(bindNormalAppWorker(profile, {})).toEqual(profile); // local initialize probe
    expect(bindNormalAppWorker(profile, { model: "worker/test", thinking: "adaptive" })).toEqual(profile);
    expect(() => bindNormalAppWorker(profile, { model: "root/other" })).toThrow("model must match");
    expect(() => bindNormalAppWorker(profile, { model: "worker/test", effort: "high" })).toThrow("thinking must match");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
