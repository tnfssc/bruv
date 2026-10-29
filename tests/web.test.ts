import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import WebSocket from "ws";
import { saveConfig } from "../src/config";
import { registerWeb } from "../src/web";
import { wakeMark } from "../src/web/lines";
import { overview } from "../src/web/overview";
import type { WebPart } from "../src/web/part";
import type { Line, ServerEvent, T3State, Thread } from "../src/web/protocol";
import type { T3Link } from "../src/web/t3";
import { parseTask } from "../src/web/tasks";
import { Waker } from "../src/web/wake";
import { sdk } from "./sdk";

async function until(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const thread = (id: string, status: string): Thread => ({
  id,
  projectId: "p",
  title: id,
  status,
  needsUser: false,
  pinned: false,
  away: false,
  createdAt: "2026-10-28T00:00:00.000Z",
  updatedAt: "2026-10-28T00:00:00.000Z",
});

/** T3 as the web version sees it, driven by the test. */
function fakeT3() {
  const listeners = new Set<Parameters<T3Link["onChange"]>[0]>();
  const responded: { threadId: string; requestId: string; decision: string }[] = [];
  const threads = [thread("a", "running")];
  const state: T3State = { state: "connected" };
  let followed: string[] = [];
  const link: T3Link = {
    state: () => state,
    projects: () => [{ id: "p", title: "bruv", root: "/code/bruv" }],
    threads: () => threads,
    // Through `threads`, so a test that swaps the list sees it here too.
    thread: (id) => link.threads().find((each) => each.id === id),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mcp: async () => undefined,
    respond: async (threadId, requestId, decision) => {
      responded.push({ threadId, requestId, decision });
    },
    asset: async () => {
      throw new Error("no files in this fake");
    },
    readFile: async () => ({ contents: "", truncated: false }),
    follow: (ids) => {
      followed = [...ids];
    },
    pair: async () => "http://t3.test",
    unpair: () => false,
    close: () => listeners.clear(),
  };
  return {
    link,
    responded,
    followed: () => followed,
    change: (changed: Thread[]) => {
      for (const listener of listeners) listener({ threads: changed });
    },
    say: (threadId: string, text: string) => {
      for (const listener of listeners)
        listener({ message: { threadId, id: `m-${text.length}`, text, at: new Date().toISOString() } });
    },
  };
}

async function web(extra: Partial<Parameters<typeof registerWeb>[1]> = {}, cwd?: string) {
  const agentDir = join(process.env.PI_CODING_AGENT_DIR as string, `web-${Date.now()}-${Math.random()}`);
  saveConfig({ web: { port: 0 } }, agentDir);
  const t3 = fakeT3();
  const notes: string[] = [];
  const app = await sdk(
    [
      (pi) =>
        registerWeb(pi, {
          agentDir,
          on: true,
          t3: () => t3.link,
          assets: async () => ({
            index: async () => "<!doctype html><title>page</title>",
            handle: () => false,
            close: async () => {},
          }),
          ...extra,
        }),
    ],
    { notify: (text) => notes.push(text) },
    cwd,
  );
  await until(() => notes.some((note) => /\?t=/.test(note)));
  const url = notes.join(" ").match(/http:\/\/\S+\?t=\S+/)?.[0] ?? "";
  return { app, t3, url };
}

function page(url: string) {
  const { host, search } = new URL(url);
  const ws = new WebSocket(`ws://${host}/socket${search}`);
  const events: ServerEvent[] = [];
  ws.on("message", (data) => events.push(JSON.parse(data.toString())));
  const lines = () => {
    const shown = new Map<string, Line>();
    for (const event of events) {
      if (event.type === "hello") for (const line of event.lines) shown.set(line.id, line);
      if (event.type === "line") shown.set(event.line.id, event.line);
      if (event.type === "append") {
        const line = shown.get(event.id);
        if (line) shown.set(event.id, { ...line, text: line.text + event.text });
      }
    }
    return [...shown.values()];
  };
  return { ws, events, lines };
}

test("pi --web serves the page with its key and tells it what T3 is doing", async () => {
  const { app, t3, url } = await web();
  try {
    expect((await fetch(url)).status).toBe(200);
    expect((await fetch(url.replace(/\?t=.*/, "?t=wrong"))).status).toBe(404);
    const { ws, events } = page(url);
    await until(() => events.length > 0);
    const hello = events[0];
    expect(hello.type === "hello" && hello.threads.map((each) => each.id)).toEqual(["a"]);
    t3.change([thread("a", "completed")]);
    await until(() => events.some((event) => event.type === "threads"));
    expect(events.find((event) => event.type === "threads")).toMatchObject({
      threads: [{ id: "a", status: "completed" }],
    });
    ws.close();
  } finally {
    await app.close();
  }
});

test("what the page says reaches the assistant, and its answer comes back to every page", async () => {
  const { app, url } = await web();
  try {
    let prompt = "";
    app.faux.setResponses([
      (context) => {
        prompt = JSON.stringify(context.messages.filter((message) => message.role === "system"));
        return fauxAssistantMessage("On it.");
      },
    ]);
    const first = page(url);
    const second = page(url);
    await until(() => first.events.length > 0 && second.events.length > 0);
    first.ws.send(JSON.stringify({ type: "say", text: "fix the login bug" }));
    for (const each of [first, second]) {
      await until(() => each.lines().some((line) => line.role === "assistant" && !line.partial));
      expect(each.lines().map((line) => [line.role, line.text])).toEqual([
        ["user", "fix the login bug"],
        ["assistant", "On it."],
      ]);
    }
    await until(() => first.events.some((event) => event.type === "busy" && !event.busy));
    // The assistant is told where its workspace is.
    expect(prompt).toContain(app.session.sessionManager.getCwd());

    // A page that opens later gets the conversation so far.
    const late = page(url);
    await until(() => late.events.length > 0);
    expect(late.lines().map((line) => line.role)).toEqual(["user", "assistant"]);
    for (const each of [first, second, late]) each.ws.close();
  } finally {
    await app.close();
  }
});

test("a very long conversation costs a page only the lines it shows, and it can scroll back through all of it", async () => {
  const { app, url } = await web();
  try {
    const manager = app.session.sessionManager;
    const total = 20_000;
    for (let index = 0; index < total; index++) {
      manager.appendMessage(
        index % 2
          ? fauxAssistantMessage(`answer ${index}`)
          : { role: "user", content: `question ${index}`, timestamp: Date.now() },
      );
    }
    const { ws, events } = page(url);
    await until(() => events.length > 0);
    const hello = events[0];
    if (hello.type !== "hello") throw new Error("no hello");
    expect(hello.lines.length).toBeLessThan(100);
    expect(hello.more).toBe(true);
    expect(hello.lines.at(-1)?.text).toBe(`answer ${total - 1}`);

    // Scrolling back reaches the very first line, a page at a time, in order.
    const seen = [...hello.lines];
    let more = hello.more;
    while (more) {
      const before = seen[0].id;
      const answered = events.length;
      ws.send(JSON.stringify({ type: "more", before }));
      await until(() => events.length > answered);
      const older = events.at(-1);
      if (older?.type !== "older") throw new Error("no older lines");
      seen.unshift(...older.lines);
      more = older.more;
    }
    expect(seen.length).toBe(total);
    expect(seen[0].text).toBe("question 0");
    ws.close();
  } finally {
    await app.close();
  }
}, 30_000);

test("pictures from the page reach the assistant and come back as links, not inline", async () => {
  const { app, url } = await web();
  try {
    let seen = 0;
    app.faux.setResponses([
      (context) => {
        seen = context.messages.flatMap((message) =>
          message.role === "user" && Array.isArray(message.content)
            ? message.content.filter((block) => block.type === "image")
            : [],
        ).length;
        return fauxAssistantMessage("Nice picture.");
      },
    ]);
    const { ws, events, lines } = page(url);
    await until(() => events.length > 0);
    // A real 1×1 picture: Pi drops ones it can't read.
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    ws.send(JSON.stringify({ type: "say", text: "look", images: [`data:image/png;base64,${png}`] }));
    await until(() => lines().some((line) => line.role === "assistant" && !line.partial));
    expect(seen).toBe(1);
    const sent = lines().find((line) => line.role === "user");
    expect(sent?.images?.length).toBe(1);
    expect(sent?.images?.[0].startsWith("data:")).toBe(false);
    const picture = await fetch(new URL(sent?.images?.[0] ?? "", url));
    expect(picture.headers.get("content-type")).toStartWith("image/");
    expect((await picture.arrayBuffer()).byteLength).toBeGreaterThan(0);
    // A page that opens later gets the saved picture by its link too.
    const late = page(url);
    await until(() => late.events.length > 0);
    const saved = late.lines().find((line) => line.role === "user")?.images?.[0] ?? "";
    expect((await fetch(new URL(saved, url))).status).toBe(200);
    expect((await fetch(new URL(saved.replace(/\?t=.*/, "?t=wrong"), url))).status).toBe(404);
    late.ws.close();
    ws.close();
  } finally {
    await app.close();
  }
});

test("overview lists what needs the user, works, failed or newly finished, across projects, and nothing else", () => {
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  const at = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  const threads: Thread[] = [
    { ...thread("asks", "waiting"), needsUser: true },
    { ...thread("runs", "running"), projectId: "q" },
    { ...thread("broke", "failed"), updatedAt: at(1) },
    { ...thread("done-unseen", "completed"), finishedAt: at(2), visitedAt: at(3) },
    { ...thread("done-seen", "completed"), finishedAt: at(2), visitedAt: at(1) },
    { ...thread("done-long-ago", "completed"), finishedAt: at(24 * 10) },
    { ...thread("child", "running"), parentId: "runs" },
    { ...thread("settled", "running"), away: true },
  ];
  const projects = [
    { id: "p", title: "bruv", root: "/code/bruv" },
    { id: "q", title: "site", root: "/code/site" },
  ];
  const text = overview(threads, projects, { now });
  for (const id of ["asks", "runs", "broke", "done-unseen"]) expect(text).toContain(`id ${id}`);
  for (const id of ["done-seen", "done-long-ago", "child", "settled"]) expect(text).not.toContain(`id ${id}`);
  const site = overview(threads, projects, { now, project: "site" });
  expect(site).toContain("id runs");
  expect(site).not.toContain("id asks");
});

test("a task file gives its title, status, next step and threads, however the threads are written", () => {
  const listed = parseTask(
    "login",
    "---\ntitle: Fix the login redirect\nstatus: Waiting\nnext: Pick a fix\nthreads: [a, 'b']\n---\nNotes.",
    "2026-10-28T00:00:00.000Z",
  );
  expect(listed).toMatchObject({ slug: "login", status: "waiting", next: "Pick a fix", threads: ["a", "b"] });
  const lines = parseTask("ci", "---\nthreads:\n  - a\n  - b\n---\n# Stop the flaky test\n", "x");
  expect(lines).toMatchObject({ threads: ["a", "b"], status: "working" });
  expect(lines.title).toContain("flaky");
  expect(parseTask("plain-notes", "just text", "x").threads).toEqual([]);
  expect(parseTask("finished", "---\nstatus: done\nnext: None\n---\n", "x").next).toBeUndefined();
});

test("wake-ups follow only the threads of open tasks, gather what changed, and wait until the assistant is free", async () => {
  const woke: string[] = [];
  let free = false;
  const waker = new Waker({ wake: ({ text }) => woke.push(text), free: () => free, everyMinutes: 0, gather: 10 });
  try {
    waker.tasks([
      { slug: "x", title: "Fix login", status: "working", threads: ["a", "b"], updatedAt: "" },
      { slug: "y", title: "Old", status: "done", threads: ["c"], updatedAt: "" },
    ]);
    // First sightings only set the baseline.
    waker.threads([thread("a", "running"), thread("b", "running"), thread("c", "running"), thread("d", "running")]);
    waker.threads([
      thread("a", "completed"),
      { ...thread("b", "running"), needsUser: true },
      thread("c", "failed"),
      thread("d", "failed"),
    ]);
    // Churn that isn't news.
    waker.threads([thread("a", "completed")]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(woke).toEqual([]);
    free = true;
    waker.free();
    await until(() => woke.length === 1);
    expect(woke[0]).toContain('"a"');
    expect(woke[0]).toContain('"b"');
    expect(woke[0]).not.toContain('"c"');
    expect(woke[0]).not.toContain('"d"');
  } finally {
    waker.close();
  }
});

test("a thread a task follows finishing wakes the assistant, the page sees the task, and its reply is news for an away user", async () => {
  const workspace = join(process.env.PI_CODING_AGENT_DIR as string, `workspace-${Date.now()}-${Math.random()}`);
  mkdirSync(join(workspace, "tasks"), { recursive: true });
  writeFileSync(join(workspace, "tasks", "login.md"), "---\ntitle: Fix login\nstatus: working\nthreads: [a]\n---\n");
  const news: string[] = [];
  const part: WebPart = { name: "test", start: () => {}, news: (text) => news.push(text), close: () => {} };
  const { app, t3, url } = await web({ parts: () => [part], gather: 10 }, workspace);
  try {
    let woken = "";
    app.faux.setResponses([
      (context) => {
        woken = JSON.stringify(context.messages);
        return fauxAssistantMessage("The login fix is done and ready for you to review.");
      },
    ]);
    const { ws, events, lines } = page(url);
    await until(() => events.length > 0);
    const hello = events[0];
    expect(hello.type === "hello" && hello.tasks.map((task) => task.slug)).toEqual(["login"]);
    // The threads of open tasks are followed closely.
    expect(t3.followed()).toEqual(["a"]);
    // The page counts as away once it says so.
    ws.send(JSON.stringify({ type: "visible", visible: false }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The thread's last words come with its finishing, for the assistant to act on.
    t3.say("a", "Fixed the redirect; PR 12 is open for review.");
    t3.change([thread("a", "completed")]);
    await until(() => news.length === 1);
    expect(woken).toContain(wakeMark.trim());
    expect(woken).toContain("PR 12 is open");
    expect(news[0]).toContain("review");
    // The page shows the short line, not what the thread said.
    await until(() => lines().some((line) => line.role === "wake"));
    expect(lines().find((line) => line.role === "wake")?.text).not.toContain("PR 12");

    // A task file the assistant writes reaches open pages.
    writeFileSync(join(workspace, "tasks", "notes.md"), "---\ntitle: Release notes\nstatus: waiting\n---\n");
    await until(() => events.some((event) => event.type === "tasks" && event.tasks.length === 2));
    ws.close();
  } finally {
    await app.close();
  }
});

test("the page scrolls back past a fresh session into the one before it", async () => {
  const { app, url } = await web();
  try {
    const manager = app.session.sessionManager;
    const say = (text: string, index: number) =>
      manager.appendMessage(
        index % 2 ? fauxAssistantMessage(text) : { role: "user", content: text, timestamp: Date.now() },
      );
    for (let index = 0; index < 120; index++) say(`earlier ${index}`, index);
    const parent = manager.getSessionFile();
    manager.newSession({ parentSession: parent });
    for (let index = 0; index < 4; index++) say(`now ${index}`, index);

    const { ws, events } = page(url);
    await until(() => events.length > 0);
    const hello = events[0];
    if (hello.type !== "hello") throw new Error("no hello");
    expect(hello.lines.at(-1)?.text).toBe("now 3");
    expect(hello.lines.some((line) => line.text.startsWith("earlier"))).toBe(true);
    const seen = [...hello.lines];
    let more = hello.more;
    while (more) {
      const answered = events.length;
      ws.send(JSON.stringify({ type: "more", before: seen[0].id }));
      await until(() => events.length > answered);
      const older = events.at(-1);
      if (older?.type !== "older") throw new Error("no older lines");
      seen.unshift(...older.lines);
      more = older.more;
    }
    expect(seen.map((line) => line.text)).toEqual([
      ...Array.from({ length: 120 }, (_, index) => `earlier ${index}`),
      ...Array.from({ length: 4 }, (_, index) => `now ${index}`),
    ]);
    ws.close();
  } finally {
    await app.close();
  }
});

test("a permission request a thread waits on can be answered from the page, and questions can't be", async () => {
  const { app, t3, url } = await web();
  try {
    const { ws, events } = page(url);
    await until(() => events.length > 0);
    t3.change([
      { ...thread("a", "running"), needsUser: true, requestId: "r1", requestKind: "command" },
      { ...thread("b", "running"), needsUser: true, requestId: "q1", requestKind: "user_input" },
    ]);
    await until(() => events.some((event) => event.type === "threads"));
    // The fake's thread list is fixed; the page acts on what it was sent.
    t3.link.threads = () => [
      { ...thread("a", "running"), needsUser: true, requestId: "r1", requestKind: "command" },
      { ...thread("b", "running"), needsUser: true, requestId: "q1", requestKind: "user_input" },
    ];
    ws.send(JSON.stringify({ type: "respond", threadId: "a", decision: "accept" }));
    ws.send(JSON.stringify({ type: "respond", threadId: "b", decision: "accept" }));
    await until(() => t3.responded.length === 1 && events.some((event) => event.type === "step"));
    expect(t3.responded).toEqual([{ threadId: "a", requestId: "r1", decision: "accept" }]);
    ws.close();
  } finally {
    await app.close();
  }
});

test("a thread starts being followed from where it is, so its first change after that is news", async () => {
  const woke: string[] = [];
  const now = new Map([["a", thread("a", "running")]]);
  const waker = new Waker({
    wake: ({ text }) => woke.push(text),
    free: () => true,
    everyMinutes: 0,
    gather: 10,
    lookup: (id) => now.get(id),
  });
  try {
    waker.tasks([{ slug: "x", title: "Fix login", status: "working", threads: ["a"], updatedAt: "" }]);
    // The very first event T3 sends for it says it now waits on the user.
    waker.threads([{ ...thread("a", "running"), needsUser: true }]);
    await until(() => woke.length === 1);
    expect(woke[0]).toContain('"a"');
  } finally {
    waker.close();
  }
});

test("a file the assistant shows reaches every page as a line of its own, fetched with no key", async () => {
  const workspace = join(process.env.PI_CODING_AGENT_DIR as string, `workspace-${Date.now()}-${Math.random()}`);
  mkdirSync(join(workspace, "out"), { recursive: true });
  writeFileSync(join(workspace, "out", "chart.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  const { app, url } = await web({}, workspace);
  try {
    app.faux.setResponses([
      // Called from a script, as the model often does: the file still gets its line.
      fauxAssistantMessage(
        fauxToolCall("codemode", {
          code: '// Show the chart\nawait tools.show({ path: "out/chart.svg", title: "Speed" });',
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("That's the chart."),
    ]);
    const { ws, events, lines } = page(url);
    await until(() => events.length > 0);
    ws.send(JSON.stringify({ type: "say", text: "show me the chart" }));
    await until(() => lines().some((line) => line.text === "That's the chart."));
    const shown = lines().find((line) => line.files)?.files?.[0];
    expect(shown).toMatchObject({ kind: "image", name: "chart.svg", title: "Speed" });
    const { origin } = new URL(url);
    const file = await fetch(origin + shown?.url);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-security-policy")).toContain("sandbox");

    // It is part of the conversation for a page that opens later.
    const late = page(url);
    await until(() => late.events.length > 0);
    expect(late.lines().some((line) => line.files?.[0]?.url === shown?.url)).toBe(true);
    ws.close();
    late.ws.close();
  } finally {
    await app.close();
  }
});

test("a coding session doesn't get the web version's tools", async () => {
  const app = await sdk([(pi) => registerWeb(pi, { on: false })]);
  try {
    const names = app.session.getAllTools().map((tool) => tool.name);
    // `show` is terminal voice's in a coding session; the web version's would replace it.
    for (const name of ["overview", "approve", "show"]) expect(names).not.toContain(name);
  } finally {
    await app.close();
  }
});

test("scrolling back from a line the page saw live finds the lines before it", async () => {
  const { app, url } = await web();
  try {
    app.faux.setResponses([fauxAssistantMessage("first answer"), fauxAssistantMessage("second answer")]);
    const { ws, events, lines } = page(url);
    await until(() => events.length > 0);
    ws.send(JSON.stringify({ type: "say", text: "first question", id: "p-1" }));
    await until(() => lines().some((line) => line.text === "first answer"));
    ws.send(JSON.stringify({ type: "say", text: "second question", id: "p-2" }));
    await until(() => lines().some((line) => line.text === "second answer"));
    await until(() => events.some((event, index) => index > 2 && event.type === "busy" && !event.busy));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The page's own id for its second line, as a page that dropped older lines would ask with.
    ws.send(JSON.stringify({ type: "more", before: "p-2" }));
    await until(() => events.some((event) => event.type === "older"));
    const older = events.find((event) => event.type === "older");
    expect(older?.type === "older" && older.lines.map((line) => line.text)).toEqual(["first question", "first answer"]);
    ws.close();
  } finally {
    await app.close();
  }
});
