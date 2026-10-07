import { createHash } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { recordDiagnostic } from "../diagnostics";
import { MAIN_AGENT_MODES, type MainAgentMode, mainAgentGuidance, replaceMainAgentGuidance } from "../prompts";
import { updateCurrentInstructionFrame } from "./instruction-continuity";

export const INSTRUCTION_MODE_ENTRY = "bruv-instruction-mode";

function parsedMode(value: unknown): MainAgentMode | undefined {
  return typeof value === "string" && MAIN_AGENT_MODES.includes(value as MainAgentMode)
    ? (value as MainAgentMode)
    : undefined;
}

function sessionOwner(ctx: ExtensionContext): string {
  // The marker must survive a process restart so an unchanged resumed frame is
  // byte-identical (and therefore cache-affine). The digest keeps session IDs
  // opaque if a prompt is logged or inspected.
  return createHash("sha256")
    .update("bruv-main-agent-mode\0")
    .update(ctx.sessionManager?.getSessionId?.() ?? "")
    .digest("hex");
}

function activeEntries(ctx: ExtensionContext): any[] {
  const manager = ctx.sessionManager as { getBranch?: () => any[]; getEntries?: () => any[] } | undefined;
  return manager?.getBranch?.() ?? manager?.getEntries?.() ?? [];
}

function persistedMode(ctx: ExtensionContext): MainAgentMode {
  const entries = activeEntries(ctx);
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== INSTRUCTION_MODE_ENTRY) continue;
    const mode = parsedMode((entry.data as { mode?: unknown } | undefined)?.mode);
    if (mode) return mode;

    // The newest owned entry is an authority boundary. Falling through to an
    // older mode would silently revive superseded state.
    recordDiagnostic(ctx.sessionManager as object, {
      component: "settings",
      code: "settings_invalid",
      outcome: "fallback",
    });
    return "orchestrator";
  }
  return "orchestrator";
}

/** Session-scoped root behavior. Child identity remains process/session metadata. */
export function registerInstructionMode(pi: ExtensionAPI, isRoot: () => boolean) {
  let mode: MainAgentMode = "orchestrator";
  let ui: ExtensionContext["ui"] | undefined;
  const status = () => ui?.setStatus("bruv-mode", isRoot() ? "mode: " + mode : undefined);
  const describe = () => mode + " (instructions only; model and thinking unchanged)";

  pi.registerCommand("mode", {
    description: "Show or switch main-agent instruction mode (fast, normal, orchestrator)",
    getArgumentCompletions: (prefix) => {
      const value = prefix.trim().toLowerCase();
      if (MAIN_AGENT_MODES.includes(value as MainAgentMode)) return null;
      return MAIN_AGENT_MODES.filter((mode) => mode.startsWith(value)).map((mode) => ({ value: mode, label: mode }));
    },
    handler: async (args, ctx) => {
      ui = ctx.ui;
      if (!isRoot()) {
        ctx.ui.notify(
          "/mode is available only to the main agent; this child keeps its fixed role and delegation depth.",
          "warning",
        );
        return;
      }
      const requested = args.trim().toLowerCase();
      if (!requested) {
        ctx.ui.notify("Main-agent mode: " + describe() + ". Use /mode fast|normal|orchestrator.", "info");
        status();
        return;
      }
      const next = parsedMode(requested);
      if (!next) {
        ctx.ui.notify("Usage: /mode fast|normal|orchestrator", "error");
        return;
      }
      if (next !== mode) {
        // Persistence is the commit point. A failed append must not leave the
        // in-memory status or prepared instruction frame ahead of durable state.
        try {
          pi.appendEntry(INSTRUCTION_MODE_ENTRY, { mode: next });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          ctx.ui.notify("Could not persist main-agent mode: " + reason, "error");
          return;
        }
        mode = next;
        updateCurrentInstructionFrame(ctx.sessionManager as object, (prompt) =>
          replaceMainAgentGuidance(prompt, mode, sessionOwner(ctx)),
        );
      }
      status();
      ctx.ui.notify("Main-agent mode: " + describe() + ".", "info");
    },
  });

  return {
    get: () => mode,
    /** Create Bruv's owned region; explicit user prompts bypass this in the framing hook. */
    guidance(ctx: ExtensionContext): string {
      return mainAgentGuidance(mode, sessionOwner(ctx));
    },
    refresh(ctx: ExtensionContext) {
      mode = isRoot() ? persistedMode(ctx) : "orchestrator";
    },
    sessionStart(ctx: ExtensionContext) {
      ui = ctx.ui;
      mode = isRoot() ? persistedMode(ctx) : "orchestrator";
      status();
    },
    shutdown() {
      ui?.setStatus("bruv-mode", undefined);
      ui = undefined;
    },
  };
}
