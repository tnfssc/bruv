import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import bruvPackage from "../../package.json";

test("compiled web selects Vesper for this run, preserves settings and removes its theme file", async () => {
  const root = await mkdtemp(join(tmpdir(), "bruv-web-theme-test-"));
  const agent = join(root, "agent");
  await mkdir(agent);
  const settings = join(agent, "settings.json");
  const saved = JSON.stringify({ theme: "dark", lastChangelogVersion: bruvPackage.version }, null, 2);
  await Bun.write(settings, saved);
  const proc = Bun.spawn(
    [
      resolve(import.meta.dir, "../../dist/bruv"),
      "web",
      "--port",
      "0",
      "--",
      "--offline",
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
    ],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        TMPDIR: tmpdir(),
        HOME: root,
        LANG: "C.UTF-8",
        SHELL: "/bin/sh",
        BRUV_CODING_AGENT_DIR: agent,
        PI_CODING_AGENT_DIR: agent,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  let log = "",
    output = "";
  let socket: WebSocket | undefined;
  let themePath: string | undefined;
  void (async () => {
    for await (const chunk of proc.stdout) log += new TextDecoder().decode(chunk);
  })();
  const errors = new Response(proc.stderr).text();
  const until = async (check: () => boolean) => {
    const end = Date.now() + 8000;
    while (!check()) {
      if (Date.now() > end) throw new Error("Theme launch timed out: " + log + output);
      await Bun.sleep(20);
    }
  };
  try {
    await until(() => log.includes("#token="));
    const url = new URL(log.match(/http:\S+/)![0]);
    const token = new URLSearchParams(url.hash.slice(1)).get("token");
    socket = new WebSocket(url.origin.replace("http", "ws") + "/api/terminal", ["bruv", "bruv-token." + token], {
      headers: { Origin: url.origin },
    });
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "output") output += Buffer.from(message.data, "base64").toString();
    });
    await until(() => output.includes("gpt-4o"));
    socket.send(JSON.stringify({ type: "resize", cols: 120, rows: 32 }));
    await until(() => output.includes("\x1b[38;2;255;199;153m"));
    expect(output).toContain("\x1b[38;2;255;199;153m");
    const state = await (
      await fetch(url.origin + "/api/workspaces", { headers: { Authorization: "Bearer " + token, Origin: url.origin } })
    ).json();
    const pid = state.workspaces[0].tabs[0].pid;
    const command = (await readFile("/proc/" + pid + "/cmdline", "utf8")).split("\0");
    themePath = command[command.indexOf("--theme") + 1];
    expect(command[command.indexOf("--use-theme") + 1]).toBe("bruv-web-vesper");
    expect(await Bun.file(themePath!).exists()).toBe(true);
    expect(await Bun.file(settings).text()).toBe(saved);
    proc.kill("SIGTERM");
    expect(await proc.exited).toBe(0);
    expect(await errors).toBe("");
    expect(await Bun.file(themePath).exists()).toBe(false);
    expect(await Bun.file(settings).text()).toBe(saved);
  } finally {
    socket?.terminate();
    if (proc.exitCode === null) {
      proc.kill("SIGTERM");
      await proc.exited;
    }
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
