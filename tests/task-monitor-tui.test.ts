import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { prepareAgentSession } from "../src/tasks/agent-session";
import { capturePane, frameContaining, pollFrame, shellQuote as quote, tmuxRunner } from "./tui-helpers";

test("real TUI /ps selects live jobs and only stops the confirmed target", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruv-ps-tui-")),
    agentDir = join(home, ".bruv", "agent");
  await mkdir(agentDir, { recursive: true });
  let requests = 0;
  const server = Bun.serve({
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
  const socket = "bruv-ps-" + process.pid + "-" + Date.now(),
    name = "ps";
  const tmux = tmuxRunner(socket);
  const capture = async () => (await capturePane(tmux, name)).stdout;
  try {
    const binary = resolve(import.meta.dir, "../dist/bruv"),
      launch = [
        "env",
        "HOME=" + home,
        "BRUV_CODING_AGENT_DIR=" + agentDir,
        binary,
        "--no-approve",
        "--no-session",
        "--provider",
        "fixture",
        "--model",
        "fixture-model",
        "--extension",
        readinessExtension,
      ]
        .map(quote)
        .join(" ");
    expect((await tmux("new-session", "-d", "-s", name, "-x", "100", "-y", "30", "-c", home, launch)).code).toBe(0);
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
    await tmux("send-keys", "-t", name, "-l", "start");
    await tmux("send-keys", "-t", name, "Enter");
    frame = await pollFrame(capture, (frame) => frame.includes("FIXTURE_READY"), 120);
    expect(frame).toContain("FIXTURE_READY");
    await tmux("send-keys", "-t", name, "-l", "/ps");
    await tmux("send-keys", "-t", name, "Enter");
    // The transcript already names both jobs before /ps opens. Wait for the
    // focused monitor's own view/controls before sending its inspect key.
    frame = await frameContaining(capture, ["Running jobs", "Live preview", "Enter/i inspect", "ALPHA", "BETA"]);
    expect(frame).toContain("ALPHA");
    expect(frame).toContain("BETA");
    const selectedTaskId = frame
      .slice(frame.lastIndexOf("Running jobs"))
      .match(/› (task_\w+) \[command\] .*ALPHA-live/)?.[1];
    expect(selectedTaskId).toBeDefined();
    await tmux("send-keys", "-t", name, "Enter");
    // A spawned job can be listed before its first stdout chunk arrives. Wait for
    // output in the actual inspect view, not a guessed process-startup delay.
    frame = await frameContaining(capture, ["Inspect task_", "ALPHA-live"]);
    expect(frame).toContain("Inspect task_");
    expect(frame).toContain("ALPHA");
    const alphaTaskId = frame.match(/Inspect (task_\w+)/)?.[1];
    expect(alphaTaskId).toBeDefined();
    expect(alphaTaskId).toBe(selectedTaskId);
    await tmux("send-keys", "-t", name, "-l", "i");
    frame = await pollFrame(capture, (frame) => frame.includes("Running jobs") && !frame.includes("Inspect task_"));
    expect(frame).toContain("Running jobs");
    expect(frame).not.toContain("Inspect task_");
    await tmux("send-keys", "-t", name, "Down");
    frame = await pollFrame(capture, (frame) => frame.slice(frame.lastIndexOf("Live preview")).includes("BETA-live"));
    expect(frame).toContain("BETA-live");
    expect(frame.slice(frame.lastIndexOf("Live preview"))).toContain("BETA-live");
    await tmux("send-keys", "-t", name, "x");
    frame = await frameContaining(capture, ["Stop task_", "BETA"]);
    expect(frame).toContain("Stop task_");
    expect(frame).toContain("BETA");
    const stoppedTaskId = frame.match(/Stop (task_\w+)/)?.[1];
    expect(stoppedTaskId).toBeDefined();
    expect(stoppedTaskId).not.toBe(alphaTaskId);
    // Opening the confirmation must not stop either task.
    const jobsBeforeConfirmation = frame.slice(frame.lastIndexOf("Running jobs"));
    expect(jobsBeforeConfirmation).toContain(alphaTaskId!);
    expect(jobsBeforeConfirmation).toContain(stoppedTaskId!);
    expect(jobsBeforeConfirmation).toContain("ALPHA");
    expect(jobsBeforeConfirmation).toContain("BETA");
    expect(frame).not.toContain("⊘ sh -c 'while :; do echo BETA-live; sleep 1; done' — cancelled");
    await tmux("send-keys", "-t", name, "y");
    frame = await pollFrame(capture, (frame) => {
      const running = frame.slice(frame.lastIndexOf("Running jobs"));
      return (
        frame.includes("1 cancelled") &&
        running.includes(alphaTaskId!) &&
        running.includes("ALPHA") &&
        !running.includes(stoppedTaskId!) &&
        !running.includes("BETA")
      );
    });
    expect(frame).toContain("1 tool called · 1 cancelled · 1 running");
    const remainingJobs = frame.slice(frame.lastIndexOf("Running jobs"));
    expect(remainingJobs).toContain(alphaTaskId!);
    expect(remainingJobs).toContain("ALPHA");
    expect(remainingJobs).not.toContain(stoppedTaskId!);
    expect(remainingJobs).not.toContain("BETA");
    expect(frame).not.toContain("⊘ sh -c 'while :; do echo ALPHA-live; sleep 1; done' — cancelled");
    await tmux("send-keys", "-t", name, "Escape");
    frame = await pollFrame(capture, (frame) => !frame.includes("Running jobs"));
    expect(frame).not.toContain("Running jobs");
    // The collapsed source group summarizes outcomes. Open its child rows to
    // retain the exact original cancelled-job proof, without expanding details.
    await tmux("send-keys", "-t", name, "-l", "/activity");
    await tmux("send-keys", "-t", name, "Enter");
    await frameContaining(capture, ["Activity —", "Esc returns"]);
    await tmux("send-keys", "-t", name, "Enter");
    frame = await frameContaining(capture, "⊘ sh -c 'while :; do echo BETA-live; sleep 1; done' — cancelled");
    expect(frame).not.toContain("⊘ sh -c 'while :; do echo ALPHA-live; sleep 1; done' — cancelled");
    expect(frame).not.toContain("console.log");
  } finally {
    server.stop(true);
    await tmux("kill-server").catch(() => ({ code: 1, stdout: "", stderr: "" }));
    await rm(home, { recursive: true, force: true });
  }
}, 20000);

test("real TUI /resume selects a durable child and requires explicit confirmation", async () => {
  const home = await mkdtemp(join(tmpdir(), "bruv-resume-tui-")),
    sessions = join(home, "sessions");
  const root = SessionManager.create(home, sessions),
    rootFile = root.getSessionFile()!;
  const child = await prepareAgentSession(home, sessions, {
    type: "fast",
    model: "p/model",
    depth: 1,
    parentSessionFile: rootFile,
  });
  const socket = "bruv-resume-" + process.pid + "-" + Date.now(),
    name = "resume";
  const tmux = tmuxRunner(socket);

  const capture = async () => (await capturePane(tmux, name)).stdout;
  try {
    const binary = resolve(import.meta.dir, "../dist/bruv");
    const launch = [
      "env",
      "HOME=" + home,
      "BRUV_CODING_AGENT_DIR=" + join(home, ".bruv", "agent"),
      binary,
      "--offline",
      "--no-approve",
      "--session",
      rootFile,
    ]
      .map(quote)
      .join(" ");
    expect((await tmux("new-session", "-d", "-s", name, "-x", "100", "-y", "30", "-c", home, launch)).code).toBe(0);
    let frame = await pollFrame(capture, (frame) => frame.includes("/model"), 100);
    await tmux("send-keys", "-t", name, "-l", "/resume");
    await tmux("send-keys", "-t", name, "Enter");
    frame = await pollFrame(capture, (frame) => frame.includes("worker") && frame.includes("fast"), 100);
    expect(frame).toContain("worker");
    expect(frame).toContain("fast");
    await tmux("send-keys", "-t", name, "Enter");
    frame = await pollFrame(capture, (frame) => frame.includes("Enter worker child (fast) session?"), 100);
    expect(frame).toContain("Enter worker child (fast) session?");
    expect(frame).toContain(child.id);
    await tmux("send-keys", "-t", name, "Down", "Enter");
    await Bun.sleep(600);
    frame = await capture();
    expect(frame).not.toContain("Enter worker child (fast) session?");
  } finally {
    await tmux("kill-server").catch(() => ({ code: 1, stdout: "", stderr: "" }));
    await rm(home, { recursive: true, force: true });
  }
}, 20000);
