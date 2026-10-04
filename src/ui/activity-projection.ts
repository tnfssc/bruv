import type { Component } from "@earendil-works/pi-tui";
import type { TaskRow } from "./task-rows";

// Canonical per-frame ownership facts from the SDK task-row projection, not native detail state.
const ownedTaskRows = new WeakMap<Component, TaskRow[]>();
export function setActivityTaskRows(component: Component, rows: TaskRow[]): void {
  ownedTaskRows.set(component, rows);
}
export function getActivityTaskRows(component: Component): TaskRow[] | undefined {
  return ownedTaskRows.get(component);
}
export function clearActivityTaskRows(component: Component): void {
  ownedTaskRows.delete(component);
}

// Presentation only. Native components remain direct siblings for task ownership,
// pending result updates, images, and Pi's global tool expansion.
const projections = new WeakMap<
  Component,
  { render: (width: number, native: () => string[], hasOwnedTasks: boolean) => string[]; active: () => boolean }
>();
export function setActivityProjection(
  component: Component,
  project: (width: number, native: () => string[], hasOwnedTasks: boolean) => string[],
  active: () => boolean,
): void {
  projections.set(component, { render: project, active });
}
export function hasActiveActivityProjection(component: Component): boolean {
  return projections.get(component)?.active() ?? false;
}
export function clearActivityProjection(component: Component): void {
  projections.delete(component);
}
export function projectActivity(
  component: Component,
  width: number,
  native: () => string[],
  hasOwnedTasks = false,
): string[] {
  const projection = projections.get(component);
  return projection?.active() ? projection.render(width, native, hasOwnedTasks) : native();
}
