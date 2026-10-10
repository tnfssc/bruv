import type { CustomMessageEntryDraft, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Jobs, Result, Work } from "./jobs";

export function report(item: Result): CustomMessageEntryDraft {
  const running = item.status === "running";
  const header = `${item.id} ${item.title.slice(0, 120)} · ${item.status} · ${item.elapsedSeconds}s\n`;
  const paths = `\nOutput: ${item.outputPath}${item.sessionPath ? `\nSession: ${item.sessionPath}` : ""}${
    item.worktree ? `\nWorktree: ${item.worktree.path} (${item.worktree.branch})` : ""
  }`;
  const hint = running ? "\nStop it with tools.job_stop if it's stuck." : "";
  const body = running ? item.output.split("\n").slice(-20).join("\n") : item.answer || item.output;
  const space = Math.max(0, 4000 - header.length - paths.length - hint.length);
  const content = `${header}${space ? body.slice(-space) : ""}${hint}${paths}`.slice(0, 4000);
  return {
    type: "custom_message",
    customType: "bruv-report",
    content,
    display: true,
    details: { id: item.id, title: item.title, status: item.status },
  };
}

export function registerSettle(pi: ExtensionAPI, jobs: Jobs, waitSeconds = 30) {
  let active = false;
  let closing = false;
  let returned: Work[] = [];
  const flush = () => {
    if (closing) return;
    for (const item of jobs.items.values()) {
      if (item.status === "running" || item.reported || (active && !item.nextTurn)) continue;
      item.reported = true;
      pi.sendMessage(report(jobs.result(item)), { deliverAs: "nextTurn" });
    }
  };
  jobs.listeners.add(flush);
  pi.on("session_start", () => {
    closing = false;
    active = false;
    returned = [];
  });
  pi.on("session_shutdown", () => {
    closing = true;
  });
  pi.on("before_agent_start", () => {
    active = true;
  });
  pi.on("before_provider_request", () => {
    returned = [];
  });
  pi.on("agent_settled", (event) => {
    active = false;
    // Pi can finish a handler after abort, then skip its requested continuation.
    if (event.aborted) for (const item of returned) item.reported = false;
    returned = [];
    for (const item of jobs.items.values()) if (!item.reported) item.nextTurn = true;
    flush();
  });
  pi.on("agent_before_settle", async (_event, ctx) => {
    const pending = () => [...jobs.items.values()].filter((item) => !item.reported && !item.nextTurn);
    let items = pending();
    if (!items.length) return {};
    if (items.every((item) => item.status === "running")) {
      // Pi waits for this handler even on abort. End the run after one quiet slice.
      await jobs.wait(
        items.map((item) => item.id),
        false,
        waitSeconds,
        () => ctx.hasPendingMessages(),
      );
      // wait marks completed results as read; this handler still has to return them.
      for (const item of items) if (item.status !== "running") item.reported = false;
    }
    items = pending();
    returned = items.filter((item) => item.status !== "running");
    if (returned.length) {
      for (const item of returned) item.reported = true;
      return { entries: returned.map((item) => report(jobs.result(item))), continue: true };
    }
    if (ctx.hasPendingMessages() && items.length)
      return { entries: items.map((item) => report(jobs.result(item))), continue: true };
    return {};
  });
}
