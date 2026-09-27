import { expect, test } from "bun:test";
import remoteExtension from "../src/remote/extension";

test("remote is active in the normal core tool set and human output persists in conversation", async () => {
  let active = ["execute"];
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const messages: any[] = [];
  const tools: any[] = [];
  const pi = { on: (name: string, fn: Function) => handlers.set(name, fn), getActiveTools: () => active,
    setActiveTools: (names: string[]) => { active = names; }, registerTool: (tool: any) => tools.push(tool),
    registerCommand: (name: string, command: any) => commands.set(name, command), sendMessage: (message: any) => messages.push(message) };
  remoteExtension(pi as any, { status: async () => ({ tasks: {} }) } as any);
  await handlers.get("session_start")!();
  expect(active).toEqual(["execute", "remote"]);
  expect(tools.map(t => t.name)).toEqual(["remote"]);
  await commands.get("remote").handler("status", {});
  expect(messages[0].display).toBe(true);
  expect(JSON.parse(messages[0].content)).toMatchObject({ cached: true, tasks: [] });
  expect(tools[0].description).toContain("SAME taskId");
});
