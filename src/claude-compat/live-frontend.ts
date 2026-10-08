import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import liveExtension, { type LiveDependencies } from "../live/extension";
import { stopCurrentLive, type LiveStopResult } from "../live/lifecycle-access";
import { loadLiveConfig, saveLiveConfig, type LiveConfig } from "../live/config";
import { LIVE_PROVIDERS } from "../live/providers";
import type { ClaudeCompatTransport } from "./transport";

export interface ClaudeCompatLiveOptions {
  /** Operator opt-in, not human consent. Must name this connector process's actual host. */
  localAudio?: { host: string };
  /** Bind only after the native client supports correlated AskUserQuestion answers. */
  humanChoices?: boolean;
  request?: ClaudeCompatTransport["request"];
  notify(message: string, level: "info" | "warning" | "error"): void;
  /** Optional presentation only; never an audio transport or a second session. */
  status?(key: string, value: string | undefined): void;
  /** Test/embedding seam. local is deliberately not overridable here. */
  dependencies?: Partial<Omit<LiveDependencies, "local">>;
}

/**
 * Install INSTEAD OF the ordinary Live factory on the canonical root session.
 * Do not expose its command handler as a model tool. The native human-command
 * dispatcher owns origin checks. hasUI and TTY are never changed.
 */
export function createClaudeCompatLiveFrontend(options: ClaudeCompatLiveOptions) {
  const deviceHost = hostname();
  const operatorEnabled = options.localAudio?.host === deviceHost;
  const request = options.request;
  const humanChoices = options.humanChoices === true && !!request;
  const storage = options.dependencies?.config ?? { load: loadLiveConfig, save: saveLiveConfig };
  let selected: LiveConfig | undefined;
  const config = {
    async load() {
      selected ??= await storage.load();
      return selected;
    },
    async save(value: LiveConfig) {
      await storage.save(value);
      selected = value;
    },
  };
  const supportedPlatform = process.platform === "linux" || process.platform === "darwin";
  let pi: ExtensionAPI | undefined;
  let handler: ((args: string, ctx: ExtensionContext) => Promise<void>) | undefined;
  let pending: AbortController | undefined;
  let closed = false;
  let bound: { manager: ExtensionContext["sessionManager"]; session: string; file: string | undefined } | undefined;
  const belongs = (ctx: ExtensionContext) =>
    !bound ||
    (bound.manager === ctx.sessionManager &&
      bound.session === ctx.sessionManager.getSessionId() &&
      bound.file === ctx.sessionManager.getSessionFile());

  function capabilities() {
    return {
      deviceHost,
      operatorEnabled,
      humanChoices,
      localHostAudio: !closed && operatorEnabled && humanChoices && supportedPlatform,
      browserAudio: false,
      pushToTalk: false,
      inputModes: ["continuous"],
      remoteDeviceAudio: false,
      models: Object.values(LIVE_PROVIDERS).flatMap((provider) => [...provider.models]),
      reason: closed
        ? "Live frontend closed"
        : !supportedPlatform
          ? "Native Live supports macOS and Linux only"
          : !operatorEnabled
            ? "Connector-host audio requires explicit operator opt-in naming " + deviceHost
            : !humanChoices
              ? "A correlated native human-choice callback is required before opening local devices"
              : "Each start/check still requires human consent for devices on " + deviceHost,
    };
  }
  function cancel() {
    pending?.abort(new Error("Live command cancelled"));
    pending = undefined;
  }
  function identity(ctx: ExtensionContext) {
    return JSON.stringify([
      ctx.sessionManager.getSessionId(),
      ctx.sessionManager.getSessionFile(),
      ctx.sessionManager.getLeafId(),
    ]);
  }
  function ui(ctx: ExtensionContext, controller: AbortController) {
    const manager = ctx.sessionManager;
    const branch = identity(ctx);
    const valid = () =>
      !controller.signal.aborted && !closed && manager === ctx.sessionManager && branch === identity(ctx);
    async function choose(question: string, labels: string[]): Promise<string | undefined> {
      if (!humanChoices || !request || !valid()) return undefined;
      const toolUseId = "bruv-live:" + randomUUID();
      const response = await request(
        {
          subtype: "can_use_tool",
          tool_name: "AskUserQuestion",
          tool_use_id: toolUseId,
          input: {
            questions: [
              {
                question,
                header: "Bruv Live",
                multiSelect: false,
                options: labels.map((label) => ({ label, description: label })),
              },
            ],
          },
        },
        { signal: controller.signal },
      );
      if (!valid() || response.behavior !== "allow") return undefined;
      if (response.toolUseID !== undefined && response.toolUseID !== toolUseId) return undefined;
      const answer = (response.updatedInput as { answers?: Record<string, unknown> } | undefined)?.answers?.[question];
      // An allow, free-text paraphrase, tool output or missing answer is not consent.
      return typeof answer === "string" && labels.includes(answer) ? answer : undefined;
    }
    const select = async (title: string, labels: string[]): Promise<string | undefined> => {
      if (!humanChoices) {
        options.notify(
          "Native Live choices are unavailable. Use Live capabilities for model IDs, an explicit Live model <id>, or secure provider setup in the ordinary CLI. Never paste keys into T3.",
          "warning",
        );
        return undefined;
      }
      // Native AskUserQuestion accepts 2–4 options. Keep actual extension choices,
      // paginate the five-model menu, and add a way out of single-choice setup.
      let offset = 0;
      while (valid()) {
        const paged = labels.length > 4;
        const page = paged ? labels.slice(offset, offset + 2) : [...labels];
        const next = "More choices";
        const cancelLabel = "Cancel";
        const choices = paged ? [...page, next, cancelLabel] : page.length < 2 ? [...page, cancelLabel] : page;
        const answer = await choose(title + (paged ? " (page " + (offset / 2 + 1) + ")" : ""), choices);
        if (!answer) return undefined;
        if (paged && answer === next) {
          offset = offset + 2 >= labels.length ? 0 : offset + 2;
          continue;
        }
        return labels.includes(answer) ? answer : undefined;
      }
      return undefined;
    };
    const unavailable = async (): Promise<never> => {
      throw new Error(
        "Native Live never accepts credentials or arbitrary terminal dialogs in chat; use secure local setup",
      );
    };
    return {
      ...ctx.ui,
      select,
      confirm: async (title: string, message: string) =>
        (await choose(title + " — devices on " + deviceHost + ". " + message, ["Yes", "No"])) === "Yes",
      input: unavailable,
      editor: unavailable,
      custom: unavailable,
      notify: options.notify,
      setStatus: (key: string, value: string | undefined) => options.status?.(key, value),
      // Claude protocol has no Live waveform/widget event. Do not fabricate one.
      setWidget: () => {},
    };
  }

  async function dispatch(args: string, ctx: ExtensionContext) {
    const action = args.trim() || "status";
    if (action === "stop") {
      const result = await stop(ctx);
      options.notify(
        result.stopped ? "Live off. Agent jobs unchanged." : "Live stop: " + result.errors.join("; "),
        result.stopped ? "info" : "warning",
      );
      return;
    }
    if (action === "capabilities") {
      options.notify(JSON.stringify(capabilities()), "info");
      return;
    }
    if (
      !/^(start|setup|status|provider(?: (?:google|openai))?|model(?: [^\s]+)?|input(?: (?:continuous|push-to-talk))?|mic-check|speaker-check)$/.test(
        action,
      )
    ) {
      options.notify(
        "Native Live supports connector-host devices only. Browser/remote microphone transport is not supplied by Claude protocol. Use live start|stop|status|capabilities|model|provider|input|setup|mic-check|speaker-check.",
        "warning",
      );
      return;
    }
    if (closed || !belongs(ctx) || ctx.mode !== "rpc" || Number(process.env.BRUV_SUBAGENT_DEPTH) > 0) {
      options.notify(
        "Native Live belongs to the canonical connector root session, not a worker or another frontend.",
        "warning",
      );
      return;
    }
    bound ??= {
      manager: ctx.sessionManager,
      session: ctx.sessionManager.getSessionId(),
      file: ctx.sessionManager.getSessionFile(),
    };
    if (pending) {
      options.notify("Live command is pending; use Live stop first.", "info");
      return;
    }
    const needsDevice = ["start", "setup", "mic-check", "speaker-check"].includes(action);
    if (needsDevice && !capabilities().localHostAudio) {
      options.notify(capabilities().reason, "warning");
      return;
    }
    const controller = new AbortController();
    pending = controller;
    const branch = identity(ctx);
    const nativeUI = ui(ctx, controller);
    try {
      if (needsDevice) {
        const paid = action === "start" || action === "setup";
        const selection = paid ? await config.load() : undefined;
        if (selection && (selection.inputMode ?? "push-to-talk") === "push-to-talk") {
          options.notify(
            "Push-to-talk needs the local terminal talk panel. Connector-host Live has no hold/release controls. Use the terminal, or explicitly choose Live input continuous.",
            "warning",
          );
          return;
        }
        const question =
          "Allow Bruv Live " +
          action +
          " on connector host " +
          deviceHost +
          "? " +
          "This uses that host's microphone/speaker, NOT this browser's devices. " +
          (selection
            ? "Microphone audio is sent to " +
              LIVE_PROVIDERS[selection.provider].label +
              " / " +
              selection.model +
              "; provider usage incurs charges. "
            : "This local device check does not connect to a voice provider. ") +
          "Live uses this same Bruv session. Stop voice leaves agent jobs unchanged.";
        if (
          (await nativeUI.select(question, ["Allow devices on " + deviceHost, "Cancel"])) !==
          "Allow devices on " + deviceHost
        )
          return;
      }
      if (controller.signal.aborted || pending !== controller || branch !== identity(ctx)) return;
      const nativeContext = { ...ctx, ui: nativeUI };
      await handler!(action, nativeContext);
      // No native Live footer exists: show the real result, including an off
      // state after cancelled setup or failed startup, rather than invent success.
      if (["start", "setup"].includes(action) && !controller.signal.aborted && pending === controller && belongs(ctx))
        await handler!("status", nativeContext);
    } catch {
      if (!controller.signal.aborted)
        options.notify(
          "Native Live command failed; details withheld. No credentials belong in the T3 transcript.",
          "warning",
        );
    } finally {
      if (pending === controller) pending = undefined;
    }
  }

  const factory: ExtensionFactory = (api) => {
    if (pi) throw new Error("Native Live factory is already installed; use one canonical session");
    pi = api;
    api.on("session_start", () => {
      cancel();
      bound = undefined;
    });
    api.on("session_shutdown", cancel);
    api.on("session_before_tree", cancel);
    api.on("session_before_fork", cancel);
    api.on("session_before_switch", cancel);
    liveExtension(
      {
        ...api,
        registerCommand(name, command) {
          // Live uses only ExtensionContext fields, including for Stop from lifecycle callbacks.
          handler = (args, ctx) => command.handler(args, ctx as ExtensionCommandContext);
          api.registerCommand(name, {
            ...command,
            description:
              "Connector-host Live (paid; opt-in): status, capabilities, stop, model, provider, start, setup, input, mic-check, speaker-check. Continuous mic only; choose input continuous explicitly. No browser/remote devices.",
            handler: dispatch,
          });
        },
      } as ExtensionAPI,
      {
        ...options.dependencies,
        config,
        local: (mode) =>
          mode === "rpc" &&
          operatorEnabled &&
          humanChoices &&
          supportedPlatform &&
          !!pending &&
          !pending.signal.aborted &&
          !closed,
      },
    );
  };

  async function stop(ctx: ExtensionContext): Promise<LiveStopResult> {
    if (!belongs(ctx))
      return { stopped: false, errors: ["Native Live belongs to another session owner"], jobsUnchanged: true };
    cancel();
    if (!pi || !handler) return { stopped: false, errors: ["Native Live is not installed"], jobsUnchanged: true };
    // Preserve observed teardown errors from the canonical Live port. Command
    // stop also cancels credential entry and bounded device probes, if any.
    const result = await stopCurrentLive(pi, ctx);
    const stopUI = ui(ctx, new AbortController());
    await handler("stop", {
      ...ctx,
      ui: {
        ...stopUI,
        notify(message, level) {
          // The command cancels entry/probes but its idle "off" notice is not
          // evidence that the canonical port observed successful teardown.
          if (message !== "Live off.") options.notify(message, level ?? "info");
        },
      },
    });
    return result;
  }
  return {
    factory,
    capabilities,
    stop,
    async close(ctx: ExtensionContext) {
      if (!belongs(ctx))
        return {
          stopped: false,
          errors: ["Native Live belongs to another session owner"],
          jobsUnchanged: true as const,
        };
      closed = true;
      return stop(ctx);
    },
  };
}
