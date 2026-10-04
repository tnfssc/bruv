import {
  AssistantMessageComponent,
  CustomMessageComponent,
  type ExtensionAPI,
  type ExtensionContext,
  getSelectListTheme,
  InteractiveMode,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  type ScrollView,
  Spacer,
  Text,
  type TuiMouseEvent,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { getDiskBackedBranchRevision, selectDiskBackedEntries } from "../history/session-manager";
import { actionLabel } from "./action-label";
import { clearActivityProjection, getActivityTaskRows, setActivityProjection } from "./activity-projection";
import { taskRowKey, taskRowsFromDetails, taskStatusSummaryFromDetails } from "./task-rows";

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
  for (const [index, entry] of entries.entries()) {
    if (entry.type === "custom_message" && !isJobNoticeType(entry.customType)) segment = `control-${entry.id ?? index}`;
    if (entry.type === "message" && entry.message?.role === "user") segment = entry.id ?? segment;
    if (entry.type === "message" && entry.message?.role === "assistant" && Array.isArray(entry.message.content)) {
      if (
        entry.message.content.some((part) => part?.type === "text" && typeof part.text === "string" && part.text.trim())
      )
        segment = `prose-${entry.id ?? index}`;
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

function membershipEntry(entry: { type: string; messageRole?: string; customType?: string }): boolean {
  return (
    (entry.type === "message" && (entry.messageRole === "user" || entry.messageRole === "assistant")) ||
    entry.type === "custom_message" ||
    (entry.type === "custom" && entry.customType === ACTIVITY_BOUNDARY)
  );
}

type Host = {
  renderer: { mode: string };
  outputPad?: number;
  chatContainer: Container;
  transcriptScrollView?: Pick<ScrollView, "scrollTop" | "scrollTo" | "updateLayout">;
  ui: { requestRender(): void };
  sessionManager: { getBranch(): JournalEntry[]; getSessionFile(): string | undefined };
};
type ActivityItem = ToolExecutionComponent | CustomMessageComponent;
type NoticeShape = { message: { customType: string; details?: unknown }; _expanded: boolean };
function isJobNoticeType(type: unknown): boolean {
  return type === "task-complete" || type === "task-attention";
}
function isJobNotice(child: Component): child is CustomMessageComponent {
  return (
    child instanceof CustomMessageComponent && isJobNoticeType((child as unknown as NoticeShape).message.customType)
  );
}
function isBoundary(child: Component): boolean {
  if (child instanceof Spacer) return false;
  if (child instanceof AssistantMessageComponent) {
    const message = (child as unknown as { lastMessage?: { content?: { type: string; text?: string }[] } }).lastMessage;
    return message?.content?.some((part) => part.type === "text" && !!part.text?.trim()) ?? false;
  }
  return !(child instanceof ToolExecutionComponent) && !isJobNotice(child);
}
type Group = { key: string; tools: ToolExecutionComponent[]; items: ActivityItem[]; expanded: boolean };
const controllers = new Set<ActivityController>();

export class ActivityController {
  private membership = new Map<string, string>();
  private membershipRevision?: WeakRef<object>;
  groups: Group[] = [];
  private groupsByItem = new Map<ActivityItem, Group>();
  private width = 80;
  private adapted = new Map<ActivityItem, ToolExecutionComponent["handleMouse"]>();
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
    const manager = this.host.sessionManager;
    // Cache only IDs derived from immutable disk history. Children, live IDs,
    // expansion and result/task overlays still rebuild below on every frame.
    const revision = getDiskBackedBranchRevision(manager, membershipEntry);
    if (!revision || this.membershipRevision?.deref() !== revision) {
      this.membership = activityMembership(
        selectDiskBackedEntries(manager, "branch", membershipEntry) ?? manager.getBranch(),
      );
      this.membershipRevision = revision ? new WeakRef(revision) : undefined;
    }
    const membership = this.membership;
    const previous = this.groupsByItem;
    const groups = new Map<string, Group>();
    const groupsByItem = new Map<ActivityItem, Group>();
    const children = new Set(this.host.chatContainer.children);
    let fallback = "legacy";
    let segment = 0;
    let lastIdentity: string | undefined;
    for (const [index, child] of this.host.chatContainer.children.entries()) {
      if (isBoundary(child)) {
        fallback = "boundary-" + index;
        segment++;
        lastIdentity = undefined;
        continue;
      }
      if (!(child instanceof ToolExecutionComponent) && !isJobNotice(child)) continue;
      const state = child instanceof ToolExecutionComponent ? toolState(child) : undefined;
      if (state && !state.toolCallId) continue;
      if (state && this.liveKey && !this.adapted.has(child)) this.liveIds.add(state.toolCallId);
      // Preserve timeline boundaries; late notices never become foreground calls.
      const identity = state
        ? this.liveKey && this.liveIds.has(state.toolCallId)
          ? this.liveKey
          : (membership.get(state.toolCallId) ?? fallback)
        : "notices";
      if (lastIdentity !== undefined && lastIdentity !== identity) segment++;
      lastIdentity = identity;
      const key = identity + ":" + segment;
      let group = groups.get(key);
      if (!group) {
        const old = previous.get(child);
        group = { key, tools: [], items: [], expanded: old?.expanded ?? state?.expanded ?? false };
        groups.set(key, group);
      }
      group.items.push(child);
      if (child instanceof ToolExecutionComponent) group.tools.push(child);
      groupsByItem.set(child, group);
      this.adapt(child);
      if (state?.result?.details?.handoff) {
        segment++;
        lastIdentity = undefined;
      }
    }
    this.groups = [...groups.values()];
    this.groupsByItem = groupsByItem;
    for (const item of this.adapted.keys()) if (!children.has(item)) this.restore(item);
  }
  private group(item: ActivityItem): Group | undefined {
    return this.groupsByItem.get(item);
  }
  count(group: Group): number {
    return new Set(group.tools.map((tool) => toolState(tool).toolCallId)).size;
  }
  label(group: Group): string {
    const failed = new Set(
      group.tools.filter((tool) => toolState(tool).result?.isError).map((tool) => toolState(tool).toolCallId),
    ).size;
    const missing = group.tools.some((tool) => !toolState(tool).result || toolState(tool).isPartial);
    const latest = group.tools.at(-1);
    const state = latest ? toolState(latest) : undefined;
    const preview =
      state && this.liveIds.has(state.toolCallId) ? actionLabel(state.args?.label, state.toolName) : undefined;
    const rows = new Map(
      group.items.flatMap((item) => {
        const details =
          item instanceof ToolExecutionComponent
            ? toolState(item).result?.details
            : (item as unknown as NoticeShape).message.details;
        return (getActivityTaskRows(item) ?? taskRowsFromDetails(details)).map(
          (row) => [taskRowKey(row), row] as const,
        );
      }),
    );
    let jobFailed = [...rows.values()].filter((row) => row.status === "failed").length;
    let cancelled = [...rows.values()].filter((row) => row.status === "cancelled").length;
    const running = [...rows.values()].filter((row) => row.status === "running").length;
    let unresolved = [...rows.values()].filter(
      (row) => row.status === "unknown" || row.status === "needs-input",
    ).length;
    let unknownSummary = false;
    for (const item of group.items) {
      if (!(item instanceof CustomMessageComponent)) continue;
      for (const row of taskStatusSummaryFromDetails((item as unknown as NoticeShape).message.details)) {
        if (row.status === "failed") jobFailed += row.count ?? 0;
        else if (row.status === "cancelled") cancelled += row.count ?? 0;
        else if (row.count) unresolved += row.count;
        else unknownSummary = true;
      }
    }
    const count = this.count(group);
    const notices = group.items.length - group.tools.length;
    const title = count
      ? count + (count === 1 ? " tool called" : " tools called")
      : notices + (notices === 1 ? " job notification" : " job notifications");
    return (
      title +
      (failed ? " · " + failed + " failed" : "") +
      (jobFailed ? " · " + jobFailed + (jobFailed === 1 ? " job failed" : " jobs failed") : "") +
      (cancelled ? " · " + cancelled + " cancelled" : "") +
      (running ? " · " + running + " running" : "") +
      (unresolved ? " · " + unresolved + " unresolved" : unknownSummary ? " · status unknown" : "") +
      (missing && !preview ? " · result incomplete" : "") +
      (preview ? " · " + preview : "")
    );
  }
  private padded(text: string, width: number): string[] {
    const padding = this.host.outputPad ?? 1;
    const available = Math.max(0, width - padding * 2);
    return available ? [" ".repeat(padding) + getSelectListTheme().description(truncateToWidth(text, available))] : [];
  }
  private header(group: Group, width: number): string[] {
    const lines = this.padded(this.label(group), width);
    if (!group.expanded && group.tools.some((tool) => toolState(tool).result?.details?.outputArtifactErrors))
      lines.push(...this.padded("⚠ couldn’t save full output", width));
    return lines;
  }
  private adapt(item: ActivityItem): void {
    if (this.adapted.has(item)) return;
    const mouse = item.handleMouse;
    this.adapted.set(item, mouse);
    let projectedTaskRow = false;
    setActivityProjection(
      item,
      (width, native, hasOwnedTasks) => {
        this.width = width;
        const group = this.group(item);
        if (!group || this.host.renderer.mode !== "fullscreen") return native();
        const state = item instanceof ToolExecutionComponent ? toolState(item) : undefined;
        projectedTaskRow = hasOwnedTasks && state?.expanded !== true;
        const details = state?.result?.details;
        // Collapsing a group hides every child body without changing native detail state.
        // Only the actual handoff control survives; never render its expanded source/output.
        let content = group.expanded ? native() : [];
        if (!group.expanded && typeof details?.handoff === "string")
          content = new Text(details.handoff, this.host.outputPad ?? 1, 0).render(width);
        if (item instanceof CustomMessageComponent && group.expanded && !content.length)
          content = this.padded("Job update — click for details", width);
        return group.items[0] === item ? [...this.header(group, width), ...content] : content;
      },
      () => this.host.renderer.mode === "fullscreen",
    );
    item.handleMouse = (event: TuiMouseEvent) => {
      const group = this.group(item);
      if (!group || this.host.renderer.mode !== "fullscreen") return mouse.call(item, event);
      const headerHeight = group.items[0] === item ? this.header(group, event.width).length : 0;
      if (headerHeight && event.y < headerHeight) {
        if (event.type === "click" && event.button === "left") {
          this.toggle(group);
          return {
            handled: true,
            target: { component: item, originX: 0, originY: 0, width: event.width, height: event.height },
          };
        }
        return undefined;
      }
      if (
        event.type === "click" &&
        event.button === "left" &&
        (item instanceof CustomMessageComponent || (projectedTaskRow && event.y === headerHeight))
      ) {
        this.toggleDetails(group, item);
        return {
          handled: true,
          target: {
            component: item,
            originX: 0,
            originY: headerHeight,
            width: event.width,
            height: event.height - headerHeight,
          },
        };
      }
      return mouse.call(item, { ...event, y: event.y - headerHeight, height: event.height - headerHeight });
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
    this.withAnchor(() => this.expand(group, !group.expanded), reveal ? group.items[0] : undefined);
  }
  toggleDetails(group: Group, item: ActivityItem): void {
    this.withAnchor(() => {
      group.expanded = true;
      const expanded =
        item instanceof ToolExecutionComponent ? toolState(item).expanded : (item as unknown as NoticeShape)._expanded;
      item.setExpanded(!expanded);
    }, group.items[0]);
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
    const vanishedGroup =
      anchor instanceof ToolExecutionComponent || anchor instanceof CustomMessageComponent
        ? this.group(anchor)
        : undefined;
    const fallbackTool = vanishedGroup?.items[0];
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
    // Group visibility does not change native item detail state.
  }
  private restore(tool: ActivityItem): void {
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
    this.groupsByItem.clear();
    this.membership.clear();
    this.membershipRevision = undefined;
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
    description: "Show activity rows or individual native details (Ctrl+O toggles all details)",
    handler: async (_args, ctx) => {
      const state = findController(ctx);
      if (!state) {
        ctx.ui.notify("Activity groups are available in the local alternate-screen UI.", "info");
        return;
      }
      state.sync();
      const options = state.groups.flatMap((group, index) => [
        { label: index + 1 + ". " + state.label(group), group, item: undefined as ActivityItem | undefined },
        ...group.items.map((item, itemIndex) => {
          const tool = item instanceof ToolExecutionComponent ? toolState(item) : undefined;
          const title = tool ? actionLabel(tool.args?.label, tool.toolName) : "Job notification";
          return { label: "  " + (index + 1) + "." + (itemIndex + 1) + ". Details — " + title, group, item };
        }),
      ]);
      const choices = options.map((option) => option.label);
      if (!choices.length) {
        ctx.ui.notify("No activity in this branch.", "info");
        return;
      }
      const selected = await ctx.ui.select("Activity — rows or individual details; Esc returns", choices);
      if (selected !== undefined) {
        const option = options[choices.indexOf(selected)];
        if (option?.item) state.toggleDetails(option.group, option.item);
        else if (option) state.toggle(option.group, true);
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
