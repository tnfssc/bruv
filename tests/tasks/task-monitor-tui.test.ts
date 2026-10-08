import { expect, test } from "bun:test";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { prepareAgentSession } from "../../src/tasks/agent-session";
import { frameContaining, pollFrame } from "../helpers/tui-helpers";
import { withLiveJobTui, withTaskMonitorTerminal } from "./task-monitor-tui-fixture";

test("real TUI /ps selects live jobs and only stops the confirmed target", async () => {
  await withLiveJobTui(async ({ tmux, capture, target: name }) => {
    let frame: string;
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
  });
}, 20000);

test("real TUI /resume selects a durable child and requires explicit confirmation", async () => {
  await withTaskMonitorTerminal("bruv-resume-tui-", async ({ home, start, tmux, capture, target: name }) => {
    const sessions = join(home, "sessions");
    const root = SessionManager.create(home, sessions),
      rootFile = root.getSessionFile()!;
    const child = await prepareAgentSession(home, sessions, {
      type: "fast",
      model: "p/model",
      depth: 1,
      parentSessionFile: rootFile,
    });

    await start("--offline", "--no-approve", "--session", rootFile);
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
  });
}, 20000);
