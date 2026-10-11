import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Jobs, Work } from "./jobs";

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const duration = (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`);
const marks = { running: "↗", done: "✓", failed: "✗", stopped: "■" } as const;

/** Everything about one job or agent, for reading in a dialog. */
export function details(jobs: Jobs, item: Work) {
  const result = jobs.result(item);
  const lines = [`${item.id} · ${oneLine(item.title)}`, `${item.status} · ${duration(result.elapsedSeconds)}`];
  if (item.kind === "agent") {
    if (item.progress) lines.push(`Now: ${item.progress}`);
    if (item.tokens) lines.push(`Tokens: ${item.tokens}`);
    if (item.usage?.cost) lines.push(`Cost: $${item.usage.cost.toFixed(2)}`);
  }
  if (item.exitCode !== undefined && item.kind === "job") lines.push(`Exit code: ${item.exitCode}`);
  if (item.changes)
    lines.push(`Changes: +${item.changes.added} −${item.changes.removed} in ${item.changes.files} files`);
  if (item.worktree) lines.push(`Worktree: ${item.worktree.path} (${item.worktree.branch})`);
  lines.push(`Output: ${item.outputPath}`);
  if (item.sessionPath) lines.push(`Session: ${item.sessionPath}`);
  const body =
    item.kind === "agent"
      ? item.answer
        ? `Answer:\n${item.answer}`
        : "No answer yet."
      : `Latest output:\n${result.output}`;
  // The dialog opens at the end, so the summary goes last where it is seen first.
  return `${body}\n\n${lines.join("\n")}`;
}

/** /ps: look at running and finished jobs and agents, read their output, stop them. */
export function registerPs(pi: ExtensionAPI, jobs: Jobs) {
  pi.registerCommand("ps", {
    description: "Look at jobs and agents: read their output or stop them",
    handler: async (_args, ctx) => {
      for (;;) {
        const items = [...jobs.items.values()].sort(
          (a, b) => Number(b.status === "running") - Number(a.status === "running") || b.startedAt - a.startedAt,
        );
        if (!items.length) {
          ctx.ui.notify("Nothing has run in this session yet.", "info");
          return;
        }
        const rows = items.map(
          (item) =>
            `${marks[item.status]} ${item.id} · ${oneLine(item.title).slice(0, 80)} · ${duration(jobs.summary(item).elapsedSeconds)}`,
        );
        const picked = await ctx.ui.select("Jobs and agents", rows);
        if (picked === undefined) return;
        const item = items[rows.indexOf(picked)];
        const actions = item.status === "running" ? ["Read", "Stop", "Back"] : ["Read", "Back"];
        const action = await ctx.ui.select(`${item.id} · ${oneLine(item.title).slice(0, 60)}`, actions);
        if (action === "Read") await ctx.ui.editor(`${item.id} (changes here are not saved)`, details(jobs, item));
        if (action === "Stop") {
          jobs.stop(item.id);
          ctx.ui.notify(`Stopping ${item.id}.`, "info");
        }
      }
    },
  });
}
