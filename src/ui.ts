import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { visibleWork, WorkBoard } from "./board";
import type { Jobs, Result, Summary, Work } from "./jobs";
import { clearStatus, setStatus } from "./status";

const oneLine = (text: string) => text.replace(/[\r\n\t]+/g, " ");
const duration = (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`);
const line = (item: Summary) => `${item.id} ${oneLine(item.title)} · ${item.status} · ${duration(item.elapsedSeconds)}`;

export function registerUI(pi: ExtensionAPI, jobs: Jobs) {
  let ctx: ExtensionContext | undefined;
  let renderers = false;
  const hidden = new Set<Work>();
  let board: WorkBoard | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const update = () => {
    if (!ctx?.hasUI || ctx.mode !== "tui") return;
    clearTimeout(expiry);
    const visible = [...jobs.items.values()].filter((item) => !hidden.has(item));
    const deadlines = visible
      .filter((item) => item.status !== "running")
      .map((item) => (item.endedAt as number) + 30000 - Date.now())
      .filter((delay) => delay > 0);
    if (deadlines.length) {
      expiry = setTimeout(update, Math.min(...deadlines));
      expiry.unref();
    }
    if (!visibleWork(visible).length) {
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
    setStatus(
      ctx,
      "agents",
      [...jobs.items.values()].some((item) => item.kind === "agent") ? `agents $${cost.toFixed(2)}` : undefined,
    );
  };
  const waiting = new Map<string, string[]>();
  const working = (context: ExtensionContext) => {
    if (!context.hasUI || context.mode !== "tui") return;
    const ids = [...new Set([...waiting.values()].flat())];
    context.ui.setWorkingMessage(waiting.size ? `Waiting for ${ids.join(", ")}…` : undefined);
  };
  pi.on("tool_execution_start", (event, context) => {
    if (event.toolName !== "wait") return;
    waiting.set(
      event.toolCallId,
      event.args.ids ??
        jobs
          .list()
          .filter((item) => item.status === "running")
          .map((item) => item.id),
    );
    working(context);
  });
  pi.on("tool_execution_end", (event, context) => {
    if (!waiting.delete(event.toolCallId)) return;
    working(context);
  });
  jobs.listeners.add(update);
  pi.on("session_start", (_event, context) => {
    clearTimeout(expiry);
    board?.dispose();
    board = undefined;
    ctx = context;
    clearStatus(ctx);
    hidden.clear();
    waiting.clear();
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
    clearTimeout(expiry);
    waiting.clear();
    if (ctx) working(ctx);
    board?.dispose();
    board = undefined;
    if (ctx?.hasUI && ctx.mode === "tui") {
      ctx.ui.setWidget("bruv", undefined);
    }
    if (ctx) clearStatus(ctx);
    ctx = undefined;
  });
}
