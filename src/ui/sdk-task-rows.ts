import {
  clearActivityTaskRows,
  hasActiveActivityProjection,
  projectActivity,
  setActivityTaskRows,
} from "./activity-projection";
import { CustomMessageComponent, ToolExecutionComponent, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { executeOutputPreview } from "./execution-previews";
import {
  formatTaskRow,
  taskRowColor,
  taskRowKey,
  taskRowWithExecuteLabel,
  taskRowsFromDetails,
  taskSummaryRowsFromDetails,
  upsertTaskRow,
  type TaskRow,
} from "./task-rows";

type ToolShape = Component & {
  toolName: string;
  toolCallId: string;
  expanded: boolean;
  args?: { code?: unknown; label?: unknown };
  imageComponents?: Component[];
  imageSpacers?: Component[];
  result?: {
    details?: { handoff?: string; outputArtifactErrors?: unknown };
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
};
type CustomShape = Component & {
  _expanded: boolean;
  outputPad: number;
  message: { customType: string; details?: unknown };
};

/** Resolve canonical sibling ownership once per frame, before any child is rendered. */
function collectTaskFrame(children: readonly Component[], snapshot: () => TaskRow[]): Map<Component, TaskRow[]> {
  const rows = new Map<string, TaskRow>();
  const owners = new Map<string, Component>();
  const sources = new Map<string, ToolExecutionComponent>();
  for (const sibling of children) {
    if (sibling instanceof ToolExecutionComponent) {
      const item = sibling as unknown as ToolShape;
      if (item.toolName !== "execute") continue;
      sources.set(item.toolCallId, sibling);
      for (const row of taskRowsFromDetails(item.result?.details)) {
        // Details produced fresh, sanitized rows. Adopt the first occurrence
        // directly; only collisions need another merge. Never mutate raw details.
        row.sourceCallId = item.toolCallId;
        const key = taskRowKey(row);
        if (rows.has(key)) upsertTaskRow(rows, row);
        else rows.set(key, row);
        owners.set(key, sibling);
      }
    } else if (sibling instanceof CustomMessageComponent) {
      const item = sibling as unknown as CustomShape;
      if (!["task-complete", "task-attention"].includes(item.message.customType)) continue;
      for (const row of taskRowsFromDetails(item.message.details)) {
        const key = taskRowKey(row);
        if (rows.has(key)) upsertTaskRow(rows, row);
        else rows.set(key, row);
        if (!owners.has(key)) owners.set(key, sibling);
      }
    }
  }
  for (const row of snapshot()) {
    upsertTaskRow(rows, row);
    const source = row.sourceCallId ? sources.get(row.sourceCallId) : undefined;
    if (source) owners.set(taskRowKey(row), source);
  }
  const byChild = new Map<Component, TaskRow[]>();
  for (const [key, row] of rows) {
    const source = row.sourceCallId ? sources.get(row.sourceCallId) : undefined;
    // Every row in this frame's map is sanitized. An explicit title already
    // wins over the execute label, so it needs neither cleaning nor copying.
    const labeled =
      source && !row.title ? taskRowWithExecuteLabel(row, (source as unknown as ToolShape).args?.label) : row;
    // Replay may contain a callback before the launching execute recorded a
    // task row. Its real call provenance still identifies the canonical owner.
    const recordedOwner = owners.get(key);
    const owner =
      source && hasActiveActivityProjection(source) && recordedOwner instanceof CustomMessageComponent
        ? source
        : recordedOwner;
    if (owner) {
      const owned = byChild.get(owner) ?? [];
      owned.push(labeled);
      byChild.set(owner, owned);
    }
  }
  return byChild;
}

/** Render the collapsed task body while leaving native expansion, errors and images intact. */
function renderTaskBody(
  child: Component,
  owned: readonly TaskRow[],
  theme: Theme,
  width: number,
  native: () => string[],
): string[] {
  const tool = child instanceof ToolExecutionComponent ? (child as unknown as ToolShape) : undefined;
  const custom = child instanceof CustomMessageComponent ? (child as unknown as CustomShape) : undefined;
  if (tool?.expanded || custom?._expanded) return native();
  if (tool && tool.toolName !== "execute") return native();
  if (custom && !["task-complete", "task-attention"].includes(custom.message.customType)) return native();
  if (tool && !owned.length) return native();
  const padding = custom?.outputPad ?? 1;
  const available = Math.max(0, width - padding * 2);
  const lines = owned.map(
    (row, index) =>
      theme.fg(taskRowColor(row), formatTaskRow(row)) +
      (index === 0 && !tool?.result?.isError && tool?.result?.details?.outputArtifactErrors
        ? theme.fg("warning", " — ⚠ couldn’t save full output")
        : ""),
  );
  if (custom) {
    lines.push(...taskSummaryRowsFromDetails(custom.message.details).map((row) => theme.fg(row.color, row.text)));
    if (
      !lines.length &&
      taskRowsFromDetails(custom.message.details).length === 0 &&
      custom.message.customType !== "task-attention"
    )
      return native();
  }
  const result = available > 0 ? lines.map((line) => " ".repeat(padding) + truncateToWidth(line, available)) : [];
  if (tool?.result?.isError) result.push(...native());
  else if (tool?.result?.details?.handoff)
    result.push(
      ...executeOutputPreview(
        { ...tool.result, details: { ...tool.result.details, outputArtifactErrors: undefined } },
        false,
        tool.result.isError === true,
        theme,
        tool.args?.code,
        undefined,
        padding,
      ).render(width),
    );
  // Preserve the SDK's native image children, including image protocols.
  if (tool && !tool.result?.isError)
    for (let i = 0; i < (tool.imageComponents?.length ?? 0); i++) {
      result.push(...(tool.imageSpacers?.[i]?.render(width) ?? []));
      result.push(...(tool.imageComponents?.[i]?.render(width) ?? []));
    }
  return result;
}

/** The SDK retains typed messages on reopen. Project them, never parse visible text. */
export function installSdkTaskRows(theme: Theme, snapshot: () => TaskRow[] = () => []): () => void {
  const originalAdd = Container.prototype.addChild;
  const originalRender = Container.prototype.render;
  const restored = new WeakMap<Component, { original: Component["render"]; wrapper: Component["render"] }>();
  const references = new Set<WeakRef<Component>>();
  const renderRows = new WeakMap<Container, Map<Component, TaskRow[]>>();
  const finalized = new FinalizationRegistry<WeakRef<Component>>((reference) => references.delete(reference));
  let active = true;
  function adapt(parent: Container, child: Component): void {
    if (!(child instanceof ToolExecutionComponent) && !(child instanceof CustomMessageComponent)) return;
    if (restored.has(child)) return;
    // CustomMessageComponent inherits Container.render. Do not retain this install's
    // render hook as its original, or uninstall would leave a session closure behind.
    const original = child.render === render ? originalRender : child.render;
    const reference = new WeakRef(child);
    references.add(reference);
    finalized.register(child, reference);
    const wrapper = function (this: Component, width: number): string[] {
      // Ownership is known before rendering. Collapsed rolling groups must be
      // able to omit the body without formatting task rows or native previews.
      const hasOwnedTasks = (renderRows.get(parent)?.get(child)?.length ?? 0) > 0;
      return projectActivity(
        child,
        width,
        () => {
          const native = () => original.call(this, width);
          if (!active) return native();
          return renderTaskBody(child, renderRows.get(parent)?.get(child) ?? [], theme, width, native);
        },
        hasOwnedTasks,
      );
    };
    restored.set(child, { original, wrapper });
    child.render = wrapper;
  }
  function add(this: Container, child: Component): void {
    originalAdd.call(this, child);
    adapt(this, child);
  }
  function render(this: Container, width: number): string[] {
    // In-app /resume and /reload rebuild the transcript before session_start installs us.
    // Pi renders children directly (and records their heights for mouse dispatch), so
    // wrap existing children before delegating to its normal render implementation.
    if (!active) return originalRender.call(this, width);
    let hasTaskChildren = false;
    for (const child of this.children) {
      adapt(this, child);
      if (
        (child instanceof ToolExecutionComponent &&
          (child as unknown as ToolShape).toolName === "execute" &&
          (!(child as unknown as ToolShape).expanded || hasActiveActivityProjection(child))) ||
        (child instanceof CustomMessageComponent &&
          (!(child as unknown as CustomShape)._expanded || hasActiveActivityProjection(child)) &&
          ["task-complete", "task-attention"].includes((child as unknown as CustomShape).message.customType))
      )
        hasTaskChildren = true;
    }
    // Native tool bodies are containers too. They must not each merge the entire live task list.
    if (!hasTaskChildren) return originalRender.call(this, width);
    const byChild = collectTaskFrame(this.children, snapshot);
    for (const child of this.children)
      if (child instanceof ToolExecutionComponent || child instanceof CustomMessageComponent)
        setActivityTaskRows(child, byChild.get(child) ?? []);
    renderRows.set(this, byChild);
    try {
      return originalRender.call(this, width);
    } finally {
      renderRows.delete(this);
    }
  }
  Container.prototype.addChild = add;
  Container.prototype.render = render;
  return () => {
    active = false;
    if (Container.prototype.addChild === add) Container.prototype.addChild = originalAdd;
    if (Container.prototype.render === render) Container.prototype.render = originalRender;
    for (const reference of references) {
      const child = reference.deref();
      const record = child && restored.get(child);
      if (child) clearActivityTaskRows(child);
      if (child && record && child.render === record.wrapper) child.render = record.original;
    }
    references.clear();
  };
}
