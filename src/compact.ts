import {
  AssistantMessageComponent,
  CustomMessageComponent,
  type ExtensionAPI,
  InteractiveMode,
  ToolExecutionComponent,
  UserMessageComponent,
  VERSION,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  Spacer,
  stripTerminalSequences,
  type TuiMouseEvent,
  VStack,
} from "@earendil-works/pi-tui";
import { readConfig, saveConfig } from "./config";
import { CompactEditor, inputRows } from "./editor";

// Pi has no hooks for transcript spacing yet, so bruv changes how a running Pi draws: never its
// files. Only these versions are known to match; any other version keeps Pi's own spacing.
export const SUPPORTED = ["1.1.0"];

type Part = { type: string; text?: string; thinking?: string };
type Message = { content?: Part[] };
// Fields Pi keeps on AssistantMessageComponent.
type Assistant = { lastMessage?: Message; hideThinkingBlock: boolean };
export type Mode = {
  chatContainer: Container;
  editorContainer: Container;
  fullscreenLayoutRoot?: unknown;
  ui: { requestRender(): void };
};
type Slot = { component: Component; minSize?: number };
type Method = (this: unknown, ...args: never[]) => unknown;

// A blank line next to these keeps its Markdown meaning: lists, quotes, code, tables, rules, headings.
const structured = (line: string) =>
  /^(?: {4}|\t)/.test(line) ||
  /^ {0,3}(?:>|[-+*]\s|\d+[.)]\s|`{3,}|~{3,}|(?:[-*_]\s*){3,}$|[=-]{2,}\s*$|\[[^\]]+\]:|<[/!?A-Za-z]|#)/.test(line) ||
  line.includes("|");

/** Drops blank lines between two lines of plain prose, outside code fences. */
export function compactProse(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let fence: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length).trim())
        fence = undefined;
    } else if (marker) fence = marker;
    else if (!line.trim()) {
      let end = i;
      while (end + 1 < lines.length && !lines[end + 1].trim()) end++;
      const before = out.at(-1);
      const after = lines[end + 1];
      if (before === undefined || after === undefined || structured(before) || structured(after))
        out.push(...lines.slice(i, end + 1));
      i = end;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** What the transcript shows of a reply: no thinking when hidden, else one tight thinking block per run. */
export function thinkingView<T extends Message>(message: T, hidden: boolean): T {
  const content = message.content;
  if (!Array.isArray(content) || !content.some((part) => part.type === "thinking")) return message;
  if (hidden) return { ...message, content: content.filter((part) => part.type !== "thinking") };
  const out: Part[] = [];
  for (const part of content) {
    const last = out.at(-1);
    if (part.type !== "thinking") out.push(part);
    else if (last?.type === "thinking")
      out[out.length - 1] = { ...last, thinking: `${last.thinking?.trim()}\n\n${part.thinking?.trim()}` };
    else out.push({ ...part });
  }
  return {
    ...message,
    content: out.map((part) =>
      part.type === "thinking" ? { ...part, thinking: compactProse(part.thinking?.trim() ?? "") } : part,
    ),
  };
}

type Kind = "user" | "message" | "blank" | "other";
function kind(component: Component): Kind {
  if (component instanceof UserMessageComponent) return "user";
  if (component instanceof Spacer) return "blank";
  if (
    component instanceof AssistantMessageComponent ||
    component instanceof ToolExecutionComponent ||
    component instanceof CustomMessageComponent ||
    // Pi does not export the component it draws extension entries (like bruv-turn) with.
    ("entry" in component && "renderer" in component && "customComponent" in component)
  )
    return "message";
  return "other";
}

/** Sets the shaded rows above and below a user message; false if Pi drew it some other way. */
function userPadding(user: UserMessageComponent, rows: number): boolean {
  const markdown = user.children[0] as unknown as { paddingY?: unknown; invalidate(): void } | undefined;
  if (user.children.length !== 1 || typeof markdown?.paddingY !== "number") return false;
  if (markdown.paddingY !== rows) {
    markdown.paddingY = rows;
    markdown.invalidate();
  }
  return true;
}

function startsWithProse(component: Component): boolean {
  for (const part of (component as unknown as Assistant).lastMessage?.content ?? []) {
    if (part.type === "text" && part.text?.trim()) return true;
    if (part.type === "thinking" && part.thinking?.trim()) return false;
  }
  return false;
}

/** Sends clicks to a child drawn `top` rows lower (or higher) than Pi expects. */
function moved(child: Component, top: number, height: number): Component {
  return {
    render: () => [],
    invalidate() {},
    handleMouse(event: TuiMouseEvent) {
      const y = event.y - top;
      if (y < 0 || y >= height) return undefined;
      const result = child.handleMouse?.({ ...event, y, height });
      if (!result || "target" in result || !(result.handled || result.capture || result.focus)) return result;
      const target = {
        component: child,
        originX: event.screenX - event.x,
        originY: event.screenY - y,
        width: event.width,
        height,
      };
      return { ...result, handled: true, ...(result.focus ? { focusTarget: child } : {}), target };
    },
  };
}

/**
 * The transcript without Pi's blank row above every item. A user message gets one plain row above
 * and below (shared with a user message next to it). An answer after a tool line keeps its gap.
 */
export function compactRender(this: Container, width: number): string[] {
  const lines: string[] = [];
  const layout: { component: Component; height: number }[] = [];
  let previous: Kind | undefined;
  let last: Component | undefined;
  for (const [index, child] of this.children.entries()) {
    let type = kind(child);
    if (type === "user" && !userPadding(child as UserMessageComponent, 0)) type = "other";
    const rows = child.render(width);
    let out = rows;
    let top = 0;
    if (type === "blank" && (previous === "user" || this.children[index + 1] instanceof UserMessageComponent)) out = [];
    else if (type === "user" && rows.length) {
      top = previous === "user" || previous === "blank" ? 0 : 1;
      out = [...(top ? [""] : []), ...rows, ""];
    } else if (
      type === "message" &&
      previous &&
      previous !== "other" &&
      rows.length > 1 &&
      !stripTerminalSequences(rows[0]).trim() &&
      !(
        (last instanceof ToolExecutionComponent || last instanceof CustomMessageComponent) &&
        child instanceof AssistantMessageComponent &&
        startsWithProse(child)
      )
    ) {
      out = rows.slice(1);
      top = -1;
    }
    layout.push({
      component: top || out.length !== rows.length ? moved(child, top, rows.length) : child,
      height: out.length,
    });
    lines.push(...out);
    if (out.length) {
      previous = type;
      last = child;
    }
  }
  (this as unknown as { mouseLayout: unknown }).mouseLayout = { width, children: layout };
  return lines;
}

/** Turns the compact layout on and off for one running Pi, and puts Pi back as it was. */
export class Compact {
  private mode?: Mode;
  private restores: (() => void)[] = [];
  private shown = new WeakMap<object, { source: Message; view: Message }>();
  active = false;

  /** Wraps Pi methods; each wrapper passes straight through while the layout is off. */
  install() {
    const state = this;
    const wrap = (proto: object, name: string, make: (original: Method) => Method) => {
      const target = proto as Record<string, Method>;
      const original = target[name];
      const wrapper = make(original);
      target[name] = wrapper;
      this.restores.push(() => {
        if (target[name] === wrapper) target[name] = original;
      });
    };
    // Pi draws a session through renderSessionItems at startup, reload and session changes: the
    // first chance to find its transcript.
    wrap(
      InteractiveMode.prototype,
      "renderSessionItems",
      (original) =>
        function (this: unknown, ...args) {
          state.attach(this as Mode);
          return original.apply(this, args);
        },
    );
    // Ctrl+O already shows its result; the "Tool output: expanded" line only takes a row.
    wrap(
      InteractiveMode.prototype,
      "showStatus",
      (original) =>
        function (this: unknown, ...args) {
          const [message] = args as unknown as [unknown];
          if (state.active && typeof message === "string" && message.startsWith("Tool output:")) return;
          return original.apply(this, args);
        },
    );
    wrap(
      AssistantMessageComponent.prototype,
      "updateContent",
      (original) =>
        function (this: unknown, ...args) {
          const [message, ...rest] = args as unknown as [Message, ...unknown[]];
          const seen = state.shown.get(this as object);
          // Pi redraws from lastMessage, which is the copy shown here; keep using the real message.
          const source = seen && message === seen.view ? seen.source : message;
          const view = state.active ? thinkingView(source, (this as unknown as Assistant).hideThinkingBlock) : source;
          state.shown.set(this as object, { source, view });
          return original.call(this, ...([view, ...rest] as never[]));
        },
    );
  }

  uninstall() {
    this.set(false, false);
    for (const restore of this.restores.splice(0).reverse()) restore();
  }

  /** Remembers the running Pi screen; Pi calls this through renderSessionItems. */
  attach(mode: Mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (this.active) this.apply(true, false);
  }

  /** Switches the layout; redraws when `redraw` is set. */
  set(on: boolean, redraw = true) {
    if (this.active === on) return;
    this.active = on;
    this.apply(on, redraw);
  }

  private apply(on: boolean, redraw: boolean) {
    const mode = this.mode;
    if (!mode || !(mode.chatContainer instanceof Container)) return;
    const chat = mode.chatContainer as Container & { render: Container["render"] };
    if (on) chat.render = compactRender;
    else if (chat.render === compactRender) delete (chat as Partial<typeof chat>).render;
    const slot = this.inputSlot(mode);
    // Pi keeps at least three rows for the input. The borderless input needs one.
    if (slot && on && slot.minSize === 3) {
      Object.defineProperty(slot, "minSize", {
        configurable: true,
        enumerable: true,
        get: () => (mode.editorContainer.children[0] instanceof CompactEditor ? 1 : 3),
      });
      inputRows.min = 1;
    } else if (slot && !on && Object.getOwnPropertyDescriptor(slot, "minSize")?.get) {
      Object.defineProperty(slot, "minSize", { configurable: true, enumerable: true, writable: true, value: 3 });
      inputRows.min = 3;
    }
    for (const child of chat.children) {
      if (child instanceof AssistantMessageComponent && (child as unknown as Assistant).lastMessage)
        child.updateContent((child as unknown as Assistant).lastMessage as never);
      if (!on && child instanceof UserMessageComponent) userPadding(child, 1);
    }
    if (redraw) mode.ui.requestRender();
  }

  private inputSlot(mode: Mode): Slot | undefined {
    const entries = (stack: unknown) =>
      stack instanceof VStack ? ((stack as unknown as { entries: Slot[] }).entries ?? []) : [];
    const dock = entries(mode.fullscreenLayoutRoot).find((entry) => entry.component instanceof VStack)?.component;
    return entries(dock).find((entry) => entry.component === mode.editorContainer);
  }
}

export function registerCompact(pi: ExtensionAPI, version = VERSION) {
  const supported = SUPPORTED.includes(version);
  const compact = new Compact();
  if (supported) {
    compact.install();
    compact.set(readConfig().compact !== false, false);
  }
  pi.on("session_start", (event, ctx) => {
    if (!supported && ctx.mode === "tui" && event.reason === "startup" && readConfig().compact !== false)
      ctx.ui.notify(
        `Compact spacing works with Pi ${SUPPORTED.join(", ")}. This is Pi ${version}, so Pi's own spacing is used.`,
        "info",
      );
  });
  pi.on("session_shutdown", () => compact.uninstall());
  pi.registerCommand("bruv-compact", {
    description: "Turn compact transcript spacing on or off",
    getArgumentCompletions: (prefix) =>
      ["on", "off"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const choice = args.trim();
      const on = choice === "on" ? true : choice === "off" ? false : readConfig().compact === false;
      saveConfig({ compact: on });
      if (!supported)
        return ctx.ui.notify(
          `Saved. Compact spacing works with Pi ${SUPPORTED.join(", ")}; this is Pi ${version}.`,
          "info",
        );
      compact.set(on);
      ctx.ui.notify(on ? "Compact spacing is on." : "Compact spacing is off. Pi's own spacing is back.", "info");
    },
  });
  return compact;
}
