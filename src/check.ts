import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { StartAgents } from "./agents";
import { readConfig, saveConfig } from "./config";
import type { Jobs } from "./jobs";

const exec = promisify(execFile);
type Snapshot = { cwd: string; head: string; tree: string };
export type CheckReport = {
  asked: string;
  checked: string[];
  gaps: string[];
  failed: boolean;
  changes?: { files: number; added: number; removed: number };
};
type Verdict = { verdict: "pass" | "gaps"; checked: string[]; gaps: string[] };
export type Checker = ReturnType<typeof registerCheck>;

async function git(cwd: string, args: string[], signal?: AbortSignal, env = process.env) {
  return (await exec("git", args, { cwd, signal, env: { ...env, LC_ALL: "C" }, maxBuffer: 16 * 1024 * 1024 })).stdout;
}
async function snapshot(cwd: string, signal?: AbortSignal): Promise<Snapshot | undefined> {
  let root: string;
  try {
    root = (await git(cwd, ["rev-parse", "--show-toplevel"], signal)).trim();
  } catch (error) {
    if (String(error).includes("not a git repository")) return;
    throw error;
  }
  const head = (
    await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"], signal).catch((error) => {
      if (error.code === 1) return ""; // A new repository has no commits yet.
      throw error;
    })
  ).trim();
  const directory = join(root, ".tmp");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `bruv-check-index-${randomUUID()}`);
  const env = { ...process.env, GIT_INDEX_FILE: path };
  try {
    await git(root, ["read-tree", ...(head ? [head] : ["--empty"])], signal, env);
    await git(root, ["add", "-A", "--", ".", ":(exclude,glob)**/.tmp/**"], signal, env);
    return { cwd: root, head, tree: (await git(root, ["write-tree"], signal, env)).trim() };
  } finally {
    rmSync(path, { force: true });
    rmSync(`${path}.lock`, { force: true });
  }
}
function verdict(answer: string): Verdict {
  const block = [...answer.matchAll(/```json\s*\n([\s\S]*?)\n```/g)].at(-1);
  if (!block) throw new Error("Checker returned no JSON block.");
  const value = JSON.parse(block[1]);
  if (
    !value ||
    !["pass", "gaps"].includes(value.verdict) ||
    !Array.isArray(value.checked) ||
    !value.checked.every((s: unknown) => typeof s === "string") ||
    !Array.isArray(value.gaps) ||
    !value.gaps.every((s: unknown) => typeof s === "string") ||
    (value.verdict === "pass" ? value.gaps.length !== 0 : value.gaps.length === 0)
  )
    throw new Error("Checker returned an invalid verdict.");
  return value;
}

export function registerCheck(pi: ExtensionAPI, jobs: Jobs, start: StartAgents, agentDir = getAgentDir()) {
  let enabled = true;
  let running = false;
  let messages: string[] = [];
  let reply = "";
  let base: Snapshot | undefined;
  let snapshotError: unknown;
  let rounds = 0;
  let report: CheckReport | undefined;
  let accepted = false;
  const restore = () => {
    enabled = readConfig(agentDir).checkWork ?? true;
    running = false;
    report = undefined;
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("agent_settled", () => {
    running = false;
  });
  pi.on("message_start", async (event, ctx) => {
    if (event.message.role !== "user") return;
    if (!running) messages = [];
    running = true;
    messages.push(
      typeof event.message.content === "string"
        ? event.message.content
        : event.message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n"),
    );
    reply = "";
    rounds = 0;
    report = undefined;
    accepted = false;
    base = undefined;
    snapshotError = undefined;
    if (!enabled) return;
    try {
      base = await snapshot(ctx.cwd);
    } catch (error) {
      snapshotError = error;
      ctx.ui.notify(`Could not snapshot work: ${String(error)}`, "warning");
    }
  });
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant")
      reply = event.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
  });
  pi.registerCommand("check", {
    description: "Show or save whether a fresh agent checks finished work.",
    async handler(args, ctx) {
      const option = args.trim();
      if (option) {
        if (option !== "on" && option !== "off") throw new Error("Use /check on or off.");
        enabled = option === "on";
        saveConfig({ checkWork: enabled }, agentDir);
      }
      ctx.ui.notify(`Check work: ${enabled ? "on" : "off"}.`, "info");
    },
  });
  return {
    report: () => (accepted ? report : undefined),
    async run(ctx: ExtensionContext, signal?: AbortSignal) {
      if (!enabled) return;
      signal?.throwIfAborted();
      try {
        if (snapshotError) throw snapshotError;
        const current = base && (await snapshot(ctx.cwd, signal));
        if (!report && (!base || !current || (base.head === current.head && base.tree === current.tree))) return;
        report ??= { asked: messages[0]?.split(/\r?\n/)[0].slice(0, 70) ?? "", checked: [], gaps: [], failed: false };
        let diff = "";
        if (base && current) {
          const args = ["diff", "--no-ext-diff", "--no-textconv", base.tree, current.tree];
          const stat = await git(base.cwd, [...args, "--shortstat"], signal);
          report.changes = {
            files: Number(/(\d+) files? changed/.exec(stat)?.[1] ?? 0),
            added: Number(/(\d+) insertions?/.exec(stat)?.[1] ?? 0),
            removed: Number(/(\d+) deletions?/.exec(stat)?.[1] ?? 0),
          };
          diff = (await git(base.cwd, [...args, "--stat", "--patch"], signal)).slice(0, 40000);
        }
        if (rounds >= 2) {
          accepted = true;
          return;
        }
        rounds++;
        const [id] = start(
          {
            prompt: JSON.stringify({ messages, reply, diff }, null, 2),
            model: ctx.model && `${ctx.model.provider}/${ctx.model.id}`,
            thinking: pi.getThinkingLevel(),
            title: `check · ${report.asked}`,
          },
          ctx,
          true,
        );
        const item = jobs.get(id);
        item.seen = true;
        const abort = () => jobs.stop(id);
        signal?.addEventListener("abort", abort, { once: true });
        try {
          if (signal?.aborted) abort();
          await item.completion;
          signal?.throwIfAborted();
          if (item.status !== "done") throw new Error(`Checker ${item.status}: ${jobs.result(item).output}`);
          const result = verdict(item.answer ?? "");
          report.checked = result.checked;
          report.gaps = result.gaps;
          if (result.verdict === "gaps")
            return `A fresh check found gaps:\n${result.gaps.map((gap) => `- ${gap}`).join("\n")}\nFix them, then call finish again.`;
        } finally {
          signal?.removeEventListener("abort", abort);
        }
      } catch (error) {
        signal?.throwIfAborted();
        report ??= { asked: messages[0]?.split(/\r?\n/)[0].slice(0, 70) ?? "", checked: [], gaps: [], failed: false };
        report.failed = true;
        ctx.ui.notify(`Check didn't complete: ${String(error)}`, "warning");
      }
      accepted = true;
    },
  };
}
