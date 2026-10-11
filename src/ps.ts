import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Jobs, Work } from "./jobs";

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const duration = (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`);
const marks = { running: "↗", done: "✓", failed: "✗", stopped: "■" } as const;

/** Everything about one job or agent, for reading in a dialog. */
export function details(jobs: Jobs, item: Work) {
  const result = jobs.result(item);
  const lines = [`${item.status} · ${duration(result.elapsedSeconds)}`];
  if (item.kind === "agent") {
    if (item.progress) lines.push(`Now: ${item.progress}`);
    if (item.tokens) lines.push(`Tokens: ${item.tokens.toLocaleString()}`);
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
  return `${lines.join("\n")}\n\n${body}`;
}

/** A read-only, scrollable view of text: arrows and page keys scroll, Esc, Enter or q closes. */
class Viewer implements Component {
  private offset = 0;
  private height = 10;
  constructor(
    private title: string,
    private text: string,
    private theme: Theme,
    private rows: () => number,
    private redraw: () => void,
    private close: () => void,
  ) {}
  handleInput(data: string) {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || data === "q") return this.close();
    const step = matchesKey(data, Key.up)
      ? -1
      : matchesKey(data, Key.down)
        ? 1
        : matchesKey(data, Key.pageUp)
          ? -this.height
          : matchesKey(data, Key.pageDown) || data === " "
            ? this.height
            : matchesKey(data, Key.home)
              ? -Infinity
              : matchesKey(data, Key.end)
                ? Infinity
                : 0;
    if (!step) return;
    this.offset += step;
    this.redraw();
  }
  invalidate() {}
  render(width: number) {
    const lines = this.text.split("\n").flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width - 2)));
    this.height = Math.max(3, this.rows() - 6);
    this.offset = Math.max(0, Math.min(this.offset, lines.length - this.height));
    const shown = lines.slice(this.offset, this.offset + this.height);
    const range =
      lines.length > this.height ? ` ${this.offset + 1}–${this.offset + shown.length} of ${lines.length}` : "";
    return [
      truncateToWidth(`${this.theme.fg("accent", this.title)}${this.theme.fg("dim", range)}`, width),
      ...shown.map((line) => ` ${line}`),
      this.theme.fg("dim", truncateToWidth(lines.length > this.height ? "↑↓ scroll · esc close" : "esc close", width)),
    ];
  }
}

async function view(ctx: ExtensionContext, title: string, text: string) {
  if (ctx.mode !== "tui") return void (await ctx.ui.editor(title, text));
  await ctx.ui.custom<void>(
    (tui, theme, _keys, done) =>
      new Viewer(
        title,
        text,
        theme,
        () => tui.terminal.rows,
        () => tui.requestRender(),
        () => done(),
      ),
  );
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
        if (action === "Read") await view(ctx, `${item.id} · ${oneLine(item.title).slice(0, 60)}`, details(jobs, item));
        if (action === "Stop") {
          jobs.stop(item.id);
          ctx.ui.notify(`Stopping ${item.id}.`, "info");
        }
      }
    },
  });
}
