import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Restore the view without replacing the owning operation's failure. */
export function restoreLeaf(manager: ExtensionContext["sessionManager"], priorLeaf: string | null | undefined): void {
  if (priorLeaf === undefined) return;
  try {
    const mutable = manager as unknown as { resetLeaf?: () => void; branch?: (id: string) => void };
    if (priorLeaf === null) mutable.resetLeaf?.();
    else mutable.branch?.(priorLeaf);
  } catch {
    // The original operation remains failed closed.
  }
}
