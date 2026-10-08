import { expect } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { run } from "../helpers/helpers";
import { capturePane } from "../helpers/tui-helpers";

type MonitorTerminal = {
  home: string;
  target: string;
  tmux: (...args: string[]) => ReturnType<typeof run>;
  capture: () => Promise<string>;
  start: (...args: string[]) => Promise<void>;
};

/** Own the tmux server and all HOME/config/SDK paths for one native TUI journey.
 * Keep the mkdtemp tree and its model/session/readiness files for parent audit.
 */
export async function withTaskMonitorTerminal(
  prefix: string,
  check: (terminal: MonitorTerminal) => Promise<void>,
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), prefix));
  const agentDir = join(home, ".bruv", "agent");
  const env = {
    PATH: dirname(process.execPath) + ":/usr/bin:/bin",
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_STATE_HOME: join(home, "state"),
    XDG_RUNTIME_DIR: join(home, "runtime"),
    TMPDIR: join(home, "tmp"),
    TMUX_TMPDIR: join(home, "tmp"),
    BRUV_CODING_AGENT_DIR: agentDir,
    TERM: "xterm-256color",
    LANG: "C.UTF-8",
  };
  for (const path of [
    agentDir,
    env.XDG_CONFIG_HOME,
    env.XDG_CACHE_HOME,
    env.XDG_DATA_HOME,
    env.XDG_STATE_HOME,
    env.XDG_RUNTIME_DIR,
    env.TMPDIR,
  ]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  const target = "monitor";
  const tmux = (...args: string[]) => run(["tmux", "-L", "monitor", "-f", "/dev/null", ...args], { env, cwd: home });
  const capture = async () => (await capturePane(tmux, target)).stdout;
  const start = async (...args: string[]) => {
    // Multiple tmux command arguments execute the binary directly, without a shell.
    const result = await tmux(
      "new-session",
      "-d",
      "-s",
      target,
      "-x",
      "100",
      "-y",
      "30",
      "-c",
      home,
      resolve(import.meta.dir, "../../dist/bruv"),
      ...args,
    );
    expect(result.code, result.stderr).toBe(0);
  };
  try {
    await check({ home, target, tmux, capture, start });
  } finally {
    await tmux("kill-server").catch(() => ({ code: 1, stdout: "", stderr: "" }));
  }
}

/** Launch the controlled provider and cross the real submit-handler handshake
 * before the test can start any jobs. Provider and terminal stop on every exit.
 */
export async function withLiveJobTui(check: (terminal: MonitorTerminal) => Promise<void>): Promise<void> {
  await withTaskMonitorTerminal("bruv-ps-tui-", async (terminal) => {
    const { home, tmux, capture, target: name } = terminal;
    const agentDir = join(home, ".bruv", "agent");
    let requests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        requests++;
        await request.json();
        const first = requests === 1;
        const delta = first
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "fixture_call",
                  type: "function",
                  function: {
                    name: "execute",
                    arguments: JSON.stringify({
                      // Job liveness must depend on test actions, not scheduler or PTY latency.
                      code: `const a=await shell("sh -c 'while :; do echo ALPHA-live; sleep 1; done'",{waitSeconds:0}); const b=await shell("sh -c 'while :; do echo BETA-live; sleep 1; done'",{waitSeconds:0}); console.log(a.id,b.id)`,
                    }),
                  },
                },
              ],
            }
          : { role: "assistant", content: "FIXTURE_READY" };
        const finish = first ? "tool_calls" : "stop",
          model = "fixture-model",
          created = Math.floor(Date.now() / 1000);
        const events = [
          {
            id: "fixture",
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta, finish_reason: null }],
          },
          {
            id: "fixture",
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: finish }],
          },
        ];
        return new Response(
          events.map((value) => "data: " + JSON.stringify(value) + "\n\n").join("") + "data: [DONE]\n\n",
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });

    try {
      await writeFile(
        join(agentDir, "models.json"),
        JSON.stringify({
          providers: {
            fixture: {
              baseUrl: "http://127.0.0.1:" + server.port + "/v1",
              api: "openai-completions",
              apiKey: "fixture",
              models: [{ id: "fixture-model", name: "fixture", contextWindow: 32000, maxTokens: 1000 }],
            },
          },
        }),
      );
      // This extension is a controlled slow startup step. Registration alone does not
      // mean it is ready. The safe command handshake below proves that the normal
      // submit handler accepts extension commands.
      const readinessMarker = join(home, "startup-readiness.marker");
      const readinessExtension = join(home, "startup-readiness.ts");
      await writeFile(
        readinessExtension,
        `export default async function (pi) {
  await new Promise((resolve) => setTimeout(resolve, 5500));
  pi.registerCommand("bruv-test-ready", {
    description: "TUI startup handshake",
    handler: async (_args, ctx) => ctx.ui.notify("BRUV_TEST_READY", "info"),
  });
  await Bun.write(${JSON.stringify(readinessMarker)}, "registered");
}`,
      );

      await terminal.start(
        "--no-approve",
        "--no-session",
        "--provider",
        "fixture",
        "--model",
        "fixture-model",
        "--extension",
        readinessExtension,
      );
      let frame = "";
      const startupDeadline = Date.now() + 30_000;
      while (Date.now() < startupDeadline) {
        frame = await capture();
        if (frame.includes("fixture-model")) break;
        await Bun.sleep(50);
      }
      expect(frame).toContain("fixture-model");

      // Do not use handleStartupSubmit's status as readiness: the SDK only sets
      // that status *after* a premature submit. The fixture's explicit marker is
      // written after its command is registered. Only its UI response below proves
      // that managed-tool setup and the editor submit-handler transition finished.
      while (Date.now() < startupDeadline) {
        if (await Bun.file(readinessMarker).exists()) break;
        await Bun.sleep(50);
      }
      expect(await Bun.file(readinessMarker).exists()).toBe(true);
      await tmux("send-keys", "-t", name, "-l", "/bruv-test-ready");
      // This is a harmless command probe, not a prompt: retrying it cannot start
      // another job. It is complete only when the real submit handler accepts it.
      while (Date.now() < startupDeadline) {
        await tmux("send-keys", "-t", name, "Enter");
        frame = await capture();
        if (frame.includes("BRUV_TEST_READY")) break;
        await Bun.sleep(50);
      }
      expect(frame).toContain("BRUV_TEST_READY");
      // The readiness probe is not an LLM turn and must not create duplicate work.
      expect(requests).toBe(0);

      await check(terminal);
    } finally {
      server.stop(true);
    }
  });
}
