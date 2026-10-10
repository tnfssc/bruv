import { selectDiskBackedBranchEntries } from "../history/session-manager";
import { GOAL_ENTRY_TYPE } from "./store";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import goalGuidance from "../prompts/goal.md" with { type: "text" };
import goalContinuation from "../prompts/goal-continuation.md" with { type: "text" };
import { GoalContinuationController } from "./controller";
import { GoalStore } from "./store";
import type { GoalJobCoordinator, GoalState } from "./types";

export interface GoalRuntime {
  get(): GoalState | undefined;
  /** True only while an authorized automatic turn is queued for this goal. */
  hasPendingContinuation(): boolean;
  handle(method: string, params: unknown): unknown;
  jobsChanged(): void;
  /** A host Stop also revokes continuations queued between Pi runs. */
  interrupt(reason?: string): void;
}

function formatGoal(goal?: GoalState): string {
  if (!goal) return "No goal is set.";
  return [
    `Goal: ${goal.objective}`,
    `Status: ${goal.status}`,
    `Tokens used: ${goal.tokensUsed}${goal.tokenBudget === undefined ? " (no budget)" : ` / ${goal.tokenBudget}; remaining: ${Math.max(0, goal.tokenBudget - goal.tokensUsed)}`}`,
    `Criteria: ${goal.criteria.join("; ")}`,
    `Constraints: ${goal.constraints.join("; ") || "none"}`,
    goal.progress?.length && `Progress:\n${goal.progress.map((item) => `- ${item}`).join("\n")}`,
    goal.evidence && `Evidence: ${goal.evidence}`,
    goal.blocker && `Blocker: ${goal.blocker}`,
    goal.pendingJobIds?.length && `Waiting on: ${goal.pendingJobIds.join(", ")}`,
    goal.pauseReason && `Reason: ${goal.pauseReason}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function continuation(goal: GoalState): string {
  // The context hook injects the complete authoritative state on every request.
  // The follow-up only signals why a new turn exists, avoiding duplicate mutable state.
  if (goal.status !== "active") throw new Error("Only active goals can continue automatically");
  return goalContinuation.trimEnd();
}

// Transport tokens authorize only a pending, exact extension payload. They are
// separate from the controller's accounting of automatic model runs.
class GoalReminders {
  #epoch = randomUUID();
  #generation = 0;
  #sequence = 0;
  #pending = new Set<string>();

  get pending(): boolean {
    return this.#pending.size > 0;
  }

  issue(goal: GoalState): string {
    const id = String(++this.#sequence);
    const oldest = this.#pending.values().next().value;
    if (this.#pending.size >= 16 && oldest !== undefined) this.#pending.delete(oldest);
    this.#pending.add(id);
    return `${continuation(goal)}\n\n<!-- bruv-goal-reminder:${this.#epoch}:${this.#generation}:${id} -->`;
  }

  consume(text: string, goal: GoalState | undefined, hasBlockingQuestions: () => boolean) {
    const match = /<!-- bruv-goal-reminder:([^:>]+):(\d+):(\d+) -->/.exec(text);
    if (!match) return;
    const id = match[3];
    const accepted = match[1] === this.#epoch && Number(match[2]) === this.#generation && this.#pending.has(id);
    if (!accepted || !goal) return { action: "handled" as const };
    // A foreground question can appear after the reminder was issued.
    if (hasBlockingQuestions()) {
      this.#pending.delete(id);
      return { action: "handled" as const };
    }
    // A copied trailer must neither transform unrelated content nor consume
    // the legitimate pending reminder.
    const plain = continuation(goal);
    if (text !== `${plain}\n\n${match[0]}`) return { action: "handled" as const };
    this.#pending.delete(id);
    return { action: "transform" as const, text: plain };
  }

  discard(): void {
    this.#pending.clear();
  }

  invalidate(): void {
    this.#generation++;
    this.discard();
  }

  restart(): void {
    this.#epoch = randomUUID();
    this.discard();
  }
}

function parseSet(args: string): {
  objective: string;
  criteria?: string[];
  constraints?: string[];
  tokenBudget?: number;
} {
  const flags = [...args.matchAll(/(?:^|\s+)--(\S+)(?=\s|$)/g)];
  const split = (value: string) =>
    value
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
  const input: ReturnType<typeof parseSet> = { objective: args.slice(0, flags[0]?.index).trim() };
  const seen = new Set<string>();
  for (const [index, flag] of flags.entries()) {
    const name = flag[1];
    if (!["criteria", "constraints", "tokens"].includes(name)) throw new Error(`Unknown goal option --${name}`);
    if (seen.has(name)) throw new Error(`Repeated --${name} option`);
    seen.add(name);
    const value = args.slice(flag.index + flag[0].length, flags[index + 1]?.index).trim();
    if (!value) throw new Error(`--${name} requires a value`);
    if (name === "tokens") input.tokenBudget = parseBudget(value);
    else if (name === "criteria") input.criteria = split(value);
    else input.constraints = value === "none" ? [] : split(value);
  }
  return input;
}

function parseBudget(value: string): number {
  const budget = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(budget) || budget <= 0) {
    throw new Error("Token budget must be a positive whole number");
  }
  return budget;
}

export function registerGoalMode(
  pi: ExtensionAPI,
  jobs: GoalJobCoordinator,
  options: {
    hasBlockingQuestions?: () => boolean;
    canContinue?: () => boolean;
    onHumanStart?: (ctx: ExtensionContext) => void;
    /** Native hosts may fence Pi admission against a concurrent Stop. */
    sendContinuation?: (message: string) => void;
  } = {},
): GoalRuntime {
  let store: GoalStore | undefined;
  let loadedManager: object | undefined;
  let loadedLeaf: string | undefined;
  let context: ExtensionContext | undefined;
  let jobsDirty = false;
  let lastStopReason: string | undefined;
  let accountingGoalId: string | undefined;
  let runActive = false;
  let continuationAdmitted = false;
  let lastAssistantTokens = 0;
  const reminders = new GoalReminders();
  const controller = new GoalContinuationController();
  // Only foreground blockers should be reported here; child-only questions do not stop goal continuation.
  const hasBlockingQuestions = () => options.hasBlockingQuestions?.() ?? false;
  const canContinue = () => options.canContinue?.() ?? true;
  const unavailable =
    "Goal work needs the execute tool outside Plan mode. Change the mode/tools, then use /goal resume.";

  const leafOf = (ctx: ExtensionContext) => ctx.sessionManager?.getLeafId?.() ?? undefined;
  const ensureStore = (ctx: ExtensionContext): GoalStore => {
    context = ctx;
    const manager = ctx.sessionManager as object | undefined;
    const leaf = leafOf(ctx);
    if (!store || loadedManager !== manager || (leaf !== undefined && leaf !== loadedLeaf)) {
      const entries =
        (ctx.sessionManager &&
          selectDiskBackedBranchEntries(
            ctx.sessionManager,
            (meta) => meta.type === "custom" && meta.customType === GOAL_ENTRY_TYPE,
          )) ??
        ctx.sessionManager?.getBranch?.() ??
        ctx.sessionManager?.getEntries() ??
        [];
      const candidate = new GoalStore(
        (type, data) => {
          pi.appendEntry(type, data);
          loadedLeaf = leafOf(ctx);
        },
        entries,
        undefined,
        manager,
      );
      const branchChanged =
        !store || loadedManager !== manager || JSON.stringify(candidate.get()) !== JSON.stringify(store.get());
      loadedManager = manager;
      loadedLeaf = leaf;
      // Ordinary messages also advance the leaf. Preserve controller state when
      // branch-derived goal state is unchanged, but refresh after navigation.
      if (branchChanged) {
        store = candidate;
        jobsDirty = store.get()?.status === "waiting";
        reminders.discard();
        controller.reset();
      }
    }
    if (!store) throw new Error("Goal state is not initialized");
    return store;
  };
  const requireStore = () => {
    if (context) return ensureStore(context);
    if (!store) throw new Error("Goal state is not initialized");
    return store;
  };
  const notify = (message: string, level: "info" | "warning" = "info") => {
    context?.ui.notify(message, level);
  };
  const announce = (goal: GoalState) => {
    // A durable custom message is visible in both the CLI and the native connector.
    pi.sendMessage(
      { customType: "bruv-goal-status", content: formatGoal(goal), display: true },
      { triggerTurn: false },
    );
  };
  const resetContinuation = () => {
    continuationAdmitted = false;
    reminders.invalidate();
    controller.reset();
  };
  const pause = (reason: string) => {
    const current = store?.get();
    if (current?.status === "active" || current?.status === "waiting") {
      const paused = requireStore().update({ status: "paused", reason });
      resetContinuation();
      announce(paused);
    }
  };
  const sendContinuation = (goal: GoalState) => {
    if (!canContinue()) return;
    const message = reminders.issue(goal);
    if (options.sendContinuation) options.sendContinuation(message);
    else pi.sendUserMessage(message, { deliverAs: "followUp" });
  };
  const reconcileWaiting = () => {
    const goal = store?.get();
    if (goal?.status !== "waiting" || !jobsDirty) return;
    jobsDirty = false;
    const pendingJobIds = goal.pendingJobIds;
    if (!pendingJobIds) throw new Error("Waiting goal is missing its job IDs");
    const statuses = pendingJobIds.map((id) => jobs.status(id));
    if (statuses.some((status) => status === "unavailable")) {
      const references = pendingJobIds.filter((id) => /^task_[A-Za-z0-9]{1,64}$/.test(id));
      pause("Paused: waiting jobs not here" + (references.length ? `. Job references: ${references.join(", ")}` : ""));
    } else if (statuses.some((status) => status === "finished")) {
      requireStore().update({ status: "active" });
      reminders.invalidate();
    }
  };

  pi.registerCommand("goal", {
    description: "Set or inspect persistent goal mode",
    async handler(args, ctx) {
      context = ctx;
      const activeStore = ensureStore(ctx);
      const trimmed = args.trim();
      const first = trimmed.split(/\s+/)[0] || "status";
      const known = ["set", "status", "pause", "resume", "clear", "budget", "help"];
      const command = known.includes(first) ? first : "set";
      const value = command === first ? trimmed.slice(first.length).trim() : trimmed;
      try {
        if ((command === "set" || command === "resume") && !canContinue()) throw new Error(unavailable);
        if (["status", "resume", "clear", "help"].includes(command) && value)
          throw new Error(`Usage: /goal ${command}`);
        if (command === "set") activeStore.set(parseSet(value));
        else if (command === "status") {
          notify(formatGoal(activeStore.get()) + (activeStore.get() && !canContinue() ? `\n${unavailable}` : ""));
          return;
        } else if (command === "help") {
          notify(
            "/goal <objective> [--criteria one; two] [--constraints ...] [--tokens N]\n/goal status · /goal pause · /goal resume · /goal clear · /goal budget <N|none>",
          );
          return;
        } else if (command === "pause") {
          activeStore.update({ status: "paused", reason: value || "Paused by user" });
        } else if (command === "resume") activeStore.update({ status: "active" });
        else if (command === "clear") activeStore.clear();
        else if (command === "budget") activeStore.setBudget(value === "none" ? undefined : parseBudget(value));

        resetContinuation();
        if ((command === "pause" || command === "clear") && !ctx.isIdle()) ctx.abort();
        const current = activeStore.get();
        if (current?.status === "active" && (command === "set" || command === "resume")) options.onHumanStart?.(ctx);
        if (current?.status === "budget_exceeded" && !ctx.isIdle()) ctx.abort();
        notify(
          formatGoal(current) +
            (current?.status === "active" && hasBlockingQuestions()
              ? "\nWaiting for an answer to the open question."
              : ""),
        );
        if (current?.status === "active" && !hasBlockingQuestions() && (command === "set" || command === "resume")) {
          sendContinuation(current);
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), "warning");
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    context = ctx;
    store = undefined;
    loadedManager = undefined;
    loadedLeaf = undefined;
    reminders.restart();
    ensureStore(ctx);
    resetContinuation();
    lastStopReason = undefined;
    accountingGoalId = undefined;
    runActive = false;
    lastAssistantTokens = 0;
  });

  // Runs before every provider request, including tool and custom-message
  // continuations. Mutable goal state stays out of the cache-sensitive system
  // prefix and participates in the ordinary context filtering lifecycle.
  pi.on("context", (event, ctx) => {
    ensureStore(ctx);
    reconcileWaiting();
    const goal = store?.get();
    if (!goal) return;
    return {
      messages: [
        ...event.messages,
        {
          role: "custom" as const,
          customType: "bruv-goal-state",
          content: `Goal guidance:\n${goalGuidance.trimEnd()}\n\nSaved goal (current state):\n${formatGoal(goal)}${controller.audit() ? `\nBlocker audit: ${JSON.stringify(controller.audit())}` : ""}${!canContinue() ? `\nGoal pursuit is suspended in the current mode. ${unavailable}` : ""}`,
          display: false,
          timestamp: Date.now(),
        },
      ],
    };
  });

  pi.on("input", (event, ctx) => {
    // A deferred Pi prompt can replay after shutdown. Reject its old reminder
    // before accessing the now-invalid extension context.
    if (!context && event.source === "extension") {
      const discarded = reminders.consume(event.text, undefined, () => false);
      if (discarded) return discarded;
    }
    context = ctx;
    ensureStore(ctx);
    if (event.source === "extension") {
      const result = reminders.consume(event.text, store?.get(), () => hasBlockingQuestions() || !canContinue());
      if (result?.action === "transform") continuationAdmitted = true;
      return result;
    }
    // Steering changes the work, not its authorization. Revoke queued reminders
    // and recheck any blocker using the user's new information.
    resetContinuation();
  });

  pi.on("agent_start", (_event, ctx) => {
    continuationAdmitted = false;
    controller.beginRun();
    lastStopReason = undefined;
    runActive = true;
    lastAssistantTokens = 0;
    const goal = ensureStore(ctx).get();
    accountingGoalId = goal && canContinue() && ["active", "waiting"].includes(goal.status) ? goal.id : undefined;
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const usage = event.message.usage;
    const tokens = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].reduce(
      (total, value) => total + (Number.isSafeInteger(value) && value > 0 ? value : 0),
      0,
    );
    lastAssistantTokens = Math.min(tokens, Number.MAX_SAFE_INTEGER);
    const prior = ensureStore(ctx).get();
    if (!prior || prior.id !== accountingGoalId) return;
    const current = requireStore().addUsage(lastAssistantTokens);
    if (current?.status === "budget_exceeded" && prior.status !== "budget_exceeded") {
      resetContinuation();
      announce(current);
      // Stop at a response boundary before another tool/provider request.
      ctx.abort();
    }
  });

  pi.on("tool_execution_end", (event) => {
    if (event.toolName !== "execute" || event.isError || typeof event.result?.details?.handoff !== "string") return;
    const current = store?.get();
    // An explicit state transition in the handed-off execution wins. Otherwise
    // suppress reminders only while this process still owns running work.
    if (current?.status !== "active") return;
    const pendingJobIds = [...jobs.runningIds()];
    if (pendingJobIds.length === 0) return;
    requireStore().update({ status: "waiting", pendingJobIds }, new Set(pendingJobIds));
    reminders.invalidate();
  });

  pi.on("agent_end", (event, ctx) => {
    runActive = false;
    const last = [...event.messages].reverse().find((message) => message.role === "assistant");
    lastStopReason = last?.stopReason;
    if (ctx.signal?.aborted || last?.stopReason === "aborted") {
      pause("Paused after interrupted agent turn");
      return;
    }
    if (last?.stopReason !== "error") controller.endRun();
  });

  pi.on("agent_settled", (event, ctx) => {
    context = ctx;
    ensureStore(ctx);
    reconcileWaiting();
    const goal = store?.get();
    if (!goal) return;
    if (event.aborted || ctx.signal?.aborted) {
      pause("Paused after interruption");
      return;
    }
    if (lastStopReason === "error") {
      pause("Paused after provider retries failed; resume to try again");
      return;
    }

    if (!hasBlockingQuestions() && goal.status === "active") {
      sendContinuation(goal);
    }
  });

  pi.on("session_shutdown", () => {
    reminders.restart();
    controller.reset();
    store = undefined;
    context = undefined;
    loadedManager = undefined;
    loadedLeaf = undefined;
    jobsDirty = false;
  });

  return {
    get: () => (context ? ensureStore(context).get() : store?.get()),
    hasPendingContinuation: () =>
      (reminders.pending || continuationAdmitted) &&
      store?.get()?.status === "active" &&
      canContinue() &&
      !hasBlockingQuestions(),
    interrupt(reason = "Paused by user") {
      if (context) ensureStore(context);
      pause(reason);
      resetContinuation();
    },
    jobsChanged() {
      jobsDirty = true;
      reconcileWaiting();
    },
    handle(method, params) {
      const input = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
      if (method === "goal.get") return requireStore().get() ?? null;
      if (method === "goal.set") {
        if (!canContinue()) throw new Error(unavailable);
        const result = requireStore().set({
          objective: input.objective,
          criteria: input.criteria,
          constraints: input.constraints,
          tokenBudget: input.tokenBudget,
        });
        resetContinuation();
        if (runActive) {
          accountingGoalId = result.id;
          const accounted = requireStore().addUsage(lastAssistantTokens) ?? result;
          if (accounted.status === "budget_exceeded") {
            announce(accounted);
            context?.abort();
          }
          return accounted;
        }
        return result;
      }
      if (method === "goal.update") {
        if ("tokensUsed" in input || "tokenBudget" in input) {
          throw new Error("Token usage is runtime-managed; only the user can change the budget with /goal budget");
        }
        if ("pendingJobIds" in input) {
          throw new Error("Runtime owns pendingJobIds. handoff() waits for your running jobs.");
        }
        if (input.status === "waiting") {
          throw new Error("Runtime owns waiting status. handoff() waits for your running jobs.");
        }
        if (input.status === "budget_exceeded") {
          throw new Error(
            "Runtime owns budget_exceeded status. Only the user can change the budget with /goal budget.",
          );
        }
        const prior = requireStore().get();
        if (input.status === "active" && prior && !["active", "waiting"].includes(prior.status)) {
          throw new Error("Only the user can resume this goal; use /goal resume");
        }
        if (input.status === "blocked") {
          if (!prior || !["active", "waiting"].includes(prior.status)) throw new Error("Goal is not active");
          if (typeof input.blocker !== "string" || !input.blocker.trim() || input.blocker.length > 4_000) {
            throw new Error("A blocker explanation of 1–4000 characters is required");
          }
          if (!controller.reportBlocker(input.blocker.trim())) {
            const active = requireStore().update({ status: "active" });
            reminders.invalidate();
            return { ...active, blockerAudit: controller.audit() };
          }
        }
        const result = requireStore().update(input as never);
        if (JSON.stringify(prior?.progress) !== JSON.stringify(result.progress)) controller.reset();
        reminders.invalidate();
        return result;
      }
      if (method === "goal.clear") {
        requireStore().clear();
        resetContinuation();
        return { cleared: true };
      }
      throw new Error(`Unknown goal method: ${method}`);
    },
  };
}
