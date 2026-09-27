import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerRemoteRuntime } from "./runtime";
import { RemoteClient } from "./client";
import { createRemoteOperations, summarizeRemoteTask } from "./operations";
import { launchRepository, retryRepository, repositoryPreparations } from "./repository-wire";
import { grantCapabilities, revokeCapability } from "./services";
import type { CapabilityKind } from "./capabilities";
import { QuestionPicker } from "../questions/picker";
import {
  inboxItems,
  questionOptions,
  taskActions,
  remoteCompletions,
  pendingQuestions,
  remoteLabel,
  taskOwned,
} from "./menu";

/** Keep untrusted remote text printable even for terminals accepting C1/bidi controls. */
export const renderRemote = (value: unknown) =>
  (JSON.stringify(value, null, 2) ?? "null").replace(
    /[-‪-‮⁦-⁩]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );

export function parseRemoteLaunch(input: string): { repoPath: string; prompt: string } {
  const start = /^\s*launch\s+/.exec(input);
  if (!start) throw new Error("Usage: /remote launch <absolute-remote-repo-path> <prompt>");
  let i = start[0].length,
    repoPath = "",
    quote = "";
  for (; i < input.length; i++) {
    const c = input[i]!;
    if (c === "\\" && quote !== "'") {
      if (++i >= input.length) throw new Error("Incomplete path escape");
      repoPath += input[i];
    } else if (quote) {
      if (c === quote) quote = "";
      else repoPath += c;
    } else if (c === "'" || c === '"') quote = c;
    else if (/\s/.test(c)) break;
    else repoPath += c;
  }
  if (quote) throw new Error("Unclosed repository path quote");
  const prompt = input.slice(i + 1);
  if (!repoPath || !prompt.trim()) throw new Error("Usage: /remote launch <absolute-remote-repo-path> <prompt>");
  return { repoPath, prompt };
}

/** Only human commands connect, answer questions, approve untracked files, or grant local authority. */
export default function remoteExtension(pi: ExtensionAPI, client = new RemoteClient()): void {
  registerRemoteRuntime(pi);
  if (process.env.DIE_REMOTE_RUNTIME_STATE) return;
  const operations = createRemoteOperations(client),
    summary = summarizeRemoteTask;
  const publish = (result: unknown) =>
    pi.sendMessage({ customType: "die-remote", content: renderRemote(result), display: true });
  let inFlight = false,
    closed = false,
    picking = false;
  const seen = new Map<string, string>();
  const refresh = async () => {
    if (inFlight || closed || picking) return;
    inFlight = true;
    try {
      await client.syncActive();
      const tasks = Object.values((await client.status()).tasks).slice(-20);
      if (picking) return;
      for (const task of tasks) {
        const notice = {
          taskId: task.taskId,
          state: task.task?.state,
          outcome: task.outcome,
          eventCount: task.cursor,
          questions: task.task?.questions,
          replyDelivery: task.replyDelivery,
          capabilityNeeds: task.task?.capabilityNeeds,
          capabilities: task.task?.capabilities,
          repository: task.repository,
          artifacts: task.localArtifacts,
          transcriptComplete: task.transcriptComplete,
          artifactsComplete: task.artifactsComplete,
          transcriptWarning: task.task?.textOutputGap,
          error: task.lastError ?? task.integrationError ?? task.task?.error,
          cancelRequested: task.cancelRequested,
          cached: true,
        };
        const fingerprint = JSON.stringify(notice);
        if (seen.get(task.taskId) === fingerprint) continue;
        seen.set(task.taskId, fingerprint);
        if (task.task?.state === "done") {
          const final = task.events
            .slice()
            .reverse()
            .find((row) => {
              const e = row.event as { type?: string; message?: { role?: string } };
              return e?.type === "message_end" && e.message?.role === "assistant";
            });
          publish({ ...notice, lastAssistant: final?.event });
        } else publish(notice);
      }
    } catch (error) {
      /* Cached transcript is still usable. Task-specific network failures persist on each task. */
    } finally {
      inFlight = false;
    }
  };
  const timer = setInterval(() => {
    void refresh();
  }, 5000);
  timer.unref();
  pi.on("session_start", async () => {
    void refresh();
  });
  pi.on("session_shutdown", async () => {
    closed = true;
    clearInterval(timer);
  });
  const choose = async (id?: string) => {
    if (id) return id;
    const tasks = Object.values((await client.status()).tasks);
    const active = tasks.filter((t) => ["accepted", "running"].includes(t.task?.state ?? ""));
    if (active.length === 1) return active[0]!.taskId;
    if (!active.length && tasks.length === 1) return tasks[0]!.taskId;
    const preparations = await repositoryPreparations(client);
    if (!tasks.length && preparations.length === 1) return preparations[0]!.taskId;
    throw Error("Choose a task from /remote status; more than one task is available");
  };
  const pick = (ctx: any, title: string, items: { value: string; label: string; description?: string }[]) =>
    ctx.ui.custom(
      (tui: any, theme: any, keys: any, done: (value?: string) => void) =>
        new QuestionPicker(
          title,
          items,
          theme,
          keys,
          done,
          () => tui.requestRender(),
          () => tui.terminal.rows,
        ),
    ) as Promise<string | undefined>;
  const inbox = async (ctx: any) => {
    if (!ctx.hasUI) {
      publish(await operations({ op: "status" }));
      return;
    }
    picking = true;
    try {
      while (true) {
        const state = await client.status();
        const choice = await pick(ctx, "Remote · inbox", inboxItems(state));
        if (!choice) return;
        if (choice.startsWith("offline")) continue;
        if (choice === "refresh") {
          // Explicit refresh, unlike the timer, may contact the owner while the menu is open.
          await client.syncActive();
          continue;
        }
        if (choice === "connect") {
          const host = (await ctx.ui.editor("SSH host (configured name)"))?.trim();
          if (!host) continue;
          const path = await ctx.ui.editor("Remote die path (blank for default)");
          if (path === undefined) continue;
          publish(await client.connect(host, path.trim() || undefined));
          continue;
        }
        if (choice === "launch") {
          const prompt = (await ctx.ui.editor("Remote task prompt"))?.trim();
          if (prompt) publish(summary(await launchRepository(client, { localRoot: ctx.cwd ?? process.cwd(), prompt })));
          continue;
        }
        if (choice.startsWith("question:")) {
          const [, taskId, questionId] = choice.split(":");
          // Sync before selecting an answer. Never recompose an existing uncertain reply from a new choice.
          const fresh = await client.sync(taskId!);
          const q = pendingQuestions({ tasks: { [taskId!]: fresh } }).find((item) => item.q.id === questionId)?.q;
          if (!q) {
            ctx.ui.notify("Question no longer pending; no answer sent", "warning");
            continue;
          }
          while (true) {
            const options = questionOptions(q);
            const answerChoice = await pick(ctx, remoteLabel(q.text ?? q.question ?? "Remote question"), options);
            if (!answerChoice) break;
            const answer =
              answerChoice === "write"
                ? await ctx.ui.editor(remoteLabel(q.text ?? q.question ?? "Answer"))
                : q.choices?.[Number(answerChoice)];
            if (!answer?.trim()) continue;
            // Validate latest ledger identity/version, not an old inbox snapshot. Client persists reply before transport.
            const latest = await client.sync(taskId!);
            const current = pendingQuestions({ tasks: { [taskId!]: latest } }).find((item) => item.q.id === q.id)?.q;
            if (
              !current ||
              current.version !== q.version ||
              current.owner?.sessionId !== q.owner?.sessionId ||
              current.owner?.branchId !== q.owner?.branchId ||
              latest.replies?.[q.id]
            )
              throw Error("Question changed or has a saved reply; no new answer sent");
            publish(
              summary(await client.answer(taskId!, { id: q.id, owner: q.owner!, version: q.version!, text: answer })),
            );
            break;
          }
          continue;
        }
        if (choice.startsWith("task:")) {
          const id = choice.slice(5);
          while (true) {
            const task = (await client.status()).tasks[id];
            if (!task) break;
            const action = await pick(
              ctx,
              "Task · " + remoteLabel(task.prompt),
              taskActions(task, taskOwned(task, await client.status())),
            );
            if (!action) break;
            if (action === "transcript") {
              publish(await operations({ op: "transcript", taskId: id, offset: 0 }));
              return; // Let the human read the conversation instead of covering it with another picker.
            }
            if (action === "sync") publish(summary(await client.sync(id)));
            if (action.startsWith("reply:")) {
              const saved = task.replies?.[action.slice(6)];
              if (saved && (await ctx.ui.confirm("Reconcile saved reply?", remoteLabel(saved.text))))
                publish(summary(await client.answer(id, saved)));
            }
            if (action === "retry") {
              const saved = await client.transcript(id);
              publish(
                summary(
                  saved.outcome === "accepted"
                    ? await client.sync(id)
                    : await client.launch(saved.repoPath, saved.prompt, saved.taskId, saved.overrides),
                ),
              );
            }
            if (action === "cancel" && (await ctx.ui.confirm("Cancel remote task?", remoteLabel(task.prompt))))
              publish(summary(await client.cancel(id)));
          }
        }
      }
    } catch (error) {
      publish({
        error: String(error),
        hint: "No new answer should be inferred from a failed/uncertain submission; inspect saved status.",
      });
    } finally {
      picking = false;
    }
  };
  pi.registerCommand("remote", {
    getArgumentCompletions: async (prefix) => remoteCompletions(prefix, await client.status()),
    description:
      "Remote connect/status, launch/launch-repo, answer, grant/revoke, cancel, retry, sync, transcript (single active task selected automatically)",
    handler: async (input, ctx) => {
      if (!input.trim()) return inbox(ctx);
      try {
        const [op, ...rest] = input.trim().split(/\s+/);
        let result: unknown;
        switch (op) {
          case "connect":
            if (!rest[0] || rest.length > 2)
              throw Error("Usage: /remote connect <configured-ssh-host> [absolute-remote-die-path]");
            result = {
              host: rest[0],
              ...(await client.connect(rest[0], rest[1])),
              scope:
                "Host and cache are shared across this OS user’s sessions. Repository snapshots and local read-only capabilities require explicit actions; no credentials copied.",
            };
            break;
          case "status":
            result = await operations({ op: "status" });
            break;
          case "launch": {
            const { repoPath, prompt } = parseRemoteLaunch(input);
            result = summary(await client.launch(repoPath, prompt));
            break;
          }
          case "launch-repo":
          case "launch-repo-json": {
            const args =
              op === "launch-repo-json"
                ? JSON.parse(input.replace(/^\s*launch-repo-json\s+/, ""))
                : { prompt: input.replace(/^\s*launch-repo\s+/, "") };
            if (typeof args.prompt !== "string" || !args.prompt.trim())
              throw Error("Usage: /remote launch-repo <prompt>");
            let include: string[] = args.include ?? [];
            if (!Array.isArray(include) || include.some((p: unknown) => typeof p !== "string"))
              throw Error("include must be an explicit list of untracked paths");
            const root = ctx.cwd ?? process.cwd();
            const list = Bun.spawnSync(["git", "-C", root, "ls-files", "--others", "--exclude-standard", "-z"], {
              stdout: "pipe",
              stderr: "pipe",
              maxBuffer: 1024 * 1024,
            });
            if (list.exitCode) throw Error("Current directory must be a Git repository");
            const untracked = list.stdout.toString().split("\0").filter(Boolean);
            if (!include.length && untracked.length) {
              publish({
                untrackedOmitted: untracked,
                question:
                  'Transfer these untracked files too? Default is tracked only. Explicitly approve paths with /remote launch-repo-json {"prompt":"...","include":["path"]}.',
              });
              if (ctx.hasUI && (await ctx.ui.confirm("Include untracked files?", renderRemote(untracked))))
                include = untracked;
            } else if (
              include.length &&
              ctx.hasUI &&
              !(await ctx.ui.confirm("Transfer these untracked files?", renderRemote(include)))
            )
              throw Error("Untracked transfer not approved");
            result = summary(
              await launchRepository(client, {
                localRoot: root,
                prompt: args.prompt,
                taskId: args.taskId,
                approvedUntracked: include,
                model: args.model,
                thinking: args.thinking,
              }),
            );
            break;
          }
          case "answer": {
            const state = await client.status();
            const pending = Object.values(state.tasks).flatMap((t) =>
              ((t.task?.questions ?? []) as Array<any>)
                .filter((q) => q.status === "pending")
                .map((q) => ({ task: t, q })),
            );
            let selected = pending.find((p) => p.task.taskId === rest[0] && p.q.id === rest[1]),
              text: string;
            if (selected) text = input.match(/^\s*answer\s+\S+\s+\S+\s+([\s\S]*)$/)?.[1] ?? "";
            else {
              if (rest[0] && state.tasks[rest[0]])
                throw Error("Targeted question is not pending; inspect /remote status before retrying");
              selected = pending.find((p) => p.q.id === rest[0]);
              if (selected) text = input.match(/^\s*answer\s+\S+\s+([\s\S]*)$/)?.[1] ?? "";
              else {
                if (rest[0]?.startsWith("q_")) throw Error("Targeted question is not pending; no answer sent");
                if (pending.length !== 1) throw Error("Choose a pending question from /remote status");
                selected = pending[0]!;
                text = input.replace(/^\s*answer(?:\s+|$)/, "");
              }
            }
            if (!text.trim()) throw Error("Answer text is required; no answer sent");
            const prior = selected.task.replies?.[selected.q.id];
            result = summary(
              await client.answer(selected.task.taskId, {
                id: selected.q.id,
                owner: prior?.owner ?? selected.q.owner,
                version: prior?.version ?? selected.q.version,
                text,
                replyId: prior?.replyId,
              }),
            );
            break;
          }
          case "grant": {
            const taskId = await choose(rest[0]?.includes(":") || rest[0] === "repo.read" ? undefined : rest[0]);
            const selected = rest[0] === taskId ? rest.slice(1) : rest;
            if (!selected.length)
              throw Error("Usage: /remote grant [taskId] repo.read|tool:git-status|tool:git-diff|skill:name");
            result = await grantCapabilities(client, taskId, ctx.cwd ?? process.cwd(), selected as CapabilityKind[]);
            break;
          }
          case "revoke": {
            if (rest.length !== 2) throw Error("Usage: /remote revoke <taskId> <grantId>");
            result = await revokeCapability(client, rest[0]!, rest[1]!);
            break;
          }
          case "cancel":
            result = summary(await client.cancel(await choose(rest[0])));
            break;
          case "retry": {
            const id = await choose(rest[0]);
            let saved;
            try {
              saved = await client.transcript(id);
            } catch {
              result = summary(await retryRepository(client, id));
              break;
            }
            result = summary(
              saved.outcome === "accepted"
                ? await client.sync(saved.taskId)
                : await client.launch(saved.repoPath, saved.prompt, saved.taskId, saved.overrides),
            );
            break;
          }
          case "sync":
            result = summary(await client.sync(await choose(rest[0])));
            break;
          case "transcript":
            result = await operations({
              op: "transcript",
              taskId: await choose(rest[0]),
              offset: rest[1] === undefined ? 0 : Number(rest[1]),
            });
            break;
          default:
            throw Error(
              "Usage: /remote connect|status|launch|launch-repo|launch-repo-json|answer|grant|revoke|cancel|retry|sync|transcript",
            );
        }
        publish(result);
        void refresh();
      } catch (error) {
        publish({
          error: String(error),
          hint: "/remote status shows saved task/question IDs. Offline transcript remains available; uncertain operations must reconcile the same ID.",
        });
      }
    },
  });
}
