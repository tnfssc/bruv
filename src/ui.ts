import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { Jobs, Result, Summary, Work } from "./jobs";

const oneLine = (text: string) => text.replace(/[\r\n\t]+/g, " ");
const duration = (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`);
const line = (item: Summary) => `${item.id} ${oneLine(item.title)} · ${item.status} · ${duration(item.elapsedSeconds)}`;

export class WorkBoard {
  private timer?: ReturnType<typeof setInterval>;
  private frame = 0;
  items: Work[] = [];
  constructor(
    private jobs: Jobs,
    private theme: Theme,
    private requestRender: () => void,
  ) {}
  update(items: Work[]) {
    this.items = items;
    if (items.some((item) => item.status === "running") && !this.timer) {
      this.timer = setInterval(() => {
        this.frame++;
        this.requestRender();
      }, 100);
      this.timer.unref();
    } else if (!items.some((item) => item.status === "running")) this.dispose();
    this.requestRender();
  }
  dispose() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
  invalidate() {}
  render(width: number) {
    return this.items.map((item) => {
      const running = item.status === "running";
      const mark = running
        ? "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[this.frame % 10]
        : { running: "", done: "✓", failed: "✗", stopped: "■" }[item.status];
      const color = running
        ? "accent"
        : item.status === "done"
          ? "success"
          : item.status === "failed"
            ? "error"
            : "dim";
      const parts = [this.theme.fg(color, mark), item.id, oneLine(item.title)];
      if (running && item.kind === "agent") {
        if (item.progress) parts.push(oneLine(item.progress));
        parts.push(`${item.tokens ?? (item.usage?.input ?? 0) + (item.usage?.output ?? 0)} tokens`);
      }
      if (!running && item.changes) {
        const { added, removed, files } = item.changes;
        parts.push(`+${added} −${removed}`, `${files} files`);
      }
      parts.push(this.theme.fg("dim", duration(this.jobs.summary(item).elapsedSeconds)));
      return truncateToWidth(parts.join(" · "), width);
    });
  }
}

export function registerUI(pi: ExtensionAPI, jobs: Jobs) {
  let ctx: ExtensionContext | undefined;
  let renderers = false;
  const hidden = new Set<Work>();
  let board: WorkBoard | undefined;
  const update = () => {
    if (!ctx?.hasUI || ctx.mode !== "tui") return;
    const visible = [...jobs.items.values()].filter((item) => !hidden.has(item));
    if (!visible.length) {
      board?.dispose();
      board = undefined;
      ctx.ui.setWidget("bruv", undefined);
    } else if (board) board.update(visible);
    else
      ctx.ui.setWidget(
        "bruv",
        (tui, theme) => {
          board = new WorkBoard(jobs, theme, () => tui.requestRender());
          board.update(visible);
          return board;
        },
        { placement: "aboveEditor" },
      );
    const cost = [...jobs.items.values()].reduce((sum, item) => sum + (item.usage?.cost ?? 0), 0);
    ctx.ui.setStatus(
      "bruv-agents",
      [...jobs.items.values()].some((item) => item.kind === "agent") ? `agents $${cost.toFixed(2)}` : undefined,
    );
  };
  jobs.listeners.add(update);
  pi.on("session_start", (_event, context) => {
    board?.dispose();
    board = undefined;
    ctx = context;
    hidden.clear();
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    if (!renderers) {
      renderers = true;
      for (const customType of ["bruv-report", "bruv-answer"]) {
        pi.registerMessageRenderer(customType, (message, options) => {
          const content =
            typeof message.content === "string"
              ? message.content
              : message.content
                  .filter((block) => block.type === "text")
                  .map((block) => block.text)
                  .join("\n");
          return new Text(options.expanded ? content : content.split("\n")[0], 0, 0);
        });
      }
      pi.registerToolRenderer((name, next) => {
        if (name !== "agent" && name !== "wait") return next();
        return {
          ...next(),
          renderResult(result, options) {
            const details = result.details as { ids?: string[]; done?: Result[]; running?: Summary[] } | undefined;
            const items = details?.ids?.map((id) => (jobs.items.has(id) ? jobs.result(jobs.get(id)) : { id })) ?? [
              ...(details?.done ?? []),
              ...(details?.running ?? []),
            ];
            if (!items.length)
              return new Text(
                result.content
                  .filter((block) => block.type === "text")
                  .map((block) => block.text)
                  .join("\n"),
                0,
                0,
              );
            const text = items
              .map((item) => {
                if (!("status" in item)) return item.id;
                if (!options.expanded) return line(item);
                const full = jobs.items.has(item.id) ? jobs.result(jobs.get(item.id)) : item;
                if (!("output" in full)) return line(item);
                return `${line(item)}\n${full.answer || full.output}\n${full.outputPath}${full.sessionPath ? `\n${full.sessionPath}` : ""}`;
              })
              .join("\n");
            return new Text(text, 0, 0);
          },
        };
      });
    }
    update();
  });
  pi.on("before_agent_start", () => {
    for (const item of jobs.items.values()) if (item.status !== "running") hidden.add(item);
    update();
  });
  pi.on("session_shutdown", () => {
    board?.dispose();
    board = undefined;
    if (ctx?.hasUI) {
      ctx.ui.setWidget("bruv", undefined);
      ctx.ui.setStatus("bruv-agents", undefined);
    }
    ctx = undefined;
  });
}
