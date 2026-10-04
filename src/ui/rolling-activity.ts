import {
  type ExtensionAPI,
  type ExtensionContext,
  InteractiveMode,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  type ScrollView,
  type TuiMouseEvent,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { actionLabel } from "./action-label";
import { clearActivityProjection, setActivityProjection } from "./activity-projection";
import { taskRowsFromDetails } from "./task-rows";

export const ACTIVITY_BOUNDARY = "bruv-activity-boundary";
type ToolState = {
  toolCallId: string;
  toolName: string;
  args?: { label?: string };
  expanded: boolean;
  isPartial: boolean;
  result?: { isError?: boolean; details?: Record<string, unknown> };
};
function toolState(tool: ToolExecutionComponent): ToolState {
  return tool as unknown as ToolState;
}
type JournalEntry = {
  type: string;
  id?: string;
  customType?: string;
  data?: unknown;
  message?: { role: string; content?: unknown };
};
// Only selected-branch journal identities participate. No labels or prose infer intent.
export function activityMembership(entries: readonly JournalEntry[]): Map<string, string> {
  const result = new Map<string, string>();
  let segment = "legacy";
  for (const entry of entries) {
    if (entry.type === "message" && entry.message?.role === "user") segment = entry.id ?? segment;
    if (entry.type === "message" && entry.message?.role === "assistant" && Array.isArray(entry.message.content)) {
      for (const part of entry.message.content) {
        if (part?.type === "toolCall" && typeof part.id === "string" && !part.parentToolCallId)
          result.set(part.id, segment);
      }
    }
    if (entry.type === "custom" && entry.customType === ACTIVITY_BOUNDARY) {
      const data = entry.data as { callIds?: unknown } | undefined;
      if (Array.isArray(data?.callIds))
        for (const id of data.callIds)
          if (typeof id === "string" && result.has(id)) result.set(id, `${entry.id ?? "boundary"}:${result.get(id)}`);
      segment = `after-${entry.id ?? segment}`;
    }
  }
  return result;
}

type Host = {
  renderer: { mode: string };
  chatContainer: Container;
  transcriptScrollView?: Pick<ScrollView, "scrollTop" | "scrollTo" | "updateLayout">;
  ui: { requestRender(): void };
  sessionManager: { getBranch(): JournalEntry[]; getSessionFile(): string | undefined };
};
type Group = { key: string; tools: ToolExecutionComponent[]; expanded: boolean };
const controllers = new Set<ActivityController>();

export class ActivityController {
  groups: Group[] = [];
  private groupsByTool = new Map<ToolExecutionComponent, Group>();
  private width = 80;
  private adapted = new Map<ToolExecutionComponent, ToolExecutionComponent["handleMouse"]>();
  private liveKey: string | undefined;
  private serial = 0;
  private liveIds = new Set<string>();
  private detachRender?: () => void;
  private detachLayout?: () => void;
  private pendingAnchor?: number;
  attach(): void {
    const ownRender = Object.getOwnPropertyDescriptor(this.host.chatContainer, "render");
    const original = ownRender?.value as Container["render"] | undefined;
    const state = this;
    function render(this: Container, width: number): string[] {
      state.sync();
      return (original ?? Container.prototype.render).call(this, width);
    }
    this.host.chatContainer.render = render;
    this.detachRender = () => {
      if (this.host.chatContainer.render === render) {
        if (ownRender) Object.defineProperty(this.host.chatContainer, "render", ownRender);
        else delete (this.host.chatContainer as { render?: Container["render"] }).render;
      }
    };
  }
  constructor(readonly host: Host) {}
  start(): void {
    this.liveKey = `live-${++this.serial}`;
    this.liveIds.clear();
  }
  settle(): void {
    this.liveKey = undefined;
    this.liveIds.clear();
  }
  sync(): void {
    const membership = activityMembership(this.host.sessionManager.getBranch());
    const previous = this.groupsByTool;
    const groups = new Map<string, Group>();
    const groupsByTool = new Map<ToolExecutionComponent, Group>();
    const children = new Set(this.host.chatContainer.children);
    let fallback = "legacy";
    for (const [index, child] of this.host.chatContainer.children.entries()) {
      if (child instanceof UserMessageComponent) fallback = `user-${index}`;
      if (!(child instanceof ToolExecutionComponent)) continue;
      const state = toolState(child);
      if (!state.toolCallId) continue;
      if (this.liveKey && !this.adapted.has(child)) this.liveIds.add(state.toolCallId);
      const key =
        this.liveKey && this.liveIds.has(state.toolCallId)
          ? this.liveKey
          : (membership.get(state.toolCallId) ?? fallback);
      let group = groups.get(key);
      if (!group) {
        const old = previous.get(child);
        group = { key, tools: [], expanded: old?.expanded ?? state.expanded };
        groups.set(key, group);
      }
      // A duplicate delivery keeps evidence but never increments the count.
      group.tools.push(child);
      groupsByTool.set(child, group);
      if (!this.adapted.has(child)) child.setExpanded(group.expanded);
      this.adapt(child);
    }
    this.groups = [...groups.values()];
    this.groupsByTool = groupsByTool;
    for (const tool of this.adapted.keys()) if (!children.has(tool)) this.restore(tool);
  }
  private group(tool: ToolExecutionComponent): Group | undefined {
    return this.groupsByTool.get(tool);
  }
  count(group: Group): number {
    return new Set(group.tools.map((tool) => toolState(tool).toolCallId)).size;
  }
  label(group: Group): string {
    const failed = new Set(
      group.tools.filter((tool) => toolState(tool).result?.isError).map((tool) => toolState(tool).toolCallId),
    ).size;
    const missing = group.tools.some((tool) => !toolState(tool).result || toolState(tool).isPartial);
    const latestTool = group.tools.at(-1);
    const latest = latestTool ? toolState(latestTool) : undefined;
    const preview = this.liveKey === group.key && latest ? actionLabel(latest.args?.label, latest.toolName) : undefined;
    return `${this.count(group)} ${this.count(group) === 1 ? "tool" : "tools"} called ${group.expanded ? "▾" : "▸"}${failed ? ` · ${failed} failed` : ""}${missing && !preview ? " · result incomplete" : ""}${preview ? ` · ${preview}` : ""}`;
  }
  private adapt(tool: ToolExecutionComponent): void {
    if (this.adapted.has(tool)) return;
    const mouse = tool.handleMouse;
    this.adapted.set(tool, mouse);
    setActivityProjection(tool, (width, native, hasOwnedTasks) => {
      this.width = width;
      const group = this.group(tool);
      if (!group || this.host.renderer.mode !== "fullscreen") return native();
      const first = group.tools[0] === tool;
      const state = toolState(tool);
      // Typed tasks, failures, handoff and storage warnings remain visible. Do
      // not inspect English output for importance or replace native evidence.
      const details = state.result?.details;
      const protectedDetail =
        hasOwnedTasks ||
        state.result?.isError ||
        details?.handoff ||
        details?.outputArtifactErrors ||
        taskRowsFromDetails(details).length > 0;
      const content = group.expanded || protectedDetail ? native() : [];
      return first ? [truncateToWidth(this.label(group), width), ...content] : content;
    });
    tool.handleMouse = (event: TuiMouseEvent) => {
      const group = this.group(tool);
      if (!group || this.host.renderer.mode !== "fullscreen") return mouse.call(tool, event);
      const first = group.tools[0] === tool;
      if (first && event.y === 0) {
        if (event.type === "click" && event.button === "left") {
          this.toggle(group);
          return {
            handled: true,
            target: { component: tool, originX: 0, originY: 0, width: event.width, height: event.height },
          };
        }
        return undefined;
      }
      return mouse.call(tool, first ? { ...event, y: event.y - 1, height: event.height - 1 } : event);
    };
  }
  private offset(tool: Component): number {
    let rows = 0;
    for (const child of this.host.chatContainer.children) {
      if (child === tool) break;
      rows += child.render(this.width).length;
    }
    return rows;
  }
  toggle(group: Group, reveal = false): void {
    this.withAnchor(() => this.expand(group, !group.expanded), reveal ? group.tools[0] : undefined);
  }
  withAnchor(change: () => void, reveal?: Component): void {
    const scroll = this.host.transcriptScrollView;
    const top = this.pendingAnchor ?? scroll?.scrollTop ?? 0;
    const header = reveal ? this.offset(reveal) : undefined;
    let anchor: Component | undefined;
    let anchorRow = 0;
    let position = 0;
    for (const child of this.host.chatContainer.children) {
      const height = child.render(this.width).length;
      if (position + height > top) {
        anchor = child;
        anchorRow = top - position;
        break;
      }
      position += height;
    }
    change();
    this.host.chatContainer.render(this.width);
    const anchorTop = anchor
      ? this.offset(anchor) + Math.min(anchorRow, Math.max(0, anchor.render(this.width).length - 1))
      : top;
    // Hold the header if visible; preserve the reading position if this group
    // lies above it. Picker actions deliberately reveal the chosen header.
    const vanishedGroup = anchor instanceof ToolExecutionComponent ? this.group(anchor) : undefined;
    const fallbackTool = vanishedGroup?.tools[0];
    const fallback = fallbackTool ? this.offset(fallbackTool) : top;
    this.deferAnchor(header ?? (anchor?.render(this.width).length ? anchorTop : fallback));
    this.host.ui.requestRender();
  }
  private deferAnchor(top: number): void {
    const scroll = this.host.transcriptScrollView;
    if (!scroll) return;
    this.pendingAnchor = top;
    if (this.detachLayout) return;
    const ownLayout = Object.getOwnPropertyDescriptor(scroll, "updateLayout");
    const original = scroll.updateLayout;
    const state = this;
    const updateLayout: ScrollView["updateLayout"] = function (this: ScrollView, ...args) {
      original.apply(this, args);
      const target = state.pendingAnchor;
      state.pendingAnchor = undefined;
      state.detachLayout?.();
      // scrollTo clamps to contentHeight. Apply only after Pi measured the new
      // content and viewport, before its layout translates/clips the child box.
      if (target !== undefined) this.scrollTo(target, { disableFollow: true });
    };
    scroll.updateLayout = updateLayout;
    this.detachLayout = () => {
      if (scroll.updateLayout === updateLayout) {
        if (ownLayout) Object.defineProperty(scroll, "updateLayout", ownLayout);
        else delete (scroll as { updateLayout?: ScrollView["updateLayout"] }).updateLayout;
      }
      this.detachLayout = undefined;
    };
  }
  expand(group: Group, expanded: boolean): void {
    group.expanded = expanded;
    for (const tool of group.tools) tool.setExpanded(expanded);
  }
  private restore(tool: ToolExecutionComponent): void {
    clearActivityProjection(tool);
    const mouse = this.adapted.get(tool);
    if (mouse) tool.handleMouse = mouse;
    this.adapted.delete(tool);
  }
  dispose(): void {
    this.detachRender?.();
    this.detachLayout?.();
    this.pendingAnchor = undefined;
    for (const tool of this.adapted.keys()) this.restore(tool);
    this.groups = [];
    this.groupsByTool.clear();
  }
}

// Pi 1.0.0 scoped adapter: only a local fullscreen InteractiveMode instance.
// No Container/global task-owner hook and no native reparenting.
export function installRollingActivity(): () => void {
  type Method = (this: Host, ...args: unknown[]) => unknown;
  const prototype = InteractiveMode.prototype as unknown as Record<string, Method>;
  const originals = new Map<string, Method>();
  const wrappers = new Map<string, Method>();
  const states = new WeakMap<object, ActivityController>();
  function controller(host: Host): ActivityController | undefined {
    if (host.renderer?.mode !== "fullscreen" || !host.chatContainer) return undefined;
    let state = states.get(host);
    // Reload reuses InteractiveMode after session_shutdown disposed its controller.
    if (!state || !controllers.has(state)) {
      state = new ActivityController(host);
      states.set(host, state);
      controllers.add(state);
      state.attach();
    }
    return state;
  }
  for (const name of ["handleEvent", "renderSessionItems", "setToolsExpanded"]) {
    const original = prototype[name];
    if (typeof original !== "function") throw new Error(`Pi 1.0.0 rolling activity seam changed: ${name}`);
    originals.set(name, original);
    const wrapper: Method = function (this: Host, ...args: unknown[]) {
      const event = args[0] as { type?: string; message?: { role?: string } } | undefined;
      const state = controller(this);
      if (name === "handleEvent" && event?.type === "agent_start") state?.start();
      if (name === "handleEvent" && event?.type === "agent_end") state?.settle();
      if (name === "renderSessionItems") state?.settle();
      if (name === "handleEvent" && event?.type === "message_start" && event?.message?.role === "user" && state)
        state.start();
      if (name === "setToolsExpanded" && state) {
        state.sync();
        let result: unknown;
        state.withAnchor(() => {
          result = original.apply(this, args);
          for (const group of state.groups) state.expand(group, args[0] === true);
        });
        return result;
      }
      return original.apply(this, args);
    };
    wrappers.set(name, wrapper);
    prototype[name] = wrapper;
  }
  return () => {
    for (const [name, original] of originals) if (prototype[name] === wrappers.get(name)) prototype[name] = original;
    for (const state of controllers) state.dispose();
    controllers.clear();
  };
}

export function registerRollingActivity(pi: ExtensionAPI): void {
  pi.on("agent_end", (event, ctx) => {
    if (ctx.mode !== "tui" || !findController(ctx)) return;
    const callIds = new Set<string>();
    for (const message of event.messages)
      if (message.role === "assistant")
        for (const part of message.content) if (part.type === "toolCall") callIds.add(part.id);
    if (callIds.size) pi.appendEntry(ACTIVITY_BOUNDARY, { callIds: [...callIds] });
  });
  pi.registerCommand("activity", {
    description: "Open or close a tool activity group (Ctrl+O toggles all tool details)",
    handler: async (_args, ctx) => {
      const state = findController(ctx);
      if (!state) {
        ctx.ui.notify("Activity groups are available in the local alternate-screen UI.", "info");
        return;
      }
      state.sync();
      const choices = state.groups.map((group, index) => `${index + 1}. ${state.label(group)}`);
      if (!choices.length) {
        ctx.ui.notify("No tool activity in this branch.", "info");
        return;
      }
      const selected = await ctx.ui.select("Activity — select to open/close; Esc returns", choices);
      if (selected !== undefined) {
        const group = state.groups[choices.indexOf(selected)];
        if (group) state.toggle(group, true);
      }
    },
  });
  pi.on("session_shutdown", (_event, ctx) => {
    const state = findController(ctx);
    if (state) {
      state.dispose();
      controllers.delete(state);
    }
  });
}
function findController(ctx: ExtensionContext): ActivityController | undefined {
  return [...controllers].find(
    (state) =>
      state.host.renderer.mode === "fullscreen" &&
      state.host.sessionManager.getSessionFile() === ctx.sessionManager.getSessionFile(),
  );
}
