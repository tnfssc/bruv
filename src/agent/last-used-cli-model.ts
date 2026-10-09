import {
  type ExtensionAPI,
  type ExtensionContext,
  type ModelSelectEvent,
  SettingsManager,
  type ThinkingLevelSelectEvent,
} from "@earendil-works/pi-coding-agent";

export interface ModelDefaultSettings {
  setDefaultModelAndProvider(provider: string, modelId: string): void;
  setDefaultThinkingLevel(level: ThinkingLevelSelectEvent["level"]): void;
  flush(): Promise<void>;
  drainErrors(): Array<{ error: Error }>;
}

export type ModelDefaultSettingsFactory = (cwd: string) => ModelDefaultSettings;

function defaultSettingsFactory(cwd: string): ModelDefaultSettings {
  return SettingsManager.create(cwd);
}

/**
 * Save only a direct model choice from the root CLI TUI.
 *
 * Pi also emits model_select while restoring history. That describes session
 * state, not a request to change the startup default. Save keyboard cycle events
 * from the root TUI. Do not let worker or automation routing change the user's
 * default.
 */
export function isExplicitRootCliModelSelection(
  event: Pick<ModelSelectEvent, "source">,
  ctx: Pick<ExtensionContext, "mode">,
  isRootSession: boolean,
): boolean {
  return isRootSession && ctx.mode === "tui" && event.source !== "restore";
}

export function registerLastUsedCliModel(
  pi: ExtensionAPI,
  isRootSession: () => boolean,
  createSettings: ModelDefaultSettingsFactory = defaultSettingsFactory,
): void {
  pi.on("model_select", async (event, ctx) => {
    if (!isExplicitRootCliModelSelection(event, ctx, isRootSession())) return;

    const settings = createSettings(ctx.cwd);
    settings.setDefaultModelAndProvider(event.model.provider, event.model.id);
    await settings.flush();
    const errors = settings.drainErrors();
    if (errors.length > 0) {
      ctx.ui.notify(`Could not save default model: ${errors[0].error.message}`, "warning");
    }
  });

  // Pi emits this when setThinkingLevel changes the effective level, including
  // thinking picker/cycle actions and model selection/cycling. The event has no
  // source or persistence-consent flag, so root TUI model changes can also rewrite
  // the startup thinking default. Startup and history restoration initialize
  // session state directly, without emitting this event.
  pi.on("thinking_level_select", async (event, ctx) => {
    if (!isRootSession() || ctx.mode !== "tui") return;

    const settings = createSettings(ctx.cwd);
    settings.setDefaultThinkingLevel(event.level);
    await settings.flush();
    const errors = settings.drainErrors();
    if (errors.length > 0) {
      ctx.ui.notify(`Could not save default thinking level: ${errors[0].error.message}`, "warning");
    }
  });
}
