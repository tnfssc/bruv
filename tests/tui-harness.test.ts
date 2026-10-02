import { afterAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { run } from "./helpers";

const socket = `bruv-test-${process.pid}-${Date.now()}`;
const harness = resolve(import.meta.dir, "../scripts/tui-harness.ts");
const env = {
  ...process.env,
  BRUV_TUI_SOCKET: socket,
  BRUV_TUI_TIMEOUT_SECONDS: "1",
};

async function harnessCommand(...args: string[]) {
  return run([process.execPath, harness, ...args], { env });
}

async function hasSession(name: string): Promise<boolean> {
  return (await run(["tmux", "-L", socket, "has-session", "-t", name], { env })).code === 0;
}

afterAll(async () => {
  await run(["tmux", "-L", socket, "kill-server"], { env });
});

describe("interactive TUI harness", () => {
  test("provides its inspection and interaction commands", async () => {
    const result = await harnessCommand("--help");

    expect(result.code).toBe(0);
    for (const command of ["frame", "history", "send", "followup", "key", "record", "stop"]) {
      expect(result.stdout).toContain(command);
    }
  });

  test("duplicate start refuses an existing session without replacing it", async () => {
    expect((await run(["tmux", "-L", socket, "new-session", "-d", "-s", "existing", "sleep 60"], { env })).code).toBe(
      0,
    );
    const duplicate = await harnessCommand("start", "existing", "--offline", "--no-session");
    expect(duplicate.code).not.toBe(0);
    expect(duplicate.stderr).toContain("Session already exists: existing");
    expect(await hasSession("existing")).toBe(true);
    expect((await harnessCommand("stop", "existing")).code).toBe(0);
  });

  test("invalid session names are rejected", async () => {
    const invalid = await harnessCommand("start", "bad.name", "--offline");
    expect(invalid.code).not.toBe(0);
    expect(invalid.stderr).toContain("Session names may contain");
    expect(await hasSession("bad.name")).toBe(false);
  });

  test("auto-kills only the session named demo", async () => {
    const demo = await harnessCommand("start", "demo", "--offline", "--no-session");
    expect(demo.code).toBe(0);
    expect(demo.stdout).toContain("Auto-kill:");

    const regular = await harnessCommand("start", "regular", "--offline", "--no-session");
    expect(regular.code).toBe(0);
    expect(regular.stdout).not.toContain("Auto-kill:");

    await Bun.sleep(1_500);
    expect(await hasSession("demo")).toBe(false);
    expect(await hasSession("regular")).toBe(true);

    const stopped = await harnessCommand("stop", "regular");
    expect(stopped.code).toBe(0);
  }, 10_000);
});
