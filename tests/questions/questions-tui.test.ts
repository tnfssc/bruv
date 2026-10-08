import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { QuestionService } from "../../src/questions/service";
import { capturePane, frameContaining as waitForText } from "../helpers/tui-helpers";

const tmuxBinary = Bun.which("tmux");

// Own the server, process environment and composer handshake together. Restart
// replaces only the CLI session: the socket and durable session file stay put.
async function questionsTui(home: string, sessionFile: string, extensionFile: string) {
  const config = join(home, "config");
  const data = join(home, "data");
  const cache = join(home, "cache");
  const temp = join(home, "tmp");
  const sdk = join(home, "sdk");
  await Promise.all([config, data, cache, temp, sdk].map((path) => mkdir(path)));
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
    XDG_CACHE_HOME: cache,
    TMPDIR: temp,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    CLOUDSDK_CONFIG: sdk,
    SHELL: "/bin/sh",
    TERM: "xterm-256color",
    LANG: "C.UTF-8",
    HERDR_ENV: "0",
    OPENAI_API_KEY: "offline-test-placeholder",
  };
  const socket = "bruv-questions-" + process.pid + "-" + Date.now();
  const name = "questions";
  const tmux = (...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> =>
    new Promise((resolve, reject) => {
      execFile(tmuxBinary!, ["-L", socket, "-f", "/dev/null", ...args], { cwd: home, env }, (error, stdout, stderr) => {
        if (!error) resolve({ stdout, stderr, code: 0 });
        else if (typeof error.code === "number") resolve({ stdout, stderr, code: error.code });
        else reject(error);
      });
    });
  const checked = async (...args: string[]) => {
    const result = await tmux(...args);
    expect(result.code, result.stderr).toBe(0);
  };
  const frame = async () => (await capturePane(tmux, name)).stdout;
  const until = (text: string) => waitForText(frame, text, 100, 50);
  const start = async () => {
    // Multiple command arguments let tmux exec the CLI directly, without shell quoting.
    await checked(
      "new-session",
      "-d",
      "-s",
      name,
      "-x",
      "120",
      "-y",
      "35",
      "-c",
      home,
      resolve(import.meta.dir, "../../dist/bruv"),
      "--offline",
      "--no-approve",
      "--session",
      sessionFile,
      "--provider",
      "openai",
      "--model",
      "gpt-4o",
      "--extension",
      extensionFile,
    );
    // Keep the test-owned server alive while restart replaces its last session.
    await checked("set-option", "-g", "exit-empty", "off");
  };
  const send = async (text: string) => {
    await checked("send-keys", "-t", name, "-l", text);
    // Wait for literal keys to reach the composer before submitting.
    await until(" " + text);
    await checked("send-keys", "-t", name, "Enter");
    // Argument completion can consume Enter. Submit again only while this exact
    // command remains in the composer, never after it has already been sent.
    if (text.startsWith("/questions ")) {
      await Bun.sleep(80);
      if ((await frame()).includes(" " + text)) await checked("send-keys", "-t", name, "Enter");
    }
  };
  return {
    start,
    send,
    until,
    restart: async () => {
      await checked("kill-session", "-t", name);
      await start();
    },
    close: () => tmux("kill-server").catch(() => {}),
  };
}

test.skipIf(!tmuxBinary)(
  "real TUI keeps questions near composer after progress, cancellation and reload",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "bruv-questions-tui-"));
    const seed = SessionManager.create(home, join(home, "sessions"));
    seed.appendCustomEntry("question-test", { seed: true });
    const file = seed.getSessionFile()!;
    const service = new QuestionService();
    const ctx = { sessionManager: seed };

    await writeFile(file, [seed.getHeader(), ...seed.getEntries()].map((v) => JSON.stringify(v)).join("\n") + "\n");
    const q = await service.ask(ctx, {
      text: "Where is the crackle?",
      choices: ["Playback", "Recording", "Both"],
      requester: "Audio diagnosis",
    });
    await service.block(ctx, {
      id: q.id,
      owner: q.owner,
      version: q.version,
      checkpoint: "Need the next audio test",
      foreground: true,
    });
    const second = await service.ask(ctx, { text: "Second independent question?" });
    const fixture = join(home, "fixture.ts");
    await writeFile(
      fixture,
      `
export default function(pi) {
  pi.registerCommand("qprogress", {
    description: "test",
    handler: async () => {
      pi.sendMessage({
        customType: "question-test-progress",
        display: true,
        content: Array.from({ length: 50 }, (_, i) => "Independent progress " + i).join("\\n") +
          "\\nIndependent work complete",
      }, { triggerTurn: false });
    },
  });
}
`,
    );
    const tui = await questionsTui(home, file, fixture);
    try {
      await tui.start();
      await tui.until("2 /questions");
      await tui.send("/qprogress");
      expect(await tui.until("Independent work complete")).toContain("2 /questions");
      await tui.send("/questions detail " + q.id);
      const detailFrame = await tui.until("Audio diagnosis");
      expect(detailFrame).toContain("Need the next audio test");
      expect(detailFrame).toContain(q.id.slice(0, 10) + " [pending");
      expect(detailFrame).not.toContain(q.id + " [pending");
      if (process.env.BRUV_QUESTIONS_FRAME) await writeFile(process.env.BRUV_QUESTIONS_FRAME, detailFrame);
      await tui.send("/questions cancel " + second.id);
      await tui.until("1 /questions");
      await tui.restart();
      expect(await tui.until("1 /questions")).toContain("waiting");
      await tui.send("/questions detail " + q.id.slice(0, 10));
      const resumedDetail = await tui.until("Audio diagnosis");
      expect(resumedDetail).toContain(q.id.slice(0, 10) + " [pending");
      expect(resumedDetail).not.toContain(q.id + " [pending");
      expect(service.get(ctx, q.id).status).toBe("pending");
      expect(service.get(ctx, second.id).status).toBe("cancelled");
    } finally {
      await tui.close();
    }
    // Retain the mkdtemp fixture for inspection; no inherited HOME/config is used.
  },
  20000,
);
