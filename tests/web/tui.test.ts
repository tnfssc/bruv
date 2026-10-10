import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { startWebServer } from "../../src/web/server";
import { loadWebAssets } from "../../src/web/assets";

test("compiled Bruv starts its actual TUI through authenticated PTY and shuts down", async () => {
  const scratch = resolve(import.meta.dir, "../../.tmp");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "bruv-web-tui-"));
  const project = join(root, "project");
  await mkdir(project);
  const agent = join(root, "agent");
  await mkdir(agent, { recursive: true });
  const executable = resolve(import.meta.dir, "../../dist/bruv");
  expect(await Bun.file(executable).exists()).toBe(true);
  const app = startWebServer({
    port: 0,
    assets: await loadWebAssets(),
    cwd: project,
    command: [executable, "--offline", "--approve", "--provider", "openai", "--model", "gpt-4o"],
    env: {
      PATH: process.env.PATH,
      HOME: root,
      LANG: "C.UTF-8",
      SHELL: "/bin/sh",
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_STATE_HOME: join(root, "state"),
      BRUV_CODING_AGENT_DIR: agent,
      PI_CODING_AGENT_DIR: agent,
    },
  });
  const socket = new WebSocket(
    app.origin.replace("http", "ws") + "/api/terminal",
    ["bruv", "bruv-token." + app.token],
    { headers: { Origin: app.origin } },
  );
  let output = "";
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type === "output") output += Buffer.from(message.data, "base64").toString();
  });
  const waitFor = async (text: string) => {
    const end = Date.now() + 8000;
    while (!output.includes(text)) {
      if (Date.now() > end) throw new Error("TUI did not render " + text + ": " + output.slice(-3000));
      await Bun.sleep(20);
    }
  };
  try {
    await waitFor("gpt-4o");
    expect(output).toContain("\x1b[");
    socket.send(JSON.stringify({ type: "resize", cols: 99, rows: 32 }));
    socket.send(JSON.stringify({ type: "input", data: "browser-terminal-proof" }));
    await waitFor("browser-terminal-proof");
    const pid = app.terminal.pid!;
    await app.stop();
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    socket.terminate();
    await app.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
