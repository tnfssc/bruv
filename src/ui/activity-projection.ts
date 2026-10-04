import type { Component } from "@earendil-works/pi-tui";

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
