export const GOAL_STATUSES = ["active", "waiting", "blocked", "completed", "paused", "budget_exceeded"] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

export type GoalUpdateStatus = Exclude<GoalStatus, "waiting" | "budget_exceeded">;

export interface GoalSetInput {
  objective: string;
  criteria?: string[];
  constraints?: string[];
  tokenBudget?: number;
}

export interface GoalUpdateInput {
  status: GoalUpdateStatus;
  progress?: string;
  evidence?: string;
  blocker?: string;
  reason?: string;
}

export interface GoalState {
  id: string;
  revision: number;
  objective: string;
  criteria: string[];
  constraints: string[];
  status: GoalStatus;
  /** Cumulative provider token usage attributed to this goal by the runtime. */
  tokensUsed: number;
  /** Only set when the user explicitly requests a token budget. */
  tokenBudget?: number;
  createdAt: string;
  updatedAt: string;
  /** Bounded, explicit evidence of concrete progress while the goal remains active. */
  progress?: string[];
  evidence?: string;
  blocker?: string;
  pendingJobIds?: string[];
  pauseReason?: string;
}

export type GoalEntry =
  | {
      version: 1;
      operation: "set" | "update";
      goal: GoalState;
      at: string;
    }
  | {
      version: 1;
      operation: "clear";
      at: string;
    };

export type OwnedJobStatus = "running" | "finished" | "unavailable";

export interface GoalJobCoordinator {
  status(id: string): OwnedJobStatus;
  runningIds(): ReadonlySet<string>;
}
