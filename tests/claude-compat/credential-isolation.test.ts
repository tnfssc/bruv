import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  childAgentEnvironment,
  scrubT3BridgeEnvironment,
  scrubRootEnvironmentInPlace,
} from "../../src/delegation-environment";
import { remoteChildEnvironment } from "../../src/remote/placement";
import { sshControl } from "../../src/remote/ssh";
import { TaskManager } from "../../src/tasks/task-manager";
import { executeIsolated } from "../../src/typescript/execution";

const environment = {
  T3_MCP_URL: "old-url",
  T3_MCP_BEARER_TOKEN: "old-secret",
  T3_ACP_MCP_URL: "new-url",
  T3_ACP_MCP_BEARER_TOKEN: "new-secret",
  T3_SESSION_ID: "root-session",
  T3_ACP_ORCHESTRATOR: "root-control",
  BRUV_T3_SCOPE: "scope",
  BRUV_ROOT_RUNTIME_TOKEN: "root-secret",
  BRUV_ROOT_RUNTIME_SOCKET: "root.sock",
  BRUV_REMOTE_ROOT_SESSION: "remote-root",
  BRUV_REMOTE_RUNTIME_STATE: "/owner/checkpoint",
  ANTHROPIC_API_KEY: "configured-anthropic",
  OPENAI_API_KEY: "configured-openai",
  GOOGLE_API_KEY: "configured-google",
  HOME: "/configured/home",
  PATH: process.env.PATH,
  T3CODE_PROJECT_ROOT: "/workspace",
  BRUV_AGENT_PLACE: "server",
};
const code =
  "JSON.stringify({ controls: Object.keys(process.env).filter(k => k.startsWith('T3_') || k.startsWith('BRUV_T3_') || k.startsWith('BRUV_ROOT_') || k.startsWith('BRUV_REMOTE_ROOT_')), provider: process.env.OPENAI_API_KEY })";
function installEnv() {
  const previous = new Map(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
test("one factory strips old/new root controls, not configured providers or CLI workspace state", () => {
  const clean = scrubT3BridgeEnvironment(environment);
  expect(clean).toEqual({
    BRUV_REMOTE_RUNTIME_STATE: "/owner/checkpoint",
    ANTHROPIC_API_KEY: "configured-anthropic",
    OPENAI_API_KEY: "configured-openai",
    GOOGLE_API_KEY: "configured-google",
    HOME: "/configured/home",
    PATH: process.env.PATH,
    T3CODE_PROJECT_ROOT: "/workspace",
    BRUV_AGENT_PLACE: "server",
  });
  expect(childAgentEnvironment(environment).BRUV_REMOTE_RUNTIME_STATE).toBeUndefined();
  const remote = remoteChildEnvironment(environment);
  expect(remote.T3_ACP_MCP_BEARER_TOKEN).toBeUndefined();
  expect(remote.BRUV_ROOT_RUNTIME_TOKEN).toBeUndefined();
  expect(remote.BRUV_REMOTE_RUNTIME_STATE).toBeUndefined();
  expect(remote.OPENAI_API_KEY).toBe("configured-openai");
  expect(remote.BRUV_SUBAGENT_TYPE).toBe("normal");
  expect(environment.T3_MCP_BEARER_TOKEN).toBe("old-secret");
  const root: NodeJS.ProcessEnv = { ...environment };
  scrubRootEnvironmentInPlace(root);
  expect(root).toEqual(clean);
});
test("actual shell/local task subprocess cannot inherit root controls even via explicit env", async () => {
  const manager = new TaskManager(() => {});
  try {
    const task = manager.spawn({
      kind: "command",
      command: process.execPath,
      args: ["-e", "console.log(" + code + ")"],
      displayCommand: "credential fixture",
      cwd: process.cwd(),
      env: environment,
      closeStdin: true,
    });
    const result = await manager.wait(task.id);
    expect(result.status).toBe("completed");
    expect(JSON.parse(result.output)).toEqual({ controls: [], provider: "configured-openai" });
    const agent = manager.spawn({
      kind: "agent",
      command: process.execPath,
      args: [
        "-e",
        "console.log(" + code + "); console.log(process.env.BRUV_REMOTE_RUNTIME_STATE ?? 'child-checkpoint-absent')",
      ],
      displayCommand: "local agent environment fixture",
      cwd: process.cwd(),
      env: childAgentEnvironment(environment),
      closeStdin: true,
    });
    const agentResult = await manager.wait(agent.id);
    expect(agentResult.status).toBe("completed");
    const lines = agentResult.output.trim().split("\n");
    expect(JSON.parse(lines[0])).toEqual({ controls: [], provider: "configured-openai" });
    expect(lines[1]).toBe("child-checkpoint-absent");
  } finally {
    manager.shutdown();
  }
});
test("actual arbitrary TypeScript child is scrubbed and keeps configured provider auth", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-mcp-execute-env-"));
  const launcher = join(dir, "runner.ts");
  await writeFile(
    launcher,
    "#!" +
      process.execPath +
      "\nimport { runTypeScriptFromStdin } from " +
      JSON.stringify(resolve("src/typescript/runner.ts")) +
      ";\nawait runTypeScriptFromStdin();\n",
    { mode: 0o700 },
  );
  const restore = installEnv();
  try {
    const result = await executeIsolated("console.log(" + code + ")", process.cwd(), undefined, 3000, {
      executablePath: launcher,
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ controls: [], provider: "configured-openai" });
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});
test("SSH bootstrap subprocess and destination child environment never get root controls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-mcp-ssh-env-"));
  await writeFile(join(dir, "ssh"), "#!" + process.execPath + "\nconsole.log(" + code + ");\n", { mode: 0o700 });
  const restore = installEnv();
  process.env.PATH = dir + ":" + process.env.PATH;
  try {
    expect(
      await sshControl<{ controls: string[]; provider: string }>("--remote-control", "fixture-host", "bruv", {
        fixture: true,
      }),
    ).toEqual({
      controls: [],
      provider: "configured-openai",
    });
  } finally {
    restore();
    await rm(dir, { recursive: true, force: true });
  }
});
