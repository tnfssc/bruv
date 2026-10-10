import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { StartAgents } from "./agents";
import { type Jobs, toolResult, type Work } from "./jobs";
import { notify } from "./notify";

const exec = promisify(execFile);
const git = async (cwd: string, args: string[], env = process.env) =>
  (await exec("git", args, { cwd, env: { ...env, LC_ALL: "C" }, maxBuffer: 16 * 1024 * 1024 })).stdout;
async function withIndex<T>(cwd: string, task: (env: NodeJS.ProcessEnv) => Promise<T>) {
  const path = resolve(cwd, (await git(cwd, ["rev-parse", "--git-path", `bruv-race-index-${randomUUID()}`])).trim());
  const env = { ...process.env, GIT_INDEX_FILE: path };
  try {
    await git(cwd, ["read-tree", "HEAD"], env);
    await git(cwd, ["add", "-A"], env);
    return await task(env);
  } finally {
    rmSync(path, { force: true });
  }
}
export async function raceSnapshot(cwd: string) {
  return withIndex(cwd, async (env) => {
    const tree = (await git(cwd, ["write-tree"], env)).trim();
    return (await git(cwd, ["commit-tree", tree, "-p", "HEAD", "-m", "bruv race base"], env)).trim();
  });
}
type Row = { item: Work; files: number; added: number; removed: number; summary: string; seconds: number };
type Race = {
  id: string;
  cwd: string;
  snapshot: string;
  items: Work[];
  rows?: Row[];
  closed: boolean;
  applying: boolean;
};
const duration = (seconds: number) => `${Math.floor(seconds / 60)}m${seconds % 60}s`;
const changes = (row: Row) => `+${row.added} −${row.removed} · ${row.files} files`;
const option = (row: Row) => `${row.item.id} · ${changes(row)} · ${row.summary} · ${duration(row.seconds)}`;
// Agents save change totals before their completion promise resolves.
function scoreboard(race: Race): Row[] {
  return (
    race.rows ??
    race.items.map((item) => ({
      item,
      ...(item.changes ?? { files: 0, added: 0, removed: 0 }),
      summary:
        item.answer
          ?.trim()
          .split(/\n\s*\n/)
          .at(-1)
          ?.replace(/\s+/g, " ") || "No checks reported",
      seconds: Math.floor(((item.endedAt ?? Date.now()) - item.startedAt) / 1000),
    }))
  );
}
function report(race: Race, rows: Row[]) {
  const running = race.items.some((item) => item.status === "running");
  const summary = rows
    .map((row) => {
      const checks = row.summary.length > 60 ? `${row.summary.slice(0, 59)}…` : row.summary;
      return `${row.item.id} ${row.item.status} +${row.added} −${row.removed} · ${checks} · ${duration(row.seconds)}`;
    })
    .join(" | ");
  return [
    `Race ${race.id} ${running ? "running" : "done"}: ${summary}${running ? "" : " — pick one below"}`,
    ...rows.map(
      (row) =>
        `${row.item.id.padEnd(4)} ${row.item.status.padEnd(7)} ${changes(row).padEnd(25)} ${duration(row.seconds).padEnd(8)} $${(row.item.usage?.cost ?? 0).toFixed(2)} · ${row.summary}`,
    ),
  ].join("\n");
}
async function apply(race: Race, item: Work) {
  const path = item.worktree?.path;
  if (!path) throw new Error(`${item.id} has no worktree to apply.`);
  await git(path, ["add", "-A"]);
  await git(path, ["-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "bruv race result"]);
  const patch = await git(path, ["diff", "--no-ext-diff", "--no-textconv", "--binary", race.snapshot, "HEAD"]);
  if (!patch) return;
  await withIndex(race.cwd, async (env) => {
    const result = exec("git", ["apply", "--3way"], { cwd: race.cwd, env });
    result.child.stdin?.end(patch);
    try {
      await result;
    } catch (error) {
      const conflicts = (await git(race.cwd, ["diff", "--name-only", "--diff-filter=U"], env)).trim();
      const detail = conflicts || (error as { stderr?: string }).stderr || String(error);
      throw new Error(
        `Could not apply ${item.id}. Conflicts or errors:\n${detail}\nKept all race worktrees, including ${path}. Resolve any conflict markers before trying again.`,
      );
    }
  });
}
async function remove(race: Race) {
  let count = 0;
  for (const item of race.items) {
    if (!item.worktree) continue;
    await git(race.cwd, ["worktree", "remove", "--force", item.worktree.path]);
    await git(race.cwd, ["branch", "-D", "--", item.worktree.branch]);
    item.worktree = undefined;
    count++;
  }
  race.closed = true;
  return count;
}

export function registerRace(pi: ExtensionAPI, jobs: Jobs, startAgents: StartAgents) {
  if (process.env.BRUV_DEPTH) return;
  let current: Race | undefined;
  let next = 0;
  let starting = false;
  let active = true;
  const tell = (content: string) =>
    pi.sendMessage({ customType: "bruv-report", content, display: true }, { triggerTurn: false });
  const pick = async (race: Race, id: string, ctx: ExtensionContext) => {
    if (race.closed || race.applying) return;
    if (race.items.some((item) => item.status === "running"))
      throw new Error("Wait for the race to finish before picking.");
    race.applying = true;
    try {
      if (id !== "none") {
        const item = race.items.find((item) => item.id === id);
        if (!item) throw new Error(`Agent ${id} is not in race ${race.id}.`);
        await apply(race, item);
      }
      const count = await remove(race);
      tell(`${id === "none" ? "Kept none. " : ""}Removed ${count} race worktrees.`);
      if (id !== "none")
        pi.sendMessage(
          {
            customType: "bruv-report",
            content: `Applied ${id}'s changes. Run this project's checks here and fix anything they break.`,
            display: true,
          },
          ctx.mode === "tui" ? { triggerTurn: true } : { deliverAs: "nextTurn" },
        );
    } finally {
      race.applying = false;
    }
  };
  const choose = async (race: Race, ctx: ExtensionContext) => {
    if (!active || !ctx.hasUI || race.closed || race.applying) return;
    const sessionId = ctx.sessionManager.getSessionId();
    const rows = scoreboard(race);
    const options = [...rows.map(option), "Keep none"];
    const selected = await ctx.ui.select(`Race ${race.id}: pick a result`, options);
    if (!active || current !== race || ctx.sessionManager.getSessionId() !== sessionId || selected === undefined)
      return;
    await pick(race, selected === "Keep none" ? "none" : rows[options.indexOf(selected)].item.id, ctx);
  };
  const start = async (task: string, n: number, ctx: ExtensionContext, signal?: AbortSignal) => {
    if (starting || (current && !current.closed))
      throw new Error("Pick a result or keep none before starting another race.");
    if (!task.trim() || !Number.isInteger(n) || n < 2 || n > 5)
      throw new Error("Give a task and 2–5 agents, such as /race --n 3 Fix the tests.");
    starting = true;
    try {
      const cwd = (await git(ctx.cwd, ["rev-parse", "--show-toplevel"])).trim();
      const snapshot = await raceSnapshot(cwd);
      signal?.throwIfAborted();
      const id = `r${++next}`;
      const prompt = `${task}\n\nWork only in this worktree. When done, run the project's checks and say whether they pass. Do not merge anything.`;
      const title = task.replace(/\s+/g, " ").slice(0, 50);
      const ids = Array.from(
        { length: n },
        (_, index) =>
          startAgents(
            { prompt, title: `${id} #${index + 1} · ${title}`, worktree: { baseRef: snapshot } },
            { ...ctx, cwd },
          )[0],
      );
      const race: Race = { id, cwd, snapshot, items: ids.map((id) => jobs.get(id)), closed: false, applying: false };
      current = race;
      tell(`Race ${id}: ${n} agents started from your current changes`);
      const sessionId = ctx.sessionManager.getSessionId();
      void Promise.all(race.items.map((item) => item.completion))
        .then(async () => {
          if (
            !active ||
            current !== race ||
            race.closed ||
            race.applying ||
            ctx.sessionManager.getSessionId() !== sessionId
          )
            return;
          race.rows = scoreboard(race);
          tell(`${report(race, race.rows)}\nPick with /race pick <agent id>, or /race pick none.`);
          notify(ctx, `Race ${race.id} is ready to pick`);
          await choose(race, ctx);
        })
        .catch((error: unknown) => ctx.ui.notify(String(error), "error"));
      return { id, ids };
    } finally {
      starting = false;
    }
  };
  pi.on("session_start", () => {
    current = undefined;
    active = true;
  });
  pi.on("session_shutdown", async () => {
    active = false;
    // Shutdown stops the agents, so an unpicked race can't finish. Leave nothing behind.
    const race = current;
    if (!race || race.closed || race.applying) return;
    await Promise.all(race.items.map((item) => item.completion));
    await remove(race);
  });
  pi.registerTool({
    name: "race",
    label: "Race",
    exposure: "codemode",
    description:
      "Start competing agents from the user's current changes. Wait for their IDs, then let the user pick a result.",
    parameters: Type.Object({
      task: Type.String({ minLength: 1 }),
      n: Type.Optional(Type.Integer({ minimum: 2, maximum: 5, default: 3 })),
    }),
    outputSchema: Type.Object({ id: Type.String(), ids: Type.Array(Type.String()) }),
    async execute(_id, args, signal, _update, ctx) {
      return toolResult(await start(args.task, args.n ?? 3, ctx, signal));
    },
  });
  pi.registerCommand("race", {
    description: "Race agents on a task, see results, or pick a winner.",
    async handler(args, ctx) {
      const text = args.trim();
      if (text === "pick") throw new Error("Use /race pick <agent id> or /race pick none.");
      if (!text || text.startsWith("pick ")) {
        if (!current) {
          ctx.ui.notify("No race in this session.", "info");
          return;
        }
        if (text) await pick(current, text.slice(5).trim(), ctx);
        else {
          if (current.closed || current.applying) {
            ctx.ui.notify(`Race ${current.id}: ${current.closed ? "finished" : "applying a result"}.`, "info");
            return;
          }
          const rows = scoreboard(current);
          ctx.ui.notify(report(current, rows), "info");
        }
        return;
      }
      const flags = [...text.matchAll(/(?:^|\s)--n(?:\s+(\S+))?/g)];
      if (flags.length > 1) throw new Error("Use --n once.");
      const task = text.replace(/(?:^|\s)--n(?:\s+\S+)?/g, " ").trim();
      await start(task, flags.length ? Number(flags[0][1]) : 3, ctx);
    },
  });
}
