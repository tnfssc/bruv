import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { type Config, readConfig, saveConfig } from "./config";
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

const ref = (model: { provider: string; id: string }) => `${model.provider}/${model.id}`;

/** Models agents may use: the ones picked with /subagents, else the main model and the profile models. Signed-in only. */
export function agentModels(ctx: ExtensionContext, config = readConfig()) {
  const main = ctx.model && ref(ctx.model);
  const wanted = new Set(config.agentModels ?? [config.profiles?.fast?.model, config.profiles?.normal?.model]);
  const others = ctx.modelRegistry.getAvailable().filter((model) => ref(model) !== main && wanted.has(ref(model)));
  // The main model is always allowed: agents default to it.
  return [...(ctx.model ? [ctx.model] : []), ...others];
}

function describeModels(ctx: ExtensionContext) {
  const main = ctx.model && ref(ctx.model);
  const lines = agentModels(ctx).map((model) => {
    const price =
      model.cost.input || model.cost.output
        ? ` · $${model.cost.input}/$${model.cost.output} per million tokens in/out`
        : "";
    return `- ${ref(model)}${ref(model) === main ? " (yours, the default)" : ""}${price} · ${Math.round(model.contextWindow / 1000)}k context`;
  });
  if (lines.length < 2) return undefined;
  return `Agents can use these models; pass one as model to tools.agent:\n${lines.join("\n")}\nUse a cheaper one for searching, reading and lookups, and yours for building and hard problems.`;
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
      // The answer is the last reply with words in it; a closing finish call carries only a note.
      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      const finish = message.content.find((block) => block.type === "toolCall" && block.name === "finish");
      const note =
        finish?.type === "toolCall" && typeof finish.arguments.note === "string" ? finish.arguments.note : "";
      if (text) item.answer = text;
      else if (note && !item.answer) item.answer = note;
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
export type StartAgents = (args: Static<typeof parameters>, ctx: ExtensionContext, checker?: boolean) => string[];

export function registerAgents(pi: ExtensionAPI, jobs: Jobs, isFast: () => boolean = () => false): StartAgents {
  const start: StartAgents = (args, ctx, checker = false) => {
    if ((args.prompt === undefined) === (args.prompts === undefined)) throw new Error("Give prompt or prompts");
    const prompts = args.prompt !== undefined ? [args.prompt] : (args.prompts ?? []);
    const profile = args.profile ?? "normal";
    if (!checker && args.model) {
      const allowed = agentModels(ctx).map(ref);
      if (!allowed.includes(args.model))
        throw new Error(`Agents can use ${allowed.join(", ")}. The user picks this list with /subagents.`);
    }
    const selected = resolveProfile(
      readConfig(),
      profile,
      { model: ctx.model && `${ctx.model.provider}/${ctx.model.id}`, thinking: pi.getThinkingLevel() },
      args,
    );
    const directory = workDirectory(ctx);
    const sessions = join(directory, "agents");
    mkdirSync(sessions, { recursive: true });
    const promptPath = fileURLToPath(
      new URL(checker ? "../prompts/checker.md" : `../prompts/agent-${profile}.md`, import.meta.url),
    );
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
          const command = ["--mode", "json", "--session", sessionPath];
          if (checker)
            command.push(
              "--system-prompt",
              promptPath,
              "--append-system-prompt",
              "",
              "--no-extensions",
              "--no-skills",
              "--no-context-files",
              "--no-prompt-templates",
              "--no-mcp",
              "--tools",
              "read,bash,grep,find,ls",
            );
          else command.push("--append-system-prompt", promptPath);
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
  if (!process.env.BRUV_DEPTH) {
    // Listed once per session so the prompt stays the same between turns.
    let models: string | undefined;
    pi.on("session_start", (_event, ctx) => {
      models = describeModels(ctx);
    });
    pi.on("before_agent_start", (event) => {
      if (models) event.systemPromptOptions.sections.agent_models = models;
    });
    pi.registerCommand("subagents", {
      description: "Choose which models agents may use",
      handler: async (_args, ctx) => {
        const main = ctx.model && ref(ctx.model);
        const available = [
          ...(ctx.model ? [ctx.model] : []),
          ...ctx.modelRegistry.getAvailable().filter((model) => ref(model) !== main),
        ];
        const chosen = new Set(agentModels(ctx).map(ref));
        const save = "Save";
        for (;;) {
          const options = available.map((model) => `${chosen.has(ref(model)) ? "✓" : " "} ${ref(model)}`);
          const picked = await ctx.ui.select("Models agents may use (pick to switch, then Save)", [save, ...options]);
          if (picked === undefined) return;
          if (picked === save) break;
          const name = picked.slice(2);
          if (!chosen.delete(name)) chosen.add(name);
        }
        saveConfig({ agentModels: [...chosen] });
        models = describeModels(ctx);
        ctx.ui.notify(`Agents may use: ${agentModels(ctx).map(ref).join(", ")}.`, "info");
      },
    });
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
  }
  return start;
}
