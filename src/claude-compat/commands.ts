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
  /** Native ownership may remain running between provider requests. */
  isRunning?(): boolean;
  humanControls?: Pick<ReturnType<typeof createClaudeCompatHumanControls>, "openQuestion"> &
    Partial<Pick<ReturnType<typeof createClaudeCompatHumanControls>, "questions">>;
}
const extensionNames = ["goal", "questions", "mode", "live"] as const;
const commandAliases = [
  {
    name: "goal",
    description: "Start or resume a goal; during work use /bruv goal status|pause",
    argumentHint: "objective|status|pause|resume|budget|clear|help",
  },
  {
    name: "questions",
    description: "List, inspect, answer, cancel or resume saved questions",
    argumentHint: "list|detail|answer|cancel|resume|open",
  },
  {
    name: "mode",
    description: "Show or switch main-agent instruction mode",
    argumentHint: "fast|normal|orchestrator",
  },
] as const;

/** Call dispatchUserCommand ONLY at the validated native user-frame admission seam.
 * Do not register this as a model tool or reinterpret assistant/worker text as commands.
 * Unrecognized input remains unchanged for the existing Pi prompt path.
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
      ...commandAliases.filter(({ name }) => !!session.extensionRunner.getCommand(name)),
      {
        name: "bruv",
        description: `Bruv human controls (${available().join(", ")})`,
        argumentHint: available().join("|"),
      },
      ...available().map((name) => ({
        name: `bruv:${name}`,
        description: `Bruv ${name}`,
        argumentHint: commandAliases.find((command) => command.name === name)?.argumentHint ?? "",
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
          " · In T3, /bruv goal status|pause works during a turn; bare /goal commands must wait until idle. /questions open <id> reopens a saved native question. /bruv live capabilities reports available host audio. Terminal-only dialogs require the Bruv CLI.",
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
            running: options.isRunning?.() ?? session.isStreaming,
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
      if (!id || extra.length) throw new Error("Usage: /bruv questions open <id>");
      if (!options.humanControls)
        throw new Error("Native question dialog is unavailable; use /bruv questions detail or answer");
      const question = await options.humanControls.openQuestion(await resolveQuestionId(id));
      await options.notify(`${question.id} [${question.status}] ${question.text}`, "info");
      return true;
    }
    await runExtensionCommand(name, value);
    return true;
  }

  async function resolveQuestionId(id: string): Promise<string> {
    const port = options.humanControls?.questions?.();
    if (!port || id.length < 8) return id;
    const rows = await port.handle("questions.list", {});
    if (!Array.isArray(rows)) return id;
    const matches = rows.flatMap((row: unknown) =>
      row && typeof row === "object" && "id" in row && typeof row.id === "string" && row.id.startsWith(id)
        ? [row.id]
        : [],
    );
    if (matches.includes(id)) return id;
    if (matches.length > 1) throw new Error("Question ID is ambiguous; use more characters from /questions.");
    return matches[0] ?? id;
  }

  async function runExtensionCommand(name: string, value: string): Promise<void> {
    const command = session.extensionRunner.getCommand(name);
    if (!command) throw new Error(`Unavailable Bruv command: ${name}`);
    const context = session.extensionRunner.createCommandContext();
    // Keep real command/session methods and mode. Only project notifications;
    // never claim hasUI or substitute fabricated modal/editor interactions.
    let notifications = Promise.resolve();
    const notify: ExtensionCommandContext["ui"]["notify"] = (text, level = "info") => {
      notifications = notifications.then(() => options.notify(text, level));
    };
    const ui: ExtensionCommandContext["ui"] = Object.defineProperties(
      Object.create(Object.getPrototypeOf(context.ui)),
      {
        ...Object.getOwnPropertyDescriptors(context.ui),
        notify: { value: notify, enumerable: true, configurable: true },
      },
    );
    // Pi guards live session/model getters against reloads. Spreading context
    // would eagerly snapshot those getters and bypass their stale-owner checks.
    const commandContext: ExtensionCommandContext = Object.defineProperties(
      Object.create(Object.getPrototypeOf(context)),
      {
        ...Object.getOwnPropertyDescriptors(context),
        ui: { value: ui, enumerable: true, configurable: true },
      },
    );
    try {
      await command.handler(value, commandContext);
    } finally {
      // A throwing handler can already have queued notices. Keep them ordered
      // within this command before its failure is returned to the native owner.
      await notifications;
    }
  }

  return {
    catalog,
    dispatchUserCommand,
    readUserCommand: (message: UserMessage) => readHumanCommand(message, session.sessionId),
  };
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
  const aliasMatch = /^\/(goal|questions|mode)(?:\s+([\s\S]*))?$/.exec(text.trim());
  const match = /^\/bruv(?::([a-z]+))?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match && !aliasMatch) {
    if (/^\/bruv(?=[:\s]|$)/.test(text.trim())) throw new Error("Invalid Bruv command syntax; use /bruv help");
    return null;
  }
  if (message.session_id && message.session_id !== sessionId) throw new Error("Human command session mismatch");
  if (message.parent_tool_use_id != null) throw new Error("Human commands belong to the root session");
  if (
    Array.isArray(content) &&
    content.some(
      (block) =>
        typeof block !== "object" ||
        block === null ||
        !("type" in block) ||
        block.type !== "text" ||
        !("text" in block) ||
        typeof block.text !== "string",
    )
  )
    throw new Error("Bruv commands accept text only; send attachments in a separate prompt");
  if (aliasMatch) return { name: aliasMatch[1], value: (aliasMatch[2] ?? "").trim() };
  if (!match) return null;
  const args = (match[2] ?? "").trim();
  if (match[1]) return { name: match[1], value: args };
  const parts = /^(\S+)(?:\s+([\s\S]*))?$/.exec(args);
  return { name: parts?.[1] || "help", value: parts?.[2] ?? "" };
}
