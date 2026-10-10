import type { CustomMessageEntryDraft, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Jobs, Result } from "./jobs";

export function report(item: Result): CustomMessageEntryDraft {
  const header = `${item.id} ${item.title.slice(0, 120)} · ${item.status} · ${item.elapsedSeconds}s\n`;
  const paths = `\nOutput: ${item.outputPath}${item.sessionPath ? `\nSession: ${item.sessionPath}` : ""}${
    item.worktree ? `\nWorktree: ${item.worktree.path} (${item.worktree.branch})` : ""
  }`;
  const body = item.answer || item.output;
  const space = Math.max(0, 4000 - header.length - paths.length);
  const content = `${header}${space ? body.slice(-space) : ""}${paths}`.slice(0, 4000);
  return {
    type: "custom_message",
    customType: "bruv-report",
    content,
    display: true,
    details: { id: item.id, title: item.title, status: item.status },
  };
}

export function registerSettle(pi: ExtensionAPI, jobs: Jobs) {
  let reminded = false;
  const flush = (idle = true) => {
    for (const item of jobs.items.values()) {
      if (item.status === "running" || item.seen || !idle) continue;
      item.seen = true;
      pi.sendMessage(report(jobs.result(item)), { deliverAs: "nextTurn" });
    }
  };
  let changed: () => void;
  pi.on("session_start", (_event, ctx) => {
    reminded = false;
    jobs.listeners.delete(changed);
    changed = () => flush(ctx.isIdle());
    jobs.listeners.add(changed);
  });
  pi.on("session_shutdown", () => {
    jobs.listeners.delete(changed);
  });
  pi.on("tool_call", (event) => {
    if (["wait", "job_start", "agent"].includes(event.toolName)) reminded = false;
  });
  pi.on("agent_settled", (event) => {
    flush();
    if (!event.aborted) return;
    // Esc in the terminal and Stop in T3 both end everything the session started.
    // Report once the processes have exited; the run has settled by then.
    const running = [...jobs.items.values()].filter((item) => item.status === "running");
    for (const item of running) jobs.stop(item.id);
    void Promise.all(running.map((item) => item.completion)).then(() => flush());
  });
  pi.on("agent_before_settle", (event) => {
    if (event.outcome === "aborted") return {};
    const items = [...jobs.items.values()].filter((item) => !item.detached);
    const done = items.filter((item) => item.status !== "running" && !item.seen);
    if (done.length) {
      for (const item of done) item.seen = true;
      return { entries: done.map((item) => report(jobs.result(item))), continue: true };
    }
    const running = items.filter((item) => item.status === "running");
    if (running.length && !reminded) {
      reminded = true;
      const entry: CustomMessageEntryDraft = {
        type: "custom_message",
        customType: "bruv-report",
        content: `${running.map((item) => `${item.id} ${item.title}`).join("\n")}\nThis work is still running. Call tools.wait to get the results, tools.job_stop to stop it, or end your turn again to leave it running; its results will come with the next message.`,
        display: true,
      };
      return { entries: [entry], continue: true };
    }
    return {};
  });
}
