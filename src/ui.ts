import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { Jobs, Result, Summary } from "./jobs";

const oneLine = (text: string) => text.replace(/[\r\n\t]+/g, " ");
const duration = (seconds: number) => (seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`);
const line = (item: Summary) => `${item.id} ${oneLine(item.title)} · ${item.status} · ${duration(item.elapsedSeconds)}`;

export function registerUI(pi: ExtensionAPI, jobs: Jobs) {
  let ctx: ExtensionContext | undefined;
  let renderers = false;
  let lastPromptAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const update = () => {
    if (!ctx?.hasUI) return;
    const visible = jobs
      .list()
      .filter((item) => item.status === "running" || (jobs.get(item.id).endedAt ?? 0) > lastPromptAt);
    ctx.ui.setWidget(
      "bruv",
      visible.length
        ? visible.map((item) => {
            if (item.status !== "running") return line(item);
            const progress = jobs.get(item.id).progress;
            return `${item.id} ${oneLine(item.title)} · ${duration(item.elapsedSeconds)}${progress ? ` · ${oneLine(progress)}` : ""}`;
          })
        : undefined,
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
    clearInterval(timer);
    ctx = context;
    lastPromptAt = 0;
    if (!ctx.hasUI) return;
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
    timer = setInterval(update, 1000);
    timer.unref();
    update();
  });
  pi.on("before_agent_start", () => {
    lastPromptAt = Date.now();
  });
  pi.on("session_shutdown", () => {
    clearInterval(timer);
    if (ctx?.hasUI) {
      ctx.ui.setWidget("bruv", undefined);
      ctx.ui.setStatus("bruv-agents", undefined);
    }
    ctx = undefined;
  });
}
