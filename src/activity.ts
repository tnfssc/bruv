import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, SessionEntry, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { type Component, Text, type TuiMouseEvent, truncateToWidth } from "@earendil-works/pi-tui";
import type { Scripts } from "./render";

// A tool call, or a break (prose, a user message, a report) between runs of tool calls.
type Mark = { id: string; name: string; args: unknown } | undefined;
type RenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];

function marks(message: AgentMessage): Mark[] {
  if (message.role === "toolResult") return [];
  if (message.role === "custom" && !message.display) return [];
  if (message.role !== "assistant") return [undefined];
  return message.content.flatMap((part): Mark[] => {
    if (part.type === "text") return part.text.trim() ? [undefined] : [];
    if (part.type !== "toolCall") return [];
    // finish draws its own result, so it ends the run of calls before it.
    return [part.name === "finish" ? undefined : { id: part.id, name: part.name, args: part.arguments }];
  });
}

function entryMarks(entry: SessionEntry): Mark[] {
  if (entry.type === "message") return marks(entry.message);
  if (entry.type === "custom_message") return entry.display ? [undefined] : [];
  if (entry.type === "compaction" || entry.type === "branch_summary") return [undefined];
  return entry.type === "custom" && entry.customType === "bruv-turn" ? [undefined] : [];
}

/** Groups consecutive tool calls so the transcript shows one line per run of work. */
export class Activity {
  private settled: Mark[] = [];
  private streaming: Mark[] = [];
  private groups = new Map<string, string[]>();
  private calls = new Map<string, { name: string; args: unknown }>();
  private open = new Set<string>();
  private failed = new Set<string>();
  private redraw = new Map<string, () => void>();
  running = false;
  scripts?: Scripts;

  load(entries: SessionEntry[]) {
    this.redraw.clear();
    this.settled = entries.flatMap(entryMarks);
    this.streaming = [];
    this.failed = new Set(
      entries.flatMap((entry) =>
        entry.type === "message" && entry.message.role === "toolResult" && entry.message.isError
          ? [entry.message.toolCallId]
          : [],
      ),
    );
    this.index();
  }

  message(message: AgentMessage, done: boolean) {
    if (done) {
      this.settled.push(...marks(message));
      this.streaming = [];
    } else this.streaming = marks(message);
    this.index();
  }

  result(id: string, isError: boolean) {
    if (isError) this.failed.add(id);
  }

  private index() {
    this.groups.clear();
    this.calls.clear();
    let current: string[] | undefined;
    for (const mark of [...this.settled, ...this.streaming]) {
      if (!mark) {
        current = undefined;
        continue;
      }
      if (this.groups.has(mark.id)) continue;
      if (!current) current = [];
      current.push(mark.id);
      this.groups.set(mark.id, current);
      this.calls.set(mark.id, mark);
    }
  }

  group(id: string) {
    return this.groups.get(id) ?? [id];
  }

  isOpen(id: string) {
    return this.open.has(this.group(id)[0]);
  }

  toggle(id: string) {
    const head = this.group(id)[0];
    if (!this.open.delete(head)) this.open.add(head);
    for (const member of this.group(id)) this.redraw.get(member)?.();
  }

  watch(id: string, redraw: () => void) {
    this.redraw.set(id, redraw);
  }

  header(id: string, theme: Theme) {
    const ids = this.group(id);
    const count = ids.reduce((sum, member) => {
      const call = this.calls.get(member);
      return sum + (call?.name === "codemode" ? this.scripts?.count(member) || 1 : 1);
    }, 0);
    const failed = ids.filter((member) => this.failed.has(member)).length;
    const last = [...this.groups.values()].at(-1);
    const latest = this.calls.get(ids.at(-1) ?? "");
    const label =
      this.running && last === ids && latest
        ? latest.name === "codemode"
          ? this.scripts?.label(ids.at(-1) ?? "", (latest.args as { code?: unknown })?.code)
          : latest.name
        : undefined;
    return (
      theme.fg("dim", `${count} ${count === 1 ? "tool" : "tools"} called`) +
      (failed ? theme.fg("error", ` · ${failed} failed`) : "") +
      (label ? theme.fg("dim", ` · ${label}`) : "")
    );
  }
}

const indent = (lines: string[], pad: number) => lines.map((line) => " ".repeat(pad) + line);

export function registerActivity(pi: ExtensionAPI, activity: Activity) {
  pi.on("session_start", (_event, ctx) => activity.load(ctx.sessionManager.getBranch()));
  pi.on("session_tree", (_event, ctx) => activity.load(ctx.sessionManager.getBranch()));
  pi.on("message_update", (event) => activity.message(event.message, false));
  pi.on("message_end", (event) => activity.message(event.message, true));
  pi.on("tool_execution_end", (event) => {
    if (!event.parentToolCallId) activity.result(event.toolCallId, event.isError);
  });
  pi.on("agent_start", () => {
    activity.running = true;
  });
  pi.on("agent_settled", () => {
    activity.running = false;
  });
  pi.registerToolRenderer((name, next) => {
    const inner = next();
    if (name === "finish") return inner;
    const body = (component: Component | undefined, context: RenderContext): Component => ({
      invalidate: () => component?.invalidate(),
      render: (width) =>
        component && (context.expanded || activity.isOpen(context.toolCallId))
          ? indent(component.render(Math.max(1, width - context.outputPad * 2)), context.outputPad)
          : [],
    });
    return {
      renderShell: "self",
      renderCall(args, theme, context) {
        activity.watch(context.toolCallId, context.invalidate);
        const call = inner?.renderCall
          ? inner.renderCall(args, theme, { ...context, lastComponent: undefined })
          : new Text(theme.fg("toolTitle", name), 0, 0);
        const content = body(call, context);
        return {
          invalidate: () => content.invalidate(),
          render(width) {
            const head = activity.group(context.toolCallId)[0] === context.toolCallId;
            const line = truncateToWidth(activity.header(context.toolCallId, theme), width - context.outputPad * 2);
            return [...(head ? indent([line], context.outputPad) : []), ...content.render(width)];
          },
          handleMouse(event: TuiMouseEvent) {
            if (event.y !== 0 || activity.group(context.toolCallId)[0] !== context.toolCallId) return undefined;
            if (event.type !== "click" || event.button !== "left") return undefined;
            activity.toggle(context.toolCallId);
            return { handled: true };
          },
        };
      },
      renderResult(result, options, theme, context) {
        const output = inner?.renderResult
          ? inner.renderResult(result, options, theme, { ...context, lastComponent: undefined })
          : new Text(
              result.content
                .filter((block) => block.type === "text")
                .map((block) => theme.fg("toolOutput", block.text))
                .join("\n"),
              0,
              0,
            );
        return body(output, context);
      },
    };
  });
}
