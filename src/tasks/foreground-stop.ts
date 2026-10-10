import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  getJobResponseDeliverySignal,
  JOB_RESPONSE_ACK_EVENT,
  supportsJobResponseAcknowledgement,
} from "../job-delivery";

export type ForegroundStopResult = { outcome: "pending" | "idle" | "error"; detail?: string };
/** Do not abort the execute bridge before its stop-work result reaches the caller.
 * ACK is delivery, not completion: only the host's idle state proves the turn ended.
 */
export function requestForegroundStop(
  ctx: Pick<ExtensionContext, "abort" | "isIdle" | "sessionManager">,
  signal: AbortSignal,
  observe: (result: ForegroundStopResult) => void,
  isCurrent?: () => boolean,
): ForegroundStopResult {
  if (ctx.isIdle()) return { outcome: "idle" };
  if (!supportsJobResponseAcknowledgement(signal))
    return {
      outcome: "error",
      detail: "Foreground stop needs execute to acknowledge its result",
    };
  const delivery = getJobResponseDeliverySignal(signal);
  if (!delivery)
    return {
      outcome: "error",
      detail: "Foreground stop needs execute to acknowledge its result",
    };
  const session = ctx.sessionManager.getSessionId();
  const leaf = ctx.sessionManager.getLeafId();
  const cleanup = () => {
    delivery.removeEventListener(JOB_RESPONSE_ACK_EVENT, stop);
    signal.removeEventListener("abort", cleanup);
  };
  const stop = () => {
    cleanup();
    if (
      isCurrent
        ? !isCurrent()
        : ctx.sessionManager.getSessionId() !== session || ctx.sessionManager.getLeafId() !== leaf
    ) {
      observe({ outcome: "error", detail: "Session or branch changed before stop" });
      return;
    }
    try {
      ctx.abort();
      observe({ outcome: ctx.isIdle() ? "idle" : "pending" });
    } catch {
      observe({ outcome: "error", detail: "Foreground stop failed" });
    }
  };
  if (signal.aborted) return { outcome: "error", detail: "Execute caller already cancelled" };
  delivery.addEventListener(JOB_RESPONSE_ACK_EVENT, stop, { once: true });
  signal.addEventListener("abort", cleanup, { once: true });
  return { outcome: "pending", detail: "Foreground stop follows result delivery" };
}
