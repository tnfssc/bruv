import { captureNativeJobText } from "./job-artifacts";
import { getSessionHost } from "../session/host-access";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
const EVENT = "bruv:remote:cancel-native-work";
type Request = { ctx: ExtensionContext; resolve: (value: unknown) => void; reject: (error: unknown) => void };
/** Native task ownership stays with the existing job service, not a second PID walker. */
export function registerRemoteCancellationService(
  pi: ExtensionAPI,
  cancel: (ctx: ExtensionContext) => Promise<unknown>,
) {
  if (!process.env.BRUV_REMOTE_RUNTIME_STATE) return;
  pi.events.on(EVENT, (value: unknown) => {
    const req = value as Request;
    void cancel(req.ctx).then(req.resolve, req.reject);
  });
}
export function registerRemoteCancellationRuntime(pi: ExtensionAPI) {
  const runtime = process.env.BRUV_REMOTE_RUNTIME_STATE;
  if (!runtime) return;
  pi.registerCommand("bruv-remote-cancel", {
    description: "Private owner cancellation checkpoint",
    handler: async (_input, ctx) => {
      let report: unknown;
      let settled = false;
      try {
        report = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Error("Native cancellation service unavailable")), 10000);
          pi.events.emit(EVENT, {
            ctx,
            resolve: (value: unknown) => {
              clearTimeout(timer);
              resolve(value);
            },
            reject: (error: unknown) => {
              clearTimeout(timer);
              reject(error);
            },
          } satisfies Request);
        });
        ctx.abort();
        const host = getSessionHost(pi, ctx);
        if (!host) throw Error("Native cancellation inspection unavailable");
        for (let attempt = 0; attempt < 50; attempt++) {
          let cursor: number | string | undefined;
          let active = 0;
          for (let page = 0; page < 100; page++) {
            const state = (await host.list({ cursor, count: 100 })) as {
              jobs: Array<{ id?: string; status: string }>;
              nextCursor?: number | string;
            };
            await captureNativeJobText(host, runtime, state.jobs);
            active += state.jobs.filter(
              (j) => !["completed", "failed", "cancelled", "stopped", "killed"].includes(j.status),
            ).length;
            if (state.nextCursor === undefined) break;
            if (page === 99 || state.nextCursor === cursor) throw Error("Cancellation job inspection incomplete");
            cursor = state.nextCursor;
          }
          if (active === 0 && ctx.isIdle()) {
            settled = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        report = { error: String(error) };
      }
      const file = join(dirname(runtime), "cancel-report.json"),
        temp = file + "." + process.pid;
      writeFileSync(temp, JSON.stringify({ at: new Date().toISOString(), report, settled }), { mode: 0o600 });
      renameSync(temp, file);
    },
  });
}
