import { renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SessionHost } from "../session/host";
import { getSessionHost } from "../session/host-access";
import { captureNativeJobText } from "./job-artifacts";

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

function requestNativeCancellation(pi: ExtensionAPI, ctx: ExtensionContext): Promise<unknown> {
  return new Promise((resolve, reject) => {
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
}

/** Capture terminal output across the whole job list before using it as settlement evidence. */
async function captureNativeJobsAndCountActive(host: SessionHost, runtime: string): Promise<number> {
  let cursor: number | string | undefined;
  let active = 0;
  for (let page = 0; page < 100; page++) {
    const state = (await host.list({ cursor, count: 100 })) as {
      jobs: Array<{ id?: string; status: string }>;
      nextCursor?: number | string;
    };
    await captureNativeJobText(host, runtime, state.jobs);
    active += state.jobs.filter(
      (job) => !["completed", "failed", "cancelled", "stopped", "killed"].includes(job.status),
    ).length;
    if (state.nextCursor === undefined) break;
    if (page === 99 || state.nextCursor === cursor) throw Error("Cancellation job inspection incomplete");
    cursor = state.nextCursor;
  }
  return active;
}

async function waitForCancellationSettlement(
  host: SessionHost,
  runtime: string,
  ctx: ExtensionContext,
): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const active = await captureNativeJobsAndCountActive(host, runtime);
    if (active === 0 && ctx.isIdle()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export function registerRemoteCancellationRuntime(pi: ExtensionAPI) {
  const runtime = process.env.BRUV_REMOTE_RUNTIME_STATE;
  if (!runtime) return;
  pi.registerCommand("bruv-remote-cancel", {
    description: "Private owner cancellation checkpoint",
    handler: async (_input, ctx) => {
      let checkpoint: { report: unknown; settled: boolean };
      try {
        const report = await requestNativeCancellation(pi, ctx);
        ctx.abort();
        const host = getSessionHost(pi, ctx);
        if (!host) throw Error("Native cancellation inspection unavailable");
        checkpoint = { report, settled: await waitForCancellationSettlement(host, runtime, ctx) };
      } catch (error) {
        checkpoint = { report: { error: String(error) }, settled: false };
      }
      const file = join(dirname(runtime), "cancel-report.json"),
        temp = `${file}.${process.pid}`;
      writeFileSync(temp, JSON.stringify({ at: new Date().toISOString(), ...checkpoint }), { mode: 0o600 });
      renameSync(temp, file);
    },
  });
}
