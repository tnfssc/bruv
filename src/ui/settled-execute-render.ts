import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

type ExecuteShape = Component & {
  toolName: string;
  result?: unknown;
  isPartial: boolean;
  imageComponents: Component[];
  updateDisplay(): void;
};

/**
 * Pi 1.0.0 still traverses the native tool shell even when our settled result
 * preview returns cached rows. Keep one width of the native shell on that tool,
 * below density/task-row adapters. Only completed execute tools without native
 * images are immutable here; partial results and protocol images stay native.
 * updateDisplay is Pi's common lifecycle owner for args/results, expansion,
 * image options/conversion and invalidate (including theme changes).
 */
export function installSettledExecuteRendering(): () => void {
  const prototype = ToolExecutionComponent.prototype as unknown as ExecuteShape;
  const nativeRender = prototype.render;
  const nativeUpdate = prototype.updateDisplay;
  if (typeof nativeUpdate !== "function") throw new Error("Pi 1.0.0 tool display lifecycle changed");
  let rows = new WeakMap<ExecuteShape, { width: number; lines: string[] }>();
  let active = true;
  function render(this: ExecuteShape, width: number): string[] {
    if (!active || this.toolName !== "execute" || !this.result || this.isPartial || this.imageComponents.length) {
      rows.delete(this);
      return nativeRender.call(this, width);
    }
    const cached = rows.get(this);
    if (cached?.width === width) return cached.lines;
    const lines = nativeRender.call(this, width);
    rows.set(this, { width, lines });
    return lines;
  }
  function updateDisplay(this: ExecuteShape): void {
    rows.delete(this);
    nativeUpdate.call(this);
  }
  prototype.render = render;
  prototype.updateDisplay = updateDisplay;
  return () => {
    active = false;
    rows = new WeakMap();
    if (prototype.render === render) prototype.render = nativeRender;
    if (prototype.updateDisplay === updateDisplay) prototype.updateDisplay = nativeUpdate;
  };
}
