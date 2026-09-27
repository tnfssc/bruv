import { expect, test } from "bun:test";
import remoteExtension, { parseRemoteLaunch } from "../src/remote/extension";

test("remote is active in the normal core tool set and human output persists in conversation", async () => {
  let active = ["execute"];
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const messages: any[] = [];
  const tools: any[] = [];
  const pi = {
    on: (name: string, fn: Function) => handlers.set(name, fn),
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => {
      active = names;
    },
    registerTool: (tool: any) => tools.push(tool),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    sendMessage: (message: any) => messages.push(message),
  };
  remoteExtension(pi as any, { status: async () => ({ tasks: {} }) } as any);
  await handlers.get("session_start")!();
  expect(active).toEqual(["execute", "remote"]);
  expect(tools.map((t) => t.name)).toEqual(["remote"]);
  await commands.get("remote").handler("status", {});
  expect(messages[0].display).toBe(true);
  expect(JSON.parse(messages[0].content)).toMatchObject({ cached: true, tasks: [] });
  expect(tools[0].description).toContain("SAME taskId");
});

test("remote launch preserves raw prompt and quoted repository paths", () => {
  expect(parseRemoteLaunch('launch "/repo with spaces" first  line\n  second line  ')).toEqual({
    repoPath: "/repo with spaces",
    prompt: "first  line\n  second line  ",
  });
  expect(() => parseRemoteLaunch('launch "/broken prompt')).toThrow("Unclosed");
  expect(() => parseRemoteLaunch("launch /repo ")).toThrow("Usage");
});
test("accepted retry syncs; uncertain retry retains same launch ID", async () => {
  let command: any;
  const calls: string[] = [];
  let outcome = "accepted";
  const task = { taskId: "id", repoPath: "/repo", prompt: "prompt", events: [] };
  const messages: any[] = [];
  const pi = {
    on() {},
    registerTool() {},
    registerCommand(_n: string, c: any) {
      command = c;
    },
    sendMessage(m: any) {
      messages.push(m);
    },
  };
  const client = {
    transcript: async () => ({ ...task, outcome }),
    sync: async (id: string) => {
      calls.push("sync:" + id);
      return task;
    },
    launch: async (_r: string, _p: string, id: string) => {
      calls.push("launch:" + id);
      return task;
    },
    connect: async () => ({}),
  };
  remoteExtension(pi as any, client as any);
  await command.handler("retry id", {});
  outcome = "unknown";
  await command.handler("retry id", {});
  expect(calls).toEqual(["sync:id", "launch:id"]);
  await command.handler("connect host", {});
  expect(messages.at(-1).content).toContain("shared across");
});
