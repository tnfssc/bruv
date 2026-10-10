import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { toolResult } from "./jobs";

const guidance = readFileSync(new URL("../prompts/goal.md", import.meta.url), "utf8").trim();
const continuation = readFileSync(new URL("../prompts/goal-continue.md", import.meta.url), "utf8").trim();
const goalSchema = Type.Object({
  objective: Type.String(),
  criteria: Type.Array(Type.String()),
  status: Type.Union(["active", "paused", "blocked", "completed", "budget_exceeded"].map((s) => Type.Literal(s))),
  tokensUsed: Type.Number(),
  tokenBudget: Type.Optional(Type.Number()),
  progress: Type.Array(Type.String()),
  evidence: Type.Optional(Type.String()),
  blocker: Type.Optional(Type.String()),
});
export type Goal = {
  objective: string;
  criteria: string[];
  status: "active" | "paused" | "blocked" | "completed" | "budget_exceeded";
  tokensUsed: number;
  tokenBudget?: number;
  progress: string[];
  evidence?: string;
  blocker?: string;
};

function parseGoal(args: string): Goal {
  const flags = [...args.matchAll(/(?:^|\s)--(\S+)/g)];
  const goal: Goal = {
    objective: args.slice(0, flags[0]?.index).trim(),
    criteria: [],
    status: "active",
    tokensUsed: 0,
    progress: [],
  };
  if (!goal.objective) throw new Error("Give a goal objective.");
  const seen = new Set<string>();
  for (const [index, flag] of flags.entries()) {
    const name = flag[1];
    const value = args
      .slice(flag.index + flag[0].length, flags[index + 1]?.index)
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2");
    if (seen.has(name)) throw new Error(`Repeated --${name} option.`);
    seen.add(name);
    if (name === "criteria")
      goal.criteria = value
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (name === "budget") {
      const match = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(value);
      const budget = match ? Number(match[1]) * ({ k: 1000, m: 1000000 }[match[2].toLowerCase()] ?? 1) : 0;
      if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error("Give a positive token budget, such as 2m.");
      goal.tokenBudget = budget;
    } else throw new Error(`Unknown goal option --${name}.`);
  }
  return goal;
}
const tokens = (n: number) =>
  n >= 1000000 ? `${+(n / 1000000).toFixed(1)}m` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${n}`;

const tokenStatus = (goal: Goal) =>
  `${tokens(goal.tokensUsed)} / ${goal.tokenBudget ? tokens(goal.tokenBudget) : "no limit"} tokens`;

export function registerGoal(pi: ExtensionAPI): void {
  let goal: Goal | undefined;
  let blocker: string | undefined;
  let repeated = 0;
  let reported: string | undefined;
  const reset = () => {
    blocker = undefined;
    repeated = 0;
    reported = undefined;
  };
  const status = (ctx: ExtensionContext) => {
    if (ctx.hasUI)
      ctx.ui.setStatus(
        "bruv-goal",
        goal
          ? `goal ${goal.status} ${tokens(goal.tokensUsed)}${goal.tokenBudget ? `/${tokens(goal.tokenBudget)}` : ""}`
          : undefined,
      );
  };
  const save = (ctx: ExtensionContext) => {
    pi.appendEntry("bruv-goal", goal ? structuredClone(goal) : null);
    status(ctx);
  };
  const budgetReached = (ctx: ExtensionContext) => {
    if (goal?.status !== "active" || goal.tokenBudget === undefined || goal.tokensUsed < goal.tokenBudget) return;
    goal.status = "budget_exceeded";
    ctx.ui.notify("Goal token budget reached.", "warning");
    return true;
  };
  const restore = (_event: unknown, ctx: ExtensionContext) => {
    const entry = ctx.sessionManager
      .getBranch()
      .reverse()
      .find((e) => e.type === "custom" && e.customType === "bruv-goal");
    goal = entry?.type === "custom" ? (structuredClone(entry.data as Goal | null) ?? undefined) : undefined;
    reset();
    status(ctx);
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("input", () => {
    reset();
  });
  pi.registerCommand("goal", {
    description: "Set, inspect, pause, resume, or clear a goal.",
    async handler(args, ctx) {
      const text = args.trim();
      if (!text) {
        const lines = goal
          ? [
              `Goal: ${goal.objective}`,
              `Status: ${goal.status} · ${tokenStatus(goal)}`,
              ...(goal.criteria.length ? [`Criteria: ${goal.criteria.join("; ")}`] : []),
              ...(goal.progress.length ? [`Last progress: ${goal.progress.at(-1)}`] : []),
              ...(goal.blocker ? [`Blocker: ${goal.blocker}`] : []),
            ]
          : ["No goal is set."];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }
      if (text === "clear") goal = undefined;
      else if (text === "pause" || text === "resume") {
        if (!goal) throw new Error("No goal is set.");
        goal.status = text === "pause" ? "paused" : "active";
        budgetReached(ctx);
      } else {
        if (goal && goal.status !== "completed") throw new Error("Clear the current goal before starting another.");
        goal = parseGoal(text);
      }
      reset();
      save(ctx);
      if (goal?.status === "active")
        pi.sendUserMessage(
          `${guidance}\n\nGoal: ${goal.objective}\nCriteria: ${goal.criteria.join("; ") || "None"}\nBudget: ${goal.tokenBudget ?? "No limit"} tokens`,
          { deliverAs: "steer" },
        );
    },
  });
  pi.registerTool({
    name: "goal_update",
    label: "Goal",
    description: "Record goal progress, a blocker, or completion with evidence.",
    exposure: "codemode",
    parameters: Type.Object({
      status: Type.Union([Type.Literal("active"), Type.Literal("blocked"), Type.Literal("completed")]),
      progress: Type.Optional(Type.String()),
      evidence: Type.Optional(Type.String()),
      blocker: Type.Optional(Type.String()),
    }),
    outputSchema: Type.Object({ goal: goalSchema }),
    async execute(_id, args, _signal, _update, ctx) {
      if (!goal) throw new Error("No goal is set.");
      if (goal.status !== "active") throw new Error("Use /goal resume before updating this goal.");
      if (args.status === "completed" && !args.evidence?.trim()) throw new Error("Completion requires evidence.");
      if (args.status === "blocked" && !args.blocker?.trim()) throw new Error("Describe the blocker.");
      if (args.progress?.trim() && !goal.progress.includes(args.progress.trim())) {
        goal.progress.push(args.progress.trim());
        reset();
      }
      if (args.status === "blocked") {
        reported = args.blocker?.trim();
        goal.blocker = reported;
      } else {
        reset();
        delete goal.blocker;
        goal.status = args.status;
      }
      if (args.evidence?.trim()) goal.evidence = args.evidence.trim();
      save(ctx);
      return toolResult({ goal: structuredClone(goal) });
    },
  });
  pi.on("message_end", (event, ctx) => {
    if (goal?.status !== "active" || event.message.role !== "assistant") return;
    goal.tokensUsed += event.message.usage.totalTokens;
    if (budgetReached(ctx)) save(ctx);
    else status(ctx);
  });
  pi.on("agent_settled", (_event, ctx) => {
    if (goal) save(ctx);
  });
  pi.on("agent_before_settle", (event, ctx) => {
    if (goal?.status !== "active") return {};
    if (event.outcome === "aborted") {
      goal.status = "paused";
      save(ctx);
      ctx.ui.notify("Goal paused. /goal resume continues it.", "info");
      return {};
    }
    if (event.continue || event.entries.length) return {};
    if (reported) {
      repeated = reported === blocker ? repeated + 1 : 1;
      blocker = reported;
      reported = undefined;
    } else reset();
    if (repeated >= 3) {
      goal.status = "blocked";
      save(ctx);
      return {};
    }
    return {
      entries: [
        {
          type: "custom_message" as const,
          customType: "bruv-goal",
          content: `${continuation}\n\nGoal: ${goal.objective} · ${tokenStatus(goal)} · Last progress: ${goal.progress.at(-1) ?? "None"}`,
          display: false,
        },
      ],
      continue: true,
    };
  });
}
