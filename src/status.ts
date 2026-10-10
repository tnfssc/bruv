import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const order = ["usage", "fast", "goal", "agents"] as const;
type Part = (typeof order)[number];
// Pi creates fresh event contexts but reuses the UI object.
const statuses = new WeakMap<ExtensionContext["ui"], Partial<Record<Part, string>>>();

export function setStatus(ctx: ExtensionContext, part: Part, text: string | undefined) {
  if (!ctx.hasUI) return;
  let parts = statuses.get(ctx.ui);
  if (!parts) {
    parts = {};
    statuses.set(ctx.ui, parts);
  }
  parts[part] = text;
  ctx.ui.setStatus(
    "bruv",
    order
      .map((key) => parts[key])
      .filter(Boolean)
      .join(" · ") || undefined,
  );
}

export function clearStatus(ctx: ExtensionContext) {
  statuses.delete(ctx.ui);
  if (ctx.hasUI) ctx.ui.setStatus("bruv", undefined);
}
