import { expect, test } from "bun:test";
import remoteExtension from "../src/remote/extension";
import {
  inboxItems,
  remoteCompletions,
  remoteMenuStatus,
  remoteErrorHint,
  taskActions,
  untrackedApprovalText,
} from "../src/remote/menu";
import { renderHuman, remoteStatus } from "../src/remote/human-rendering";
import type { RemoteState } from "../src/remote/client";

const empty: RemoteState = { tasks: {} };
const connected = {
  tasks: {},
  connection: { host: "sandbox", diePath: "die", hello: { ownerId: "owner", epoch: "epoch" } },
} as RemoteState;
function harness(client: any) {
  let command: any;
  const messages: any[] = [],
    handlers = new Map<string, Function>();
  remoteExtension(
    {
      on: (name: string, fn: Function) => handlers.set(name, fn),
      registerCommand: (_name: string, c: any) => {
        command = c;
      },
      sendMessage: (message: any) => messages.push(message),
    } as any,
    client,
  );
  return { command, messages, stop: () => handlers.get("session_shutdown")?.() };
}

test("first remote screen offers Connect without fake unavailable actions or freshness jargon", () => {
  expect(inboxItems(empty).map((item) => item.value)).toEqual(["connect"]);
  expect(remoteMenuStatus(empty)).toContain("not connected · Connect");
  expect(remoteMenuStatus(empty)).not.toMatch(/snapshot|refresh|cached/i);
  expect(remoteStatus(empty)).toContain("Connect");
  const status = renderHuman({ tasks: [] }, "status");
  expect(status).toContain("choose Connect");
  expect(status).not.toContain("cached observations");
});

test("connected empty screen offers the next step without refreshing nonexistent tasks", () => {
  expect(inboxItems(connected).map((item) => item.value)).toEqual(["launch", "connect"]);
  expect(remoteMenuStatus(connected)).toContain("connected to sandbox");
  expect(remoteMenuStatus(connected)).toContain("Launch a task");
  expect(remoteMenuStatus(connected)).not.toMatch(/snapshot|refresh/i);
});

test("default human completions are contextual; advanced and JSON commands still submit explicitly", () => {
  expect(remoteCompletions("", empty)?.map((item) => item.value)).toEqual(["connect", "status"]);
  expect(remoteCompletions("", connected)?.map((item) => item.value)).toEqual(["connect", "status", "launch-repo"]);
  expect(remoteCompletions("launch", connected)).toBeNull();
  expect(remoteCompletions("la", connected)?.map((item) => item.value)).toEqual(["launch", "launch-repo"]);
  expect(remoteCompletions("launch-repo-j", connected)?.[0]?.value).toBe("launch-repo-json");
  expect(remoteCompletions("launch-repo-json", connected)).toBeNull();
  expect(remoteCompletions('launch-repo-json {"prompt":"hi"}', connected)).toBeNull();
  expect(remoteCompletions("retry", empty)).toBeNull();
  expect(remoteCompletions("rev", empty)?.[0]?.value).toBe("revoke");
});

test("normal Connect uses the known default with one host editor; advanced command accepts custom path", async () => {
  const calls: any[] = [],
    editors: string[] = [],
    picks = ["connect", undefined];
  const h = harness({
    status: async () => empty,
    syncActive: async () => {},
    connect: async (...args: any[]) => {
      calls.push(args);
      return {};
    },
  });
  try {
    await h.command.handler("", {
      hasUI: true,
      ui: {
        custom: async () => picks.shift(),
        editor: async (title: string) => {
          editors.push(title);
          return " sandbox ";
        },
      },
    });
    expect(editors).toHaveLength(1);
    expect(editors[0]).toContain("uses die on server");
    expect(calls).toEqual([["sandbox"]]);
    expect(h.messages[0].content).toContain("Open /remote to launch");
    await h.command.handler("connect sandbox /opt/custom/die", {});
    expect(calls[1]).toEqual(["sandbox", "/opt/custom/die"]);
  } finally {
    await h.stop();
  }
});

for (const menu of [true, false]) {
  test(
    (menu ? "menu" : "command") + " connect failure gives setup guidance, not answer/cancel uncertainty",
    async () => {
      const h = harness({
        status: async () => empty,
        syncActive: async () => {},
        connect: async () => {
          throw Error("SSH alias not found");
        },
      });
      const picks = ["connect"];
      try {
        await h.command.handler(menu ? "" : "connect sandbox", {
          hasUI: true,
          ui: { custom: async () => picks.shift(), editor: async () => "sandbox" },
        });
        const error = h.messages.at(-1).content;
        expect(error).toContain("SSH alias not found");
        expect(error).toContain("Check the SSH host/alias");
        expect(error).toContain("<die-path>");
        expect(error).not.toMatch(/answer|cancellation|uncertain/i);
      } finally {
        await h.stop();
      }
    },
  );
}

test("action-specific errors keep mutation uncertainty and offline recovery actionable", () => {
  expect(remoteErrorHint("question:task:q")).toContain("same saved reply");
  expect(remoteErrorHint("reply:q")).toContain("do not submit a replacement");
  expect(remoteErrorHint("cancel")).toContain("not confirmed cancellation");
  expect(remoteErrorHint("launch-repo-json")).toContain("same task ID");
  expect(remoteErrorHint("sync")).toContain("Saved transcripts remain available");
  expect(remoteErrorHint("capabilities")).toContain("local revocation remains available offline");
});

test("pending local access is ahead of completed work and opens authorization, not a debug transcript", () => {
  const done: any = { taskId: "done", prompt: "Old task", task: { state: "done" }, events: [] };
  const access: any = {
    ...done,
    taskId: "access",
    prompt: "Read on demand",
    task: { state: "running", capabilityNeeds: [{ id: "need", kind: "repo.read", input: "file.txt" }] },
  };
  const state: any = { ...connected, tasks: { done, access } };
  const tasks = inboxItems(state).filter((item) => item.value.startsWith("task:"));
  expect(tasks[0].value).toBe("task:access");
  expect(tasks[0].label).toContain("local access requested");
  expect(tasks[0].description).toStartWith("Local access requested");
  expect(taskActions(access, true)[0].value).toBe("capabilities");
  expect(taskActions(done, true)[0].label).toBe("Read result and details");
  expect(taskActions(access, false)[0].value).toBe("details");
});

test("untracked approval is a printable human list with exact bulk scope, not protocol JSON", () => {
  const text = untrackedApprovalText(["draft.txt", "escape\x1b[2J.txt"], 3);
  expect(text).toContain("Showing 2 of 3");
  expect(text).toContain("Include all 3 untracked paths");
  expect(text).toContain("Choose No to send tracked files only");
  expect(text).not.toContain('"paths":');
  expect(text).not.toContain("\x1b");
});
