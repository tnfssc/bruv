import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerRemoteRuntime } from "./runtime";
import { RemoteClient } from "./client";
import { repositoryUntracked } from "./untracked-preview";
import { publishRemoteJobObservations } from "./job-observations";
import { createRemoteOperations, summarizeRemoteTask } from "./operations";
import { launchRepository, retryRepository, repositoryPreparations } from "./repository-wire";
import { grantCapabilities, revokeCapability, localCapabilityGrants } from "./services";
import type { CapabilityKind } from "./capabilities";
import { QuestionPicker } from "../questions/picker";
import { renderHuman, RemoteAttention, assistantText, remoteStatus } from "./human-rendering";
import {
  inboxItems,
  questionOptions,
  taskActions,
  remoteCompletions,
  pendingQuestions,
  remoteLabel,
  taskOwned,
} from "./menu";

/** Safe human-facing renderer. */
export const renderRemote = renderHuman;

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
    summary = (task: import("./client").RemoteTask) => ({
      ...summarizeRemoteTask(task),
      finalAssistantText: assistantText(task.events),
    });
  const publish = (result: unknown, kind?: string) =>
    pi.sendMessage({ customType: "die-remote", content: renderHuman(result, kind), display: true });
  let sessionFile: string | undefined;
  let sessionGeneration = 0;
  let inFlight = false,
    closed = false,
    picking = false,
    menuSnapshot: string | undefined,
    ui: { setStatus?: (key: string, value: string | undefined) => void } | undefined;
  const attention = new RemoteAttention();
  let lastStatus: string | undefined;
  let initialSnapshot = true;
  const activeInSession = new Set<string>();
  const rememberActive = (state: import("./client").RemoteState) => {
    for (const task of Object.values(state.tasks)) {
      if (task.jobSessionFile || !["accepted", "running"].includes(task.task?.state ?? "")) continue;
      if (activeInSession.has(task.taskId)) continue;
      activeInSession.add(task.taskId);
      pi.appendEntry?.("die-remote-active", { taskId: task.taskId });
    }
  };
  const menuFingerprint = (state: import("./client").RemoteState) =>
    JSON.stringify({
      items: inboxItems(state),
      needs: Object.values(state.tasks).map((task) => task.task?.capabilityNeeds),
    });
  const refresh = async () => {
    if (inFlight || closed) return;
    inFlight = true;
    const generation = sessionGeneration;
    const current = () => !closed && generation === sessionGeneration;
    let syncError: unknown;
    try {
      // Observe the cache before sync: a completion produced by this sync is new,
      // while a terminal result already on disk is not a fresh-session notice.
      if (initialSnapshot) {
        try {
          const baseline = await client.status();
          if (!current()) return;
          rememberActive(baseline);
        } catch {
          /* Retry baseline on next refresh. */
        }
      }
      if (!current()) return;
      try {
        await client.syncActive();
      } catch (error) {
        syncError = error;
      }
      if (!current()) return;
      const state = await client.status();
      if (!current()) return;
      if (picking) {
        const changed = menuSnapshot !== undefined && menuSnapshot !== menuFingerprint(state);
        ui?.setStatus?.(
          "die-remote",
          "remote: menu snapshot " +
            (syncError ? "offline" : changed ? "updated" : "current") +
            " · Refresh from remote to reload",
        );
        return;
      }
      const baseline = initialSnapshot;
      initialSnapshot = false;
      publishRemoteJobObservations(state, sessionFile);
      const status = remoteStatus(state, !!syncError);
      if (lastStatus !== status) {
        ui?.setStatus?.("die-remote", status);
        lastStatus = status;
      }
      for (const notice of attention.connection("owner", !!syncError, syncError, (key) =>
        pi.appendEntry?.("die-remote-attention", { key }),
      ))
        publish(notice);
      for (const notice of attention.update(
        { ...state, tasks: Object.fromEntries(Object.entries(state.tasks).filter(([, task]) => !task.jobSessionFile)) },
        (key) => pi.appendEntry?.("die-remote-attention", { key }),
        baseline ? (task) => !activeInSession.has(task.taskId) : undefined,
      ))
        publish(notice);
      rememberActive(state);
    } catch (error) {
      if (!current()) return;
      // A global cache/status failure must not masquerade as a healthy connection.
      const status = "remote: offline (cached state unavailable)";
      if (!picking && !closed && lastStatus !== status) {
        ui?.setStatus?.("die-remote", status);
        lastStatus = status;
      }
      if (!picking && !closed)
        for (const notice of attention.connection("owner", true, error, (key) =>
          pi.appendEntry?.("die-remote-attention", { key }),
        ))
          publish(notice);
    } finally {
      inFlight = false;
      // A new session may have requested refresh while this old one was awaiting I/O.
      if (!closed && generation !== sessionGeneration) void refresh();
    }
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  const startRefresh = () => {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      void refresh();
    }, 5000);
    timer.unref();
  };
  startRefresh();
  pi.on("session_start", async (_event, ctx) => {
    sessionGeneration++;
    sessionFile = ctx?.sessionManager?.getSessionFile?.();
    closed = false;
    startRefresh();
    ui = ctx.hasUI ? ctx.ui : undefined;
    lastStatus = undefined;
    attention.reset();
    initialSnapshot = true;
    activeInSession.clear();
    for (const entry of (ctx.sessionManager?.getBranch?.() ?? []) as any[])
      if (entry.type === "custom" && entry.customType === "die-remote-active" && typeof entry.data?.taskId === "string")
        activeInSession.add(entry.data.taskId);
    attention.restore(
      (ctx.sessionManager?.getBranch?.() ?? [])
        .filter((entry: any) => entry.type === "custom" && entry.customType === "die-remote-attention")
        .map((entry: any) => entry.data?.key)
        .filter((key: unknown): key is string => typeof key === "string"),
    );
    void refresh();
  });
  pi.on("session_shutdown", async () => {
    sessionGeneration++;
    closed = true;
    sessionFile = undefined;
    if (timer) clearInterval(timer);
    timer = undefined;
    ui?.setStatus?.("die-remote", undefined);
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
  const capabilityMenu = async (ctx: any, pinned: import("./client").RemoteTask) => {
    const id = pinned.taskId;
    const freshTask = async () => {
      const task = await client.sync(id);
      const state = await client.status();
      if (
        task.host !== pinned.host ||
        task.ownerId !== pinned.ownerId ||
        task.epoch !== pinned.epoch ||
        !taskOwned(task, state) ||
        task.lastError ||
        !["accepted", "running"].includes(task.task?.state ?? "")
      )
        throw Error("Capability action unavailable: pinned owner changed, offline, or task ended; no grant sent");
      return task;
    };
    let task = await freshTask();
    const needs = Array.isArray(task.task?.capabilityNeeds)
      ? (task.task.capabilityNeeds as { id: string; kind: string; input: string }[])
      : [];
    const grants = localCapabilityGrants(client, id);
    const choice = await pick(ctx, "Local capabilities · " + remoteLabel(task.prompt), [
      ...needs.map((need, i) => ({
        value: "need:" + i,
        label: "Request: " + remoteLabel(need.kind),
        description: remoteLabel(need.input || "No input supplied"),
      })),
      { value: "choose", label: "Choose a capability…", description: "Explicit read-only local repository authority" },
      ...grants.map((grant, i) => ({
        value: "revoke:" + i,
        label: "Revoke: " + remoteLabel(grant.kinds.join(", ")),
        description: remoteLabel(grant.repoRoot) + " · " + grant.id.slice(0, 18),
      })),
    ]);
    if (!choice) return;
    if (choice.startsWith("revoke:")) {
      const grant = grants[Number(choice.slice(7))];
      if (!grant) return;
      if (
        !(await ctx.ui.confirm(
          "Revoke local capability for this task?",
          "Task: " +
            remoteLabel(task.prompt) +
            "\nLocal repository: " +
            grant.repoRoot +
            "\nAuthority: " +
            grant.kinds.join(", ") +
            "\nGrant: " +
            grant.id,
        ))
      )
        return;
      await freshTask();
      if (!localCapabilityGrants(client, id).some((g) => g.id === grant.id))
        throw Error("Grant changed; no revoke sent");
      publish(await revokeCapability(client, id, grant.id));
      return;
    }
    const need = choice.startsWith("need:") ? needs[Number(choice.slice(5))] : undefined;
    let kind = need?.kind;
    if (choice === "choose") {
      const selected = await pick(ctx, "Read-only local authority", [
        ...["repo.read", "tool:git-status", "tool:git-diff"].map((value) => ({ value, label: value })),
        { value: "skill", label: "Named skill…", description: "Enter skill:name" },
      ]);
      if (!selected) return;
      kind = selected === "skill" ? (await ctx.ui.editor("Capability kind (skill:name)"))?.trim() : selected;
    }
    if (!kind || !/^(repo\.read|tool:git-status|tool:git-diff|skill:[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63})$/.test(kind))
      throw Error("Invalid capability kind; no grant sent");
    const root = ctx.cwd ?? process.cwd();
    const check = Bun.spawnSync(["git", "-C", root, "rev-parse", "--show-toplevel"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (check.exitCode) throw Error("Capabilities require the current Git repository");
    const scope = check.stdout.toString().trim();
    const details =
      "Task: " +
      remoteLabel(task.prompt) +
      "\nPinned owner: " +
      task.host +
      " / " +
      task.ownerId +
      "\nLocal repository: " +
      scope +
      "\nAuthority: " +
      kind +
      (need ? "\nRemote request: " + remoteLabel(need.input || "(empty)") : "\nNo specific remote request selected") +
      "\nRead-only repository access only; no credentials or arbitrary shell. This grants the entire named kind for this task, not just one request.";
    if (!(await ctx.ui.confirm("HUMAN authorization required · grant local capability?", details))) return;
    task = await freshTask();
    if (
      need &&
      !(task.task?.capabilityNeeds as any[] | undefined)?.some(
        (n) => n.id === need.id && n.kind === need.kind && n.input === need.input,
      )
    )
      throw Error("Remote request changed; no grant sent");
    const recheck = Bun.spawnSync(["git", "-C", root, "rev-parse", "--show-toplevel"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    if (recheck.exitCode || recheck.stdout.toString().trim() !== scope)
      throw Error("Local repository scope changed; no grant sent");
    publish(await grantCapabilities(client, id, scope, [kind as CapabilityKind]));
  };
  const inbox = async (ctx: any) => {
    if (!ctx.hasUI) {
      publish(await operations({ op: "status" }), "status");
      return;
    }
    ui = ctx.ui;
    picking = true;
    try {
      while (true) {
        const state = await client.status();
        menuSnapshot = menuFingerprint(state);
        ui?.setStatus?.("die-remote", "remote: menu snapshot · Refresh from remote to reload");
        const choice = await pick(ctx, "Remote · inbox", inboxItems(state));
        if (!choice) return;
        if (choice.startsWith("offline")) continue;
        if (choice === "refresh") {
          // Explicit refresh, unlike the timer, may contact the owner while the menu is open.
          await client.syncActive();
          continue;
        }
        if (choice === "connect") {
          const host = (await ctx.ui.editor("SSH user@host or configured alias"))?.trim();
          if (!host) continue;
          const path = await ctx.ui.editor("Remote die path (blank for default)");
          if (path === undefined) continue;
          publish({ host, ...(await client.connect(host, path.trim() || undefined)) }, "connect");
          continue;
        }
        if (choice === "launch") {
          const prompt = (await ctx.ui.editor("Remote task prompt"))?.trim();
          if (prompt) {
            const root = ctx.cwd ?? process.cwd();
            const untracked = await repositoryUntracked(root);
            const approvedUntracked =
              !untracked.incomplete &&
              untracked.count &&
              (await ctx.ui.confirm(
                "Include untracked files?",
                renderRemote({
                  paths: untracked.preview,
                  count: untracked.count,
                  note: `Showing ${untracked.preview.length} of ${untracked.count}; approval includes all ${untracked.count} untracked paths.`,
                }),
              ))
                ? untracked.paths
                : [];
            if (untracked.count && !approvedUntracked.length)
              ctx.ui.notify(
                `Untracked files omitted (${untracked.incomplete ? "at least " : ""}${untracked.count}); sending tracked files only.`,
                "info",
              );
            publish(
              summary(
                await launchRepository(client, {
                  localRoot: root,
                  approvedUntracked,
                  prompt,
                  jobSessionFile: ctx.sessionManager?.getSessionFile?.(),
                }),
              ),
            );
          }
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
            if (action === "capabilities") {
              await capabilityMenu(ctx, task);
              continue;
            }
            if (action === "details") {
              publish(summary(task));
              return; // Keep saved details visible instead of covering them with the picker.
            }
            if (action === "transcript") {
              publish(await operations({ op: "transcript", taskId: id, offset: 0 }), "transcript");
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
            if (action === "cancel" && (await ctx.ui.confirm("Cancel remote task?", remoteLabel(task.prompt)))) {
              // The picker and confirmation can stay open while connection or task changes.
              const fresh = await client.status();
              const pinned = fresh.tasks[id];
              if (
                !pinned ||
                pinned.host !== task.host ||
                pinned.ownerId !== task.ownerId ||
                pinned.epoch !== task.epoch ||
                !taskOwned(pinned, fresh) ||
                pinned.lastError ||
                !["accepted", "running"].includes(pinned.task?.state ?? "")
              )
                throw Error(
                  "Cancellation unavailable: pinned owner offline, changed, or task no longer active; no cancel sent",
                );
              publish(summary(await client.cancel(id)));
            }
          }
        }
      }
    } catch (error) {
      publish(
        {
          error: String(error),
          hint: "No answer or confirmed cancellation should be inferred from a failed/uncertain submission; inspect saved status.",
        },
        "error",
      );
    } finally {
      picking = false;
      menuSnapshot = undefined;
      // The snapshot banner describes an open picker, not the normal chat view.
      ui?.setStatus?.("die-remote", undefined);
      lastStatus = undefined;
    }
  };
  pi.registerCommand("remote", {
    getArgumentCompletions: async (prefix) => remoteCompletions(prefix, await client.status()),
    description:
      "Remote connect/status, launch/launch-repo, answer, grant/revoke, cancel, retry, sync, transcript (single active task selected automatically)",
    handler: async (input, ctx) => {
      if (!input.trim()) return inbox(ctx);
      try {
        if (ctx.hasUI) ui = ctx.ui;
        const [op, ...rest] = input.trim().split(/\s+/);
        let result: unknown;
        let rawTranscript = false;
        switch (op) {
          case "connect":
            if (!rest[0] || rest.length > 2)
              throw Error("Usage: /remote connect <user@host-or-configured-alias> [absolute-remote-die-path]");
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
            result = summary(
              await client.launch(repoPath, prompt, undefined, undefined, ctx.sessionManager?.getSessionFile?.()),
            );
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
            const untracked = await repositoryUntracked(root);
            if (!include.length && untracked.count) {
              publish({
                untrackedOmitted: untracked.preview,
                untrackedCount: untracked.count,
                untrackedCountIncomplete: untracked.incomplete,
                question: `Omitting ${untracked.incomplete ? "at least " : ""}${untracked.count} untracked files by default. ${untracked.incomplete ? "Listing incomplete; bulk approval unavailable. " : ""}Explicitly approve paths with /remote launch-repo-json {"prompt":"...","include":["path"]}.`,
              });
              if (
                !untracked.incomplete &&
                ctx.hasUI &&
                (await ctx.ui.confirm(
                  "Include untracked files?",
                  renderRemote({
                    paths: untracked.preview,
                    count: untracked.count,
                    note: `Showing ${untracked.preview.length} of ${untracked.count}; approval includes all ${untracked.count} untracked paths.`,
                  }),
                ))
              )
                include = untracked.paths;
            } else if (
              include.length &&
              ctx.hasUI &&
              !(await ctx.ui.confirm("Transfer these untracked files?", renderRemote(include)))
            )
              throw Error("Untracked transfer not approved");
            result = summary(
              await launchRepository(client, {
                localRoot: root,
                jobSessionFile: ctx.sessionManager?.getSessionFile?.(),
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
          case "transcript": {
            const raw = rest.at(-1) === "raw";
            const page = raw ? rest.slice(0, -1) : rest;
            if (page.length > 2) throw Error("Usage: /remote transcript [taskId] [offset] [raw]");
            result = await operations({
              op: "transcript",
              taskId: await choose(page[0]),
              offset: page[1] === undefined ? 0 : Number(page[1]),
            });
            rawTranscript = raw;
            break;
          }
          default:
            throw Error(
              "Usage: /remote connect|status|launch|launch-repo|launch-repo-json|answer|grant|revoke|cancel|retry|sync|transcript",
            );
        }
        publish(
          result,
          rawTranscript
            ? "transcript-raw"
            : op === "status" || op === "transcript" || op === "connect"
              ? op
              : undefined,
        );
        void refresh();
      } catch (error) {
        publish(
          {
            error: String(error),
            hint: "/remote status shows saved task/question IDs. Offline transcript remains available; uncertain operations must reconcile the same ID.",
          },
          "error",
        );
      }
    },
  });
}
