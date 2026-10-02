import { taskRowFromLaunch, taskRowKey, type TaskRow } from "../ui/task-rows";
import { type ExtensionAPI, type ExtensionContext, SettingsManager } from "@earendil-works/pi-coding-agent";
import * as z from "zod/mini";
import { diagnosticRecorder, inspectDiagnostics } from "../diagnostics";
import { backgroundHandoff, executeGuidance } from "../prompts";
import { ExecuteParameters, executeDeclaration } from "./definition";
import {
  type ExecutePreviewState,
  executeInputPreview,
  executeOutputPreview,
  stopExecutePreviewAnimation,
} from "../ui/execution-previews";
import { executeIsolated, formatResult } from "./execution";
import { withJobCancellation } from "../job-delivery";
import { stopCurrentLive } from "../live/lifecycle-access";

const HandoffParameters = z.object({ message: z.string().check(z.minLength(1), z.maxLength(2000)) });

export function registerExecuteTool(
  pi: ExtensionAPI,
  jobHandler?: (ctx: ExtensionContext, method: string, params: unknown, signal: AbortSignal) => Promise<unknown>,
  executablePath?: string,
  outputPad?: (cwd: string) => number,
): { stopForeground: (ctx: ExtensionContext) => number } {
  // pi 0.85 exposes outputPad through its public SettingsManager but not in
  // ToolRenderContext. Remove this narrow compatibility seam when the context
  // carries the setting directly. Cache just as InteractiveMode does at startup.
  const outputPads = new Map<string, number>();
  const getOutputPad =
    outputPad ??
    ((cwd: string) => {
      let padding = outputPads.get(cwd);
      if (padding === undefined) {
        padding = SettingsManager.create(cwd).getOutputPad();
        outputPads.set(cwd, padding);
      }
      return padding;
    });
  const previewStates = new Set<ExecutePreviewState>();
  const stopAnimations = () => {
    for (const state of previewStates) stopExecutePreviewAnimation(state);
    previewStates.clear();
  };
  pi.on("agent_end", stopAnimations);
  let shutdown = new AbortController();
  pi.on("session_start", () => {
    if (shutdown.signal.aborted) shutdown = new AbortController();
  });
  const active = new Set<Promise<unknown>>();
  const foreground = new Map<AbortController, unknown>();
  pi.on("session_shutdown", async () => {
    stopAnimations();
    shutdown.abort("shutdown");
    foreground.clear();
    await Promise.allSettled([...active]);
  });

  pi.registerTool({
    ...executeDeclaration(),
    label: "Execute",
    promptSnippet: "Run JS/TS.",
    promptGuidelines: executeGuidance,
    renderShell: "self",
    renderCall: (args, theme, context) => {
      if (!context.state.resultVisible) previewStates.add(context.state);
      return executeInputPreview(
        (args as { code?: unknown } | undefined)?.code,
        context.expanded,
        theme,
        context.state,
        getOutputPad(context.cwd),
        (args as { label?: unknown } | undefined)?.label,
        context.invalidate,
      );
    },
    renderResult: (result, options, theme, context) => {
      if (!options.isPartial) previewStates.delete(context.state);
      return executeOutputPreview(
        result,
        options.expanded,
        context.isError,
        theme,
        (context.args as { code?: unknown } | undefined)?.code,
        context.state,
        getOutputPad(context.cwd),
        (context.args as { label?: unknown } | undefined)?.label,
        options.isPartial,
      );
    },
    async execute(toolCallId, input, signal, _onUpdate, ctx) {
      const params = z.parse(ExecuteParameters, input);
      const owner = ctx.sessionManager;
      const ownerSessionId = owner?.getSessionId?.();
      const ownerLeafId = owner?.getLeafId?.();
      const recordForAttachment = owner ? diagnosticRecorder(owner) : undefined;
      const backgroundIds: string[] = [];
      const taskRows = new Map<string, TaskRow>();
      const handoffWaits = new AbortController();
      const stopSignal = new AbortController();
      if (owner) foreground.set(stopSignal, owner);
      let handoffMessage: string | undefined;
      const execution = executeIsolated(
        params.code,
        ctx.cwd,
        signal
          ? AbortSignal.any([signal, shutdown.signal, stopSignal.signal])
          : AbortSignal.any([shutdown.signal, stopSignal.signal]),
        params.timeoutSeconds ? params.timeoutSeconds * 1_000 : undefined,
        {
          executablePath,
          executeInvocationId: toolCallId,
          sessionFile: owner?.getSessionFile?.(),
          outputByteLimit: params.outputByteLimit,
          jobHandler: async (method, params, signal) => {
            if (method === "handoff") {
              const request = z.parse(HandoffParameters, params);
              if (!request.message.trim()) throw new Error("Handoff message is empty");
              if (handoffMessage !== undefined) throw new Error("This execute call already requested a handoff");
              handoffMessage = request.message;
              handoffWaits.abort(); // release outstanding foreground waits, not managed jobs
              return { accepted: true };
            }
            if (method === "live.stop") {
              if (
                signal.aborted ||
                shutdown.signal.aborted ||
                owner?.getSessionId?.() !== ownerSessionId ||
                owner?.getLeafId?.() !== ownerLeafId
              )
                throw new Error("Live stop request belongs to an inactive session");
              if (params && (typeof params !== "object" || Array.isArray(params) || Object.keys(params).length))
                throw new Error("live.stop accepts no options; stop jobs explicitly with jobs.stop(exactId)");
              return stopCurrentLive(pi, ctx);
            }
            if (!jobHandler) throw new Error("Session job helpers are unavailable");
            const result = await jobHandler(ctx, method, params, withJobCancellation(signal, handoffWaits.signal));
            if (method === "shell" || method === "subagent") {
              for (const job of Array.isArray(result) ? result : [result]) {
                if (
                  job &&
                  typeof job === "object" &&
                  typeof job.id === "string" &&
                  (method === "subagent" || job.background === true)
                ) {
                  if (job.background === true) backgroundIds.push(job.id);
                  const row = taskRowFromLaunch(
                    job,
                    toolCallId,
                    method === "subagent" ? (params as { title?: unknown } | undefined)?.title : undefined,
                  );
                  if (row) {
                    taskRows.set(taskRowKey(row), row);
                    pi.events?.emit?.("die:task-row-launch", { row, sessionId: ownerSessionId });
                  }
                }
              }
            }
            return result;
          },
        },
      );
      active.add(execution);
      try {
        const result = await execution;
        const diagnostics = inspectDiagnostics(result).records;
        try {
          if (owner && owner.getSessionId?.() === ownerSessionId) {
            for (const diagnostic of diagnostics) recordForAttachment?.(diagnostic);
          }
        } catch {
          // Diagnostics are best effort when session ownership metadata is unavailable.
        }
        let text = formatResult(result);
        const handoff = backgroundHandoff(backgroundIds);
        if (handoff) text += "\n\n" + handoff;
        if (
          handoffMessage !== undefined &&
          result.exitCode === 0 &&
          !result.timedOut &&
          !result.cancelled &&
          !result.imageError
        ) {
          text =
            "Execution handed off.\n\n" +
            handoffMessage +
            (result.stdout || result.stderr || result.images.length ? "\n\n" + text : "");
        }
        if (result.images.length && ctx.model && !ctx.model.input.includes("image")) {
          text += "\n\nThis model can't take images. Images not sent.";
        }
        // Preserve Pi's rejected-tool contract for failures while retaining the
        // complete formatted failure (including output and background task handoff).
        // Launch rows were emitted at launch, so rejection cannot hide persisted work.
        const isError = result.exitCode !== 0 || result.timedOut || result.cancelled || Boolean(result.imageError);
        if (isError) throw new Error(text);
        const { images, ...details } = result;
        return {
          content: [{ type: "text" as const, text }, ...images],
          isError,
          ...(!isError && handoffMessage !== undefined ? { terminate: true } : {}),
          // Don't duplicate base64 payloads in persisted tool details.
          details: {
            ...details,
            ...(diagnostics.length ? { diagnostics } : {}),
            ...(handoffMessage !== undefined ? { handoff: handoffMessage } : {}),
            backgroundJobs: backgroundIds,
            taskRows: [...taskRows.values()],
            images: images.map((image) => ({
              mimeType: image.mimeType,
              bytes: Buffer.byteLength(image.data, "base64"),
            })),
          },
        };
      } finally {
        active.delete(execution);
        foreground.delete(stopSignal);
      }
    },
  });
  return {
    stopForeground: (ctx) => {
      let requested = 0;
      for (const [controller, owner] of foreground) {
        if (owner !== ctx.sessionManager || controller.signal.aborted) continue;
        controller.abort("stop-work");
        requested++;
      }
      return requested; // request issued, not proof the worker has exited
    },
  };
}
