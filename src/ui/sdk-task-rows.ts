import { CustomMessageComponent, ToolExecutionComponent, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { executeOutputPreview } from "./execution-previews";
import {
  formatTaskRow,
  taskRowColor,
  taskRowKey,
  taskRowsFromDetails,
  taskSummaryRowsFromDetails,
  upsertTaskRow,
  type TaskRow,
} from "./task-rows";

type ToolShape = Component & {
  toolName: string;
  toolCallId: string;
  expanded: boolean;
  args?: { code?: unknown };
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

/** The SDK retains typed messages on reopen. Project them, never parse visible text. */
export function installSdkTaskRows(theme: Theme, snapshot: () => TaskRow[] = () => []): () => void {
  const originalAdd = Container.prototype.addChild;
  const originalRender = Container.prototype.render;
  const restored = new WeakMap<Component, { original: Component["render"]; wrapper: Component["render"] }>();
  const references = new Set<WeakRef<Component>>();
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
      if (!active) return original.call(this, width);
      const tool = child instanceof ToolExecutionComponent ? (child as unknown as ToolShape) : undefined;
      const custom = child instanceof CustomMessageComponent ? (child as unknown as CustomShape) : undefined;
      if (tool?.expanded || custom?._expanded) return original.call(this, width);
      if (tool && tool.toolName !== "execute") return original.call(this, width);
      if (custom && !["task-complete", "task-attention"].includes(custom.message.customType))
        return original.call(this, width);
      const rows = new Map<string, TaskRow>();
      const owners = new Map<string, Component>();
      for (const sibling of parent.children) {
        if (sibling instanceof ToolExecutionComponent) {
          const item = sibling as unknown as ToolShape;
          if (item.toolName !== "execute") continue;
          for (const row of taskRowsFromDetails(item.result?.details)) {
            upsertTaskRow(rows, { ...row, sourceCallId: item.toolCallId });
            owners.set(taskRowKey(row), sibling);
          }
        } else if (sibling instanceof CustomMessageComponent) {
          const item = sibling as unknown as CustomShape;
          if (!["task-complete", "task-attention"].includes(item.message.customType)) continue;
          for (const row of taskRowsFromDetails(item.message.details)) {
            upsertTaskRow(rows, row);
            if (!owners.has(taskRowKey(row))) owners.set(taskRowKey(row), sibling);
          }
        }
      }
      // Live typed launches also cover an execute that later throws (no result details).
      for (const row of snapshot()) {
        upsertTaskRow(rows, row);
        const source = parent.children.find(
          (item) =>
            item instanceof ToolExecutionComponent && (item as unknown as ToolShape).toolCallId === row.sourceCallId,
        );
        if (source) owners.set(taskRowKey(row), source);
      }
      const owned = [...rows.values()].filter((row) => owners.get(taskRowKey(row)) === child);
      if (tool && !owned.length) return original.call(this, width);
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
          return original.call(this, width);
      }
      const result = available > 0 ? lines.map((line) => " ".repeat(padding) + truncateToWidth(line, available)) : [];
      if (tool?.result?.isError) result.push(...original.call(this, width));
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
    if (active) for (const child of this.children) adapt(this, child);
    return originalRender.call(this, width);
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
      if (child && record && child.render === record.wrapper) child.render = record.original;
    }
    references.clear();
  };
}
