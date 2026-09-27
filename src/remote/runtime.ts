import { registerRemoteCancellationRuntime } from "./cancellation";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { openSync, closeSync, writeFileSync, fsyncSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { getSessionHost } from "../session/host-access";
import { QuestionService } from "../questions/service";

/** Private owner-child checkpoint, using native jobs/questions rather than model text.
 * The owner supplies this path only to its child. No network listener or local capability grant. */
export function registerRemoteRuntime(pi: ExtensionAPI): void {
  const path = process.env.DIE_REMOTE_RUNTIME_STATE;
  if (!path) return;
  registerRemoteCancellationRuntime(pi);
  const save = (value: unknown) => {
    const tmp = path + "." + process.pid;
    const fd = openSync(tmp, "w", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(value));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
    const dir = openSync(dirname(path), "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  };
  pi.registerCommand("remote-native-answer", {
    description: "Internal persisted remote question reply",
    handler: async (encoded, ctx) => {
      const input = JSON.parse(Buffer.from(encoded.trim(), "base64url").toString("utf8")) as {
        id: string;
        owner: { sessionId: string; branchId: string };
        version: number;
        text: string;
        replyId: string;
      };
      const service = new QuestionService();
      const answer = await service.answer(ctx, input);
      if (answer.delivery === "delivered") return; // idempotent retry, no second turn
      if (answer.delivery === "dispatching") return; // uncertain: never replay
      const queued = await service.setDelivery(ctx, {
        id: answer.id,
        owner: answer.owner,
        version: answer.version,
        delivery: "queued",
      });
      const claimed = await service.setDelivery(ctx, {
        id: queued.id,
        owner: queued.owner,
        version: queued.version,
        delivery: "dispatching",
      });
      pi.sendMessage(
        {
          customType: "question-answer",
          display: false,
          content:
            "Saved answer for " +
            claimed.id +
            ":\n" +
            JSON.stringify(claimed) +
            "\nUse this saved reply in a new parent turn. Do not replay prior tool calls or resume a native child in place.",
          details: { questionId: claimed.id, replyKey: claimed.replyId, owner: claimed.owner },
        },
        { triggerTurn: true, deliverAs: "followUp" },
      );
      await service.setDelivery(ctx, {
        id: claimed.id,
        owner: claimed.owner,
        version: claimed.version,
        delivery: "delivered",
      });
    },
  });
  pi.on("agent_start", async () => save({ settled: false }));
  pi.on("agent_settled", async (_event, ctx) => {
    try {
      const host = getSessionHost(pi, ctx);
      if (!host) throw new Error("Remote child session host unavailable");
      let cursor: number | string | undefined;
      let activeJobs = 0;
      for (let page = 0; ; page++) {
        if (page >= 100) throw new Error("Remote job inspection page limit");
        const result = (await host.list({ cursor, count: 100 })) as {
          jobs: Array<{ status: string }>;
          nextCursor?: number | string;
        };
        if (!Array.isArray(result.jobs)) throw new Error("Remote job state unavailable");
        activeJobs += result.jobs.filter(
          (job) => !["completed", "failed", "cancelled", "stopped"].includes(job.status),
        ).length;
        if (result.nextCursor === undefined) break;
        if (result.nextCursor === cursor) throw new Error("Remote job cursor repeated");
        cursor = result.nextCursor;
      }
      const questions = new QuestionService()
        .list(ctx)
        .filter((q) => q.status === "pending" || (q.status === "answered" && q.delivery !== "delivered"));
      save({
        settled: true,
        activeJobs,
        pendingMessages: ctx.hasPendingMessages(),
        questions,
        sessionFile: ctx.sessionManager.getSessionFile(),
      });
    } catch (error) {
      save({ settled: true, error: String(error) });
    }
  });
}
