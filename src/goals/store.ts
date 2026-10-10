import { randomUUID } from "node:crypto";
import { recordDiagnostic } from "../diagnostics";
import { GOAL_STATUSES, type GoalEntry, type GoalState, type GoalStatus } from "./types";

export const GOAL_ENTRY_TYPE = "bruv-goal";
const MAX_FIELD = 4_000;
const MAX_ITEMS = 20;
const MAX_PROGRESS_ITEMS = 8;
const MAX_PROGRESS_FIELD = 500;
const MAX_AGGREGATE_TEXT = 12_000;

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required`);
  }
  if (value.length > MAX_FIELD) throw new Error(`${name} is too long`);
  return value.trim();
}

function strings(value: unknown, name: string, required = false): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${name} must be an array of nonempty strings`);
  }
  if (required && value.length === 0) throw new Error(`${name} is required`);
  if (value.length > MAX_ITEMS) throw new Error(`${name} has too many items`);
  return value.map((item) => text(item, name));
}

function optionalText(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : text(value, name);
}

function tokenCount(value: unknown, name: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be a ${minimum === 0 ? "nonnegative" : "positive"} safe integer`);
  }
  return value;
}

function budgetExhausted(goal: GoalState): boolean {
  return goal.tokenBudget !== undefined && goal.tokensUsed >= goal.tokenBudget;
}

function enforceBudget(goal: GoalState): void {
  if (budgetExhausted(goal) && (goal.status === "active" || goal.status === "waiting")) {
    goal.status = "budget_exceeded";
    delete goal.pendingJobIds;
  }
}

function aggregateText(goal: GoalState): number {
  return [
    goal.objective,
    ...goal.criteria,
    ...goal.constraints,
    ...(goal.progress ?? []),
    ...(goal.pendingJobIds ?? []),
    goal.evidence,
    goal.blocker,
    goal.pauseReason,
  ]
    .filter((item): item is string => typeof item === "string")
    .reduce((total, item) => total + item.length, 0);
}

function validateAggregate(goal: GoalState): void {
  if (aggregateText(goal) > MAX_AGGREGATE_TEXT) throw new Error("Goal payload is too large");
}

function progressText(value: unknown): string {
  const result = text(value, "progress evidence");
  if (result.length > MAX_PROGRESS_FIELD) throw new Error("progress evidence is too long");
  return result;
}

function parseGoal(value: unknown): GoalState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  try {
    const status = raw.status;
    if (typeof status !== "string" || !GOAL_STATUSES.includes(status as GoalStatus)) return undefined;
    if (typeof raw.revision !== "number" || !Number.isSafeInteger(raw.revision) || raw.revision < 1) return undefined;

    const goal: GoalState = {
      id: text(raw.id, "id"),
      revision: raw.revision,
      objective: text(raw.objective, "objective"),
      criteria: strings(raw.criteria, "criteria", true),
      constraints: strings(raw.constraints, "constraints"),
      status: status as GoalStatus,
      tokensUsed: raw.tokensUsed === undefined ? 0 : tokenCount(raw.tokensUsed, "tokensUsed", 0),
      createdAt: text(raw.createdAt, "createdAt"),
      updatedAt: text(raw.updatedAt, "updatedAt"),
    };

    if (raw.tokenBudget !== undefined) goal.tokenBudget = tokenCount(raw.tokenBudget, "tokenBudget", 1);
    if (goal.status === "budget_exceeded" && !budgetExhausted(goal)) return undefined;
    if ((goal.status === "active" || goal.status === "waiting") && budgetExhausted(goal)) return undefined;
    if (raw.progress !== undefined) {
      goal.progress = strings(raw.progress, "progress").map(progressText);
      if (goal.progress.length > MAX_PROGRESS_ITEMS) return undefined;
    }
    if (goal.status === "completed") goal.evidence = text(raw.evidence, "completion evidence");
    if (goal.status === "blocked") goal.blocker = text(raw.blocker, "blocker explanation");
    if (goal.status === "waiting") goal.pendingJobIds = strings(raw.pendingJobIds, "pendingJobIds", true);
    if (goal.status === "paused") goal.pauseReason = text(raw.pauseReason, "pause reason");
    validateAggregate(goal);
    return goal;
  } catch {
    return undefined;
  }
}

type RestoredEntry = { operation: "clear" } | { operation: "set" | "update"; goal: GoalState };

function parseEntry(entry: unknown): RestoredEntry | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const data = (entry as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const raw = data as Record<string, unknown>;
  if (raw.version !== 1 || typeof raw.at !== "string") return undefined;
  if (raw.operation === "clear") return { operation: "clear" };
  if (raw.operation !== "set" && raw.operation !== "update") return undefined;
  const goal = parseGoal(raw.goal);
  return goal ? { operation: raw.operation, goal } : undefined;
}

// These references are only for diagnostics, never for restoring job authority.
function untrustedWaitingIds(entry: unknown): string[] {
  if (!entry || typeof entry !== "object") return [];
  const data = (entry as { data?: unknown }).data;
  if (!data || typeof data !== "object") return [];
  const candidate = (data as { goal?: unknown }).goal;
  if (!candidate || typeof candidate !== "object") return [];
  const ids = (candidate as { pendingJobIds?: unknown }).pendingJobIds;
  return Array.isArray(ids) ? ids.slice(0, MAX_ITEMS).filter((id): id is string => typeof id === "string") : [];
}

export function latestGoal(entries: readonly unknown[], diagnosticOwner?: object): GoalState | undefined {
  let goal: GoalState | undefined;
  let restoreFailure: { taskIds: string[] } | undefined;
  for (const raw of entries) {
    const marker = raw as { type?: unknown; customType?: unknown } | undefined;
    if (marker?.type !== "custom" || marker.customType !== GOAL_ENTRY_TYPE) continue;

    const entry = parseEntry(raw);
    if (entry?.operation === "clear") {
      goal = undefined;
      restoreFailure = undefined;
      continue;
    }
    if (
      entry &&
      (entry.operation === "set" || (goal && entry.goal.id === goal.id && entry.goal.revision > goal.revision))
    ) {
      goal = structuredClone(entry.goal);
      restoreFailure = undefined;
      continue;
    }

    // Every entry of our custom type is an authority boundary. Malformed entries
    // and updates without a matching predecessor revoke, rather than revive, a goal.
    const priorWaitingIds = goal?.status === "waiting" ? (goal.pendingJobIds ?? []) : [];
    let rejectedWaitingIds: string[];
    if (entry) {
      rejectedWaitingIds = entry.goal.status === "waiting" ? (entry.goal.pendingJobIds ?? []) : [];
    } else {
      rejectedWaitingIds = untrustedWaitingIds(raw);
    }
    restoreFailure = { taskIds: [...new Set([...priorWaitingIds, ...rejectedWaitingIds])] };
    goal = undefined;
  }
  if (restoreFailure && diagnosticOwner) {
    // Always diagnose the authority boundary, even when forged task references
    // would themselves be rejected by the closed diagnostic schema.
    const refs = [
      undefined,
      ...restoreFailure.taskIds.filter((id) => /^task_[A-Za-z0-9]{1,64}$/.test(id)).slice(0, MAX_ITEMS),
    ];
    for (const taskId of refs) {
      recordDiagnostic(diagnosticOwner, {
        component: "resume",
        code: "state_invalid",
        outcome: "fallback",
        ...(taskId ? { taskId } : {}),
      });
    }
  }
  return goal;
}

export class GoalStore {
  #goal?: GoalState;

  constructor(
    private readonly append: (type: string, data: GoalEntry) => void,
    entries: readonly unknown[] = [],
    private readonly now = () => new Date().toISOString(),
    diagnosticOwner?: object,
  ) {
    this.#goal = latestGoal(entries, diagnosticOwner);
  }

  get(): GoalState | undefined {
    return this.#goal ? structuredClone(this.#goal) : undefined;
  }

  set(input: { objective: unknown; criteria?: unknown; constraints?: unknown; tokenBudget?: unknown }): GoalState {
    if (this.#goal && this.#goal.status !== "completed") {
      throw new Error(
        "An unfinished goal already exists; complete it or explicitly clear it before setting a new goal",
      );
    }
    const at = this.now();
    const objective = text(input.objective, "objective");
    const goal: GoalState = {
      id: randomUUID(),
      revision: (this.#goal?.revision ?? 0) + 1,
      objective,
      criteria: input.criteria === undefined ? [objective] : strings(input.criteria, "criteria", true),
      constraints: input.constraints === undefined ? [] : strings(input.constraints, "constraints"),
      status: "active",
      tokensUsed: 0,
      createdAt: at,
      updatedAt: at,
    };
    if (input.tokenBudget !== undefined) goal.tokenBudget = tokenCount(input.tokenBudget, "tokenBudget", 1);
    validateAggregate(goal);
    return this.#save("set", goal);
  }

  update(
    input: {
      status: unknown;
      evidence?: unknown;
      blocker?: unknown;
      pendingJobIds?: unknown;
      reason?: unknown;
      progress?: unknown;
    },
    runningJobs: ReadonlySet<string> = new Set(),
  ): GoalState {
    if (!this.#goal) throw new Error("No goal is set");
    if (typeof input.status !== "string" || !GOAL_STATUSES.includes(input.status as GoalStatus)) {
      throw new Error("Invalid goal status");
    }

    const status = input.status as GoalStatus;
    if (status === "budget_exceeded") throw new Error("budget_exceeded status is runtime-managed");
    if ((status === "active" || status === "waiting") && budgetExhausted(this.#goal)) {
      throw new Error("Goal token budget is exhausted; increase or remove the budget before resuming");
    }
    const goal: GoalState = {
      ...this.#goal,
      status,
      revision: this.#goal.revision + 1,
      updatedAt: this.now(),
    };
    delete goal.evidence;
    delete goal.blocker;
    delete goal.pendingJobIds;
    delete goal.pauseReason;

    if (status === "completed") goal.evidence = text(input.evidence, "completion evidence");
    if (status === "blocked") goal.blocker = text(input.blocker, "blocker explanation");
    if (status === "waiting") {
      goal.pendingJobIds = strings(input.pendingJobIds, "pendingJobIds", true);
      const unknown = goal.pendingJobIds.filter((id) => !runningJobs.has(id));
      if (unknown.length > 0) {
        throw new Error(`Waiting needs your running jobs: ${unknown.join(", ")}`);
      }
    }
    if (status === "paused") {
      goal.pauseReason = optionalText(input.reason, "pause reason") ?? "Paused";
    }
    if (input.progress !== undefined) {
      if (status !== "active") throw new Error("progress evidence needs active status");
      const milestone = progressText(input.progress);
      const prior = goal.progress ?? [];
      if (!prior.includes(milestone)) goal.progress = [...prior, milestone].slice(-MAX_PROGRESS_ITEMS);
    }
    validateAggregate(goal);
    return this.#save("update", goal);
  }

  addUsage(tokens: number): GoalState | undefined {
    tokenCount(tokens, "tokens", 0);
    if (!this.#goal || tokens === 0) return this.get();
    const goal: GoalState = {
      ...this.#goal,
      // Saturate rather than lose precision or discard an otherwise valid usage event.
      tokensUsed: this.#goal.tokensUsed + Math.min(tokens, Number.MAX_SAFE_INTEGER - this.#goal.tokensUsed),
      revision: this.#goal.revision + 1,
      updatedAt: this.now(),
    };
    enforceBudget(goal);
    return this.#save("update", goal);
  }

  /** Changes to an existing budget are reserved for explicit user commands. */
  setBudget(tokenBudget: number | undefined): GoalState {
    if (!this.#goal) throw new Error("No goal is set");
    if (tokenBudget !== undefined) tokenCount(tokenBudget, "tokenBudget", 1);
    const goal: GoalState = {
      ...this.#goal,
      revision: this.#goal.revision + 1,
      updatedAt: this.now(),
    };
    if (tokenBudget === undefined) delete goal.tokenBudget;
    else goal.tokenBudget = tokenBudget;
    if (goal.status === "budget_exceeded" && !budgetExhausted(goal)) {
      goal.status = "paused";
      goal.pauseReason = "Token budget updated. Resume the goal to continue.";
    }
    enforceBudget(goal);
    return this.#save("update", goal);
  }

  clear(): void {
    const entry: GoalEntry = { version: 1, operation: "clear", at: this.now() };
    this.append(GOAL_ENTRY_TYPE, entry);
    this.#goal = undefined;
  }

  #save(operation: "set" | "update", goal: GoalState): GoalState {
    const saved = structuredClone(goal);
    this.append(GOAL_ENTRY_TYPE, {
      version: 1,
      operation,
      goal: saved,
      at: saved.updatedAt,
    });
    this.#goal = saved;
    return structuredClone(saved);
  }
}
