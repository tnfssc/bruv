import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import net, { type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "../helpers/helpers";
import { frameContaining, shellQuote } from "../helpers/tui-helpers";

test("test subprocesses strip Herdr identity while preserving a caller-provided API key", async () => {
  const source = {
    ...process.env,
    HERDR_ENV: "1",
    HERDR_SOCKET_PATH: "/host/herdr.sock",
    HERDR_PANE_ID: "host-pane",
    OPENAI_API_KEY: "offline-test-placeholder",
  };
  const result = await run(
    [
      process.execPath,
      "-e",
      `process.stdout.write(JSON.stringify({
        herdrEnabled: process.env.HERDR_ENV,
        socketPath: process.env.HERDR_SOCKET_PATH ?? null,
        paneId: process.env.HERDR_PANE_ID ?? null,
        apiKey: process.env.OPENAI_API_KEY,
      }))`,
    ],
    { env: source },
  );

  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    herdrEnabled: "0",
    socketPath: null,
    paneId: null,
    apiKey: "offline-test-placeholder",
  });
  expect(source.HERDR_ENV).toBe("1");
  expect(source.HERDR_SOCKET_PATH).toBe("/host/herdr.sock");
  expect(source.HERDR_PANE_ID).toBe("host-pane");
});

test("test TUI startup sends no Herdr requests from an inherited pane identity", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruv-offline-isolation-"));
  const herdrSocket = join(home, "recording.sock");
  const paneId = "real-looking-host-pane";
  const requests: Array<{ method?: string; params?: { pane_id?: string } }> = [];
  const connections = new Set<Socket>();
  const server = net.createServer((socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
    let input = "";
    socket.on("data", (chunk) => {
      input += chunk.toString();
      for (let newline = input.indexOf("\n"); newline >= 0; newline = input.indexOf("\n")) {
        requests.push(JSON.parse(input.slice(0, newline)));
        input = input.slice(newline + 1);
        socket.write('{"ok":true}\n');
      }
    });
  });
  // Each tmux command gets a deliberately hostile source environment. run() must
  // sanitize it before the fresh tmux server (and its TUI child) can inherit it.
  const inheritedEnv = {
    ...process.env,
    HERDR_ENV: "1",
    HERDR_SOCKET_PATH: herdrSocket,
    HERDR_PANE_ID: paneId,
  };
  const tmuxSocket = `bruv-offline-isolation-${process.pid}-${Date.now()}`;
  const tmux = (...args: string[]) => run(["tmux", "-L", tmuxSocket, ...args], { env: inheritedEnv });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(herdrSocket, resolve);
    });
    const launch = [
      "env",
      "HOME=" + home,
      "BRUV_SUBAGENT_DEPTH=0",
      "BRUV_SUBAGENT_TYPE=",
      "BRUV_CODING_AGENT_DIR=" + join(home, ".bruv", "agent"),
      "OPENAI_API_KEY=offline-test-placeholder",
      resolve(import.meta.dir, "../../dist/bruv"),
      "--offline",
      "--no-approve",
      "--no-session",
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
    ]
      .map(shellQuote)
      .join(" ");
    expect(
      (
        await tmux(
          "-f",
          resolve(import.meta.dir, "../../scripts/tui/tmux.conf"),
          "new-session",
          "-d",
          "-s",
          "isolation",
          "-x",
          "100",
          "-y",
          "30",
          "-c",
          home,
          launch,
        )
      ).code,
    ).toBe(0);

    await frameContaining(async () => (await tmux("capture-pane", "-p", "-t", "isolation")).stdout, "gpt-4o", 80);
    await tmux("kill-server");
    await Bun.sleep(400);

    // This observes startup and a short post-kill window, not all descendants'
    // lifetimes or provider/network isolation. The run helper has no timeout.
    expect(requests).toEqual([]);
  } finally {
    await tmux("kill-server").catch(() => ({ code: 1, stdout: "", stderr: "" }));
    for (const socket of connections) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  }
}, 15_000);
