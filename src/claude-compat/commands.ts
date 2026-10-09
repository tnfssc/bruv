import type { AgentSession, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { UserMessage } from "./transport";
import type { createClaudeCompatHumanControls } from "./human-controls";

export interface ClaudeCompatCommandOptions {
  session: Pick<
    AgentSession,
    "extensionRunner" | "getSessionStats" | "sessionId" | "model" | "isStreaming" | "resourceLoader"
  >;
  /** Render a human operation's output, never ask the model to invent its result. */
  notify(text: string, level: "info" | "warning" | "error"): void | Promise<void>;
  humanControls?: Pick<ReturnType<typeof createClaudeCompatHumanControls>, "openQuestion">;
}
const extensionNames = ["goal", "questions", "mode", "live"] as const;

/** Call dispatchUserCommand ONLY at the validated native user-frame admission seam.
 * Do not register this as a model tool or reinterpret assistant/worker text as commands.
 * Non-namespaced input remains unchanged for the existing Pi prompt path.
 */
export function createClaudeCompatCommands(options: ClaudeCompatCommandOptions) {
  const session = options.session;
  const available = () => [
    ...extensionNames.filter((name) => !!session.extensionRunner.getCommand(name)),
    "status",
    "resources",
  ];
  function catalog() {
    return [
      {
        name: "bruv",
        description: `Bruv human controls (${available().join(", ")})`,
        argumentHint: available().join("|"),
      },
      ...available().map((name) => ({
        name: `bruv:${name}`,
        description: `Bruv ${name}`,
        argumentHint: name === "questions" ? "list|detail|answer|cancel|resume|open" : "",
      })),
    ];
  }
  async function dispatchUserCommand(message: UserMessage): Promise<boolean> {
    const input = readHumanCommand(message, session.sessionId);
    if (!input) return false;
    const { name, value } = input;
    if (name === "help") {
      await options.notify(
        "/bruv " +
          available().join(" | ") +
          " · /bruv questions open <id> reopens the saved native question. TUI pickers, audio and resume-return dialogs are not available here.",
        "info",
      );
      return true;
    }
    if (!available().includes(name)) throw new Error(`Unavailable Bruv command: ${name}`);
    if (name === "status") {
      if (value) throw new Error("Usage: /bruv status");
      await options.notify(
        JSON.stringify(
          {
            sessionId: session.sessionId,
            running: session.isStreaming,
            model: session.model ? `${session.model.provider}/${session.model.id}` : null,
            stats: session.getSessionStats(),
          },
          null,
          2,
        ),
        "info",
      );
      return true;
    }
    if (name === "resources") {
      if (value) throw new Error("Usage: /bruv resources");
      const loader = session.resourceLoader;
      await options.notify(
        JSON.stringify(
          {
            skills: loader.getSkills().skills.map((skill) => ({ name: skill.name, path: skill.filePath })),
            prompts: loader.getPrompts().prompts.map((prompt) => ({ name: prompt.name, path: prompt.filePath })),
            contextFiles: loader.getAgentsFiles().agentsFiles.map((file) => file.path),
            commands: session.extensionRunner.getRegisteredCommands().map((command) => command.invocationName),
          },
          null,
          2,
        ),
        "info",
      );
      return true;
    }
    if (name === "questions" && /^open(?:\s|$)/.test(value)) {
      const [, id, ...extra] = value.split(/\s+/);
      if (!id || extra.length) throw new Error("Usage: /bruv questions open <full-id>");
      if (!options.humanControls)
        throw new Error("Native question dialog is unavailable; use /bruv questions detail or answer");
      const question = await options.humanControls.openQuestion(id);
      await options.notify(`${question.id} [${question.status}] ${question.text}`, "info");
      return true;
    }
    await runExtensionCommand(name, value);
    return true;
  }

  async function runExtensionCommand(name: string, value: string): Promise<void> {
    const command = session.extensionRunner.getCommand(name);
    if (!command) throw new Error(`Unavailable Bruv command: ${name}`);
    const context = session.extensionRunner.createCommandContext();
    // Keep real command/session methods and mode. Only project notifications;
    // never claim hasUI or substitute fabricated modal/editor interactions.
    let notifications = Promise.resolve();
    const ui: ExtensionCommandContext["ui"] = {
      ...context.ui,
      notify(text, level = "info") {
        notifications = notifications.then(() => options.notify(text, level));
      },
    };
    await command.handler(value, { ...context, ui });
    await notifications;
  }

  return { catalog, dispatchUserCommand };
}

/** Recognize and admit a root human command before any command effects. */
function readHumanCommand(message: UserMessage, sessionId: string): { name: string; value: string } | null {
  if (message.type !== "user" || message.message.role !== "user") return null;
  const content = message.message.content;
  const text =
    typeof content === "string"
      ? content
      : content
          .flatMap((block) => {
            if (
              typeof block === "object" &&
              block !== null &&
              "type" in block &&
              block.type === "text" &&
              "text" in block &&
              typeof block.text === "string"
            )
              return [block.text];
            return [];
          })
          .join("\n");
  const match = /^\/bruv(?::([a-z]+))?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) {
    if (/^\/bruv(?=[:\s]|$)/.test(text.trim())) throw new Error("Invalid Bruv command syntax; use /bruv help");
    return null;
  }
  if (message.session_id && message.session_id !== sessionId) throw new Error("Human command session mismatch");
  if (message.parent_tool_use_id != null) throw new Error("Human commands belong to the root session");
  if (
    Array.isArray(content) &&
    content.some((block) => typeof block !== "object" || block === null || !("type" in block) || block.type !== "text")
  )
    throw new Error("Bruv commands accept text only; send attachments in a separate prompt");
  const args = (match[2] ?? "").trim();
  if (match[1]) return { name: match[1], value: args };
  const [name, ...tail] = args.split(/\s+/);
  return { name: name || "help", value: tail.join(" ") };
}
