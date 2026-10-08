import { taskRowsFromSessionEntries } from "../../ui/task-rows";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createServer, createConnection, type Server } from "node:net";
import { unlinkSync } from "node:fs";
import type { QuestionService } from "../../questions/service";
import type { RootCommand } from "./contract";

export type RootJobs = {
  questions: { service: QuestionService; sync(ctx: ExtensionContext): Promise<void> };
  jobs(
    ctx: ExtensionContext,
    method: "jobs.list" | "jobs.inspect" | "jobs.stop" | "jobs.stopWork",
    params: unknown,
  ): Promise<unknown>;
};
export type RootFacet =
  | Exclude<RootCommand, { kind: "prompt" } | { kind: "abort" } | { kind: "ui.respond" }>
  | { kind: "snapshot" };
const terminal = new Set(["completed", "failed", "cancelled", "stopped", "killed"]);
async function allJobs(ctx: ExtensionContext, services: RootJobs) {
  const jobs: Array<{ id: string; status: string }> = [];
  let cursor: number | string | undefined;
  for (let page = 0; page < 100; page++) {
    const state = (await services.jobs(ctx, "jobs.list", {
      count: 100,
      ...(cursor === undefined ? {} : { cursor }),
    })) as { jobs: Array<{ id: string; status: string }>; nextCursor?: number | string };
    if (!Array.isArray(state.jobs)) throw Error("Root job state unavailable");
    jobs.push(...state.jobs);
    if (state.nextCursor === undefined) return jobs;
    if (state.nextCursor === cursor) throw Error("Root job cursor repeated");
    cursor = state.nextCursor;
  }
  throw Error("Root job discovery incomplete");
}
/** Trusted presentation facets. Deliberately not registered as commands/tools/helpers. */
export async function dispatchRootFacet(ctx: ExtensionContext, services: RootJobs, input: RootFacet): Promise<unknown> {
  const questions = services.questions.service;
  await services.questions.sync(ctx);
  switch (input.kind) {
    case "questions.list":
      return questions.list(ctx);
    case "questions.answer": {
      const answer = await questions.answer(ctx, input);
      // The normal runtime owns local continuation and SSH question dispatch. Do not send a second turn.
      return questions.get(ctx, answer.id);
    }
    case "jobs.list": {
      const { kind, ...params } = input;
      return services.jobs(ctx, kind, params);
    }
    case "jobs.inspect": {
      const { kind, ...params } = input;
      return services.jobs(ctx, kind, params);
    }
    case "jobs.stop":
      return services.jobs(ctx, "jobs.stop", { id: input.id });
    case "snapshot":
      return {
        sessionFile: ctx.sessionManager.getSessionFile(),
        sessionId: ctx.sessionManager.getSessionId(),
        idle: ctx.isIdle(),
        pendingMessages: ctx.hasPendingMessages(),
        questions: questions.list(ctx),
        jobs: await allJobs(ctx, services),
        taskRows: taskRowsFromSessionEntries(ctx.sessionManager.getBranch()),
      };
    case "close": {
      const report = (await services.jobs(ctx, "jobs.stopWork", {})) as {
        discoveryComplete?: boolean;
        outcome?: string;
      };
      if (report.discoveryComplete !== true || report.outcome === "partial")
        return { settled: false, report, error: "Root cancellation discovery incomplete" };
      await ctx.abort();
      for (let n = 0; n < 100; n++) {
        const jobs = await allJobs(ctx, services);
        if (jobs.every((j) => terminal.has(j.status)) && ctx.isIdle() && !ctx.hasPendingMessages())
          return { settled: true, report, jobs };
        await Bun.sleep(100);
      }
      return { settled: false, report, error: "Root children or foreground did not confirm settlement" };
    }
    default:
      throw Error("Unsupported root facet");
  }
}

/** One private socket per real root session. The owner retains the RPC stream. */
export function registerRootRuntime(pi: ExtensionAPI, services: RootJobs): void {
  const socket = process.env.BRUV_ROOT_RUNTIME_SOCKET,
    token = process.env.BRUV_ROOT_RUNTIME_TOKEN;
  if (!socket && !token) return;
  if (!socket || !token) throw Error("Incomplete root runtime IPC configuration");
  if (process.env.BRUV_SUBAGENT_TYPE || Number(process.env.BRUV_SUBAGENT_DEPTH ?? 0) !== 0)
    throw Error("Root runtime cannot run as a child");
  let context: ExtensionContext | undefined, server: Server | undefined;
  let serial = Promise.resolve();
  pi.on("session_start", async (_event, ctx) => {
    context = ctx;
    if (server) return;
    // Owner chooses a unique path. Never delete somebody else's listening socket.
    server = createServer((connection) => {
      connection.setTimeout(30000, () => connection.destroy());
      let text = "",
        handled = false;
      connection.on("data", (chunk) => {
        if (handled) return;
        text += chunk.toString();
        if (Buffer.byteLength(text) > 1024 * 1024) {
          connection.destroy();
          return;
        }
        if (!text.includes("\n")) return;
        handled = true;
        serial = serial
          .then(async () => {
            try {
              const request = JSON.parse(text.trim());
              if (request.token !== token || !context) throw Error("Invalid root facet authority");
              const value = await dispatchRootFacet(context, services, request.command);
              connection.end(JSON.stringify({ ok: true, value }) + "\n");
            } catch (error) {
              connection.end(JSON.stringify({ ok: false, error: String(error) }) + "\n");
            }
          })
          .catch(() => {});
      });
      connection.on("error", () => {});
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(socket, resolve);
    });
    const { chmodSync } = await import("node:fs");
    chmodSync(socket, 0o600);
  });
  pi.on("session_shutdown", async () => {
    server?.close();
    try {
      unlinkSync(socket);
    } catch {}
  });
}

export class RootFacetAcknowledgedError extends Error {}
export function rootFacetRequest(
  socket: string,
  token: string,
  command: RootFacet,
  timeoutMs = 20000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const connection = createConnection(socket);
    let text = "";
    const timer = setTimeout(() => done(Error("Root facet acknowledgement unknown")), timeoutMs);
    function done(error?: Error, value?: unknown) {
      clearTimeout(timer);
      connection.destroy();
      if (error) reject(error);
      else resolve(value);
    }
    connection.on("connect", () => connection.write(JSON.stringify({ token, command }) + "\n"));
    connection.on("data", (chunk) => {
      text += chunk.toString();
      if (Buffer.byteLength(text) > 4 * 1024 * 1024) return done(Error("Oversized root facet response"));
      if (!text.includes("\n")) return;
      try {
        const r = JSON.parse(text.trim());
        if (r.ok !== true) done(new RootFacetAcknowledgedError(r.error ?? "Root facet failed"));
        else done(undefined, r.value);
      } catch (e) {
        done(Error(String(e)));
      }
    });
    connection.on("error", done);
    connection.on("end", () => {
      if (!text.includes("\n")) done(Error("Root facet acknowledgement unknown"));
    });
  });
}
