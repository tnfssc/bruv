import { showTool } from "./lines";

/** Words for the tools a person would care to see being used. */
const doing: Record<string, string> = {
  overview: "Looking at your T3 work",
  read: "Reading its notes",
  write: "Updating its notes",
  edit: "Updating its notes",
  approve: "Answering the thread",
  [showTool]: "Getting it to show you",
  mcp__t3__t3_thread_launch: "Starting a thread",
  mcp__t3__t3_thread_send: "Messaging a thread",
  mcp__t3__t3_thread_read: "Reading a thread",
  mcp__t3__t3_thread_list: "Looking at threads",
  mcp__t3__t3_project_list: "Looking at your projects",
  mcp__t3__t3_thread_interrupt: "Stopping a thread",
  mcp__t3__t3_pending_request_respond: "Answering the thread",
};

/**
 * Words for what a tool call is doing, or nothing for ones not worth showing. A codemode script says what
 * it does in its opening comment; without one, the first tool it calls does.
 */
export function step(tool: string, args: { code?: unknown } | undefined) {
  if (tool === "codemode") {
    const code = typeof args?.code === "string" ? args.code : "";
    const comment = /^\s*\/\/\s*(.+)$/m.exec(code.trimStart().split("\n")[0] ?? "")?.[1]?.trim();
    if (comment) return comment.slice(0, 120);
    const first = /tools\.([A-Za-z0-9_]+)\s*\(/.exec(code)?.[1];
    return (first && doing[first]) ?? (first?.startsWith("mcp__t3__") ? "Talking to T3" : "Working it out");
  }
  return doing[tool] ?? (tool.startsWith("mcp__t3__") ? "Talking to T3" : undefined);
}
