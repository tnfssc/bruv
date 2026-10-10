import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { type Config, readConfig } from "./config";
import { type Jobs, toolResult, type Work, workDirectory } from "./jobs";
import { createWorktree, worktreeChanges } from "./worktree";

export function resolveProfile(
  config: Config,
  profile: "fast" | "normal",
  parent: { model?: string; thinking?: string },
  overrides: { model?: string; thinking?: string },
) {
  const chosen = config.profiles?.[profile];
  return {
    model: overrides.model ?? chosen?.model ?? parent.model,
    thinking: overrides.thinking ?? chosen?.thinking ?? parent.thinking,
  };
}

export function agentParser(jobs: Jobs, item: Work) {
  let buffer = "";
  let failed = false;
  item.answer = "";
  const usage = { input: 0, output: 0, cost: 0 };
  item.usage = usage;
  const event = (line: string) => {
    if (!line.trim()) return;
    const value = JSON.parse(line) as JsonAgentSessionEvent | { type: "session" };
    if (value.type === "tool_execution_start") item.progress = value.toolName;
    if (value.type === "tool_execution_end") item.progress = undefined;
    if (value.type === "message_update")
      item.tokens = usage.input + usage.output + value.usage.input + value.usage.output;
    if (value.type === "message_end" && value.message.role === "assistant") {
      const message = value.message;
      item.answer = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      usage.input += message.usage.input;
      usage.output += message.usage.output;
      usage.cost += message.usage.cost.total;
      item.tokens = usage.input + usage.output;
      failed ||= message.stopReason === "error" || message.stopReason === "aborted";
      if (message.errorMessage) jobs.append(item, `\n${message.errorMessage}\n`);
    }
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let end = buffer.indexOf("\n");
      while (end >= 0) {
        event(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        end = buffer.indexOf("\n");
      }
    },
    finish() {
      if (buffer) event(buffer);
      return failed;
    },
  };
}

const parameters = Type.Object({
  prompt: Type.Optional(Type.String()),
  prompts: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
  profile: Type.Optional(Type.Union([Type.Literal("fast"), Type.Literal("normal")], { default: "normal" })),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  worktree: Type.Optional(
    Type.Union([
      Type.Boolean(),
      Type.Object({ branch: Type.Optional(Type.String()), baseRef: Type.Optional(Type.String()) }),
    ]),
  ),
});
export type StartAgents = (args: Static<typeof parameters>, ctx: ExtensionContext) => string[];

export function registerAgents(pi: ExtensionAPI, jobs: Jobs, isFast: () => boolean = () => false): StartAgents {
  const start: StartAgents = (args, ctx) => {
    if ((args.prompt === undefined) === (args.prompts === undefined)) throw new Error("Give prompt or prompts");
    const prompts = args.prompt !== undefined ? [args.prompt] : (args.prompts ?? []);
    const profile = args.profile ?? "normal";
    const selected = resolveProfile(
      readConfig(),
      profile,
      { model: ctx.model && `${ctx.model.provider}/${ctx.model.id}`, thinking: pi.getThinkingLevel() },
      args,
    );
    const directory = workDirectory(ctx);
    const sessions = join(directory, "agents");
    mkdirSync(sessions, { recursive: true });
    const promptPath = fileURLToPath(new URL(`../prompts/agent-${profile}.md`, import.meta.url));
    const ids = prompts.map((prompt, index) => {
      const item = jobs.create(
        "agent",
        args.title ? (prompts.length > 1 ? `${args.title} ${index + 1}` : args.title) : prompt.slice(0, 100),
        directory,
      );
      const sessionPath = join(sessions, `${item.id}.jsonl`);
      item.sessionPath = sessionPath;
      const parser = agentParser(jobs, item);
      void jobs.run(item, async () => {
        try {
          let cwd = ctx.cwd;
          if (args.worktree) {
            const options = typeof args.worktree === "object" ? { ...args.worktree } : {};
            if (options.branch && prompts.length > 1) options.branch += `-${index + 1}`;
            cwd = (await createWorktree(jobs, item, cwd, ctx.sessionManager.getSessionId(), options)).path;
          }
          const command = ["--mode", "json", "--session", sessionPath, "--append-system-prompt", promptPath];
          if (selected.model) command.push("--model", selected.model);
          if (selected.thinking) command.push("--thinking", selected.thinking);
          command.push("--", prompt);
          const code = await jobs.process(item, process.env.BRUV_PI_COMMAND ?? "pi", command, cwd, {
            env: { ...process.env, BRUV_DEPTH: "1", BRUV_FAST: isFast() ? "1" : undefined },
            stdout: parser.push,
          });
          return parser.finish() ? 1 : code;
        } finally {
          if (item.worktree) {
            try {
              item.changes = await worktreeChanges(item.worktree.path, item.base as string);
            } catch (error) {
              jobs.append(item, `\nCould not count changes: ${String(error)}\n`);
            }
          }
        }
      });
      return item.id;
    });

    return ids;
  };
  if (!process.env.BRUV_DEPTH)
    pi.registerTool({
      name: "agent",
      label: "Agent",
      description: "Start one or more agents, optionally in separate worktrees.",
      exposure: "codemode",
      parameters,
      outputSchema: Type.Object({ ids: Type.Array(Type.String()) }),
      async execute(_id, args, _signal, _update, ctx) {
        return toolResult({ ids: start(args, ctx) });
      },
    });
  return start;
}
