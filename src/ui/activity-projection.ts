import type { Component } from "@earendil-works/pi-tui";

// Presentation only. Native components remain direct siblings for task ownership,
// pending result updates, images, and Pi's global tool expansion.
const projections = new WeakMap<
  Component,
  (width: number, native: () => string[], hasOwnedTasks: boolean) => string[]
>();
export function setActivityProjection(
  component: Component,
  project: (width: number, native: () => string[], hasOwnedTasks: boolean) => string[],
): void {
  projections.set(component, project);
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
  return projections.get(component)?.(width, native, hasOwnedTasks) ?? native();
}
