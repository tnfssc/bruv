import { afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  InteractiveMode,
  initTheme,
  SessionManager,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, getCapabilities, setCapabilities, stripTerminalSequences, Text } from "@earendil-works/pi-tui";
import { installConversationDensity } from "../src/ui/conversation-density";
import {
  ACTIVITY_BOUNDARY,
  ActivityController,
  activityMembership,
  installRollingActivity,
  registerRollingActivity,
} from "../src/ui/rolling-activity";
import { installSdkTaskRows } from "../src/ui/sdk-task-rows";
import { taskRowFromLaunch } from "../src/ui/task-rows";
import { makePng } from "./image-fixture";

const theme = { fg: (_color: string, text: string) => text } as any;
const disposers: (() => void)[] = [];
afterEach(() => {
  while (disposers.length) disposers.pop()!();
});
beforeAll(() => {
  const prior = process.env.PI_PACKAGE_DIR;
  delete process.env.PI_PACKAGE_DIR;
  initTheme("dark", false);
  if (prior !== undefined) process.env.PI_PACKAGE_DIR = prior;
});
const plain = (lines: string[]) => lines.map((line) => stripTerminalSequences(line).trim()).filter(Boolean);
function tool(id: string, details?: Record<string, unknown>, error = false) {
  const component = new ToolExecutionComponent(
    "execute",
    id,
    { label: "Check " + id },
    {},
    {
      renderShell: "self",
      renderCall: (_args: unknown, _theme: unknown, context: { expanded: boolean }) =>
        new Text(context.expanded ? "SOURCE " + id : "Check " + id, 0, 0),
      renderResult: (result: any, options: { expanded: boolean }) =>
        new Text(
          options.expanded ? "EVIDENCE " + id + "\nartifact " + id : (result.details?.handoff ?? "result " + id),
          0,
          0,
        ),
    },
    { requestRender() {} } as never,
    "/tmp",
  );
  component.updateResult({ content: [{ type: "text", text: "Evidence " + id }], details, isError: error });
  return component;
}
function setup(entries: any[] = []) {
  disposers.push(installConversationDensity());
  disposers.push(installSdkTaskRows(theme));
  const chat = new Container();
  const scroll = {
    scrollTop: 0,
    scrollTo(top: number) {
      this.scrollTop = top;
    },
  };
  const host = {
    chatContainer: chat,
    renderer: { mode: "fullscreen" },
    ui: { requestRender() {} },
    transcriptScrollView: scroll,
    sessionManager: { getBranch: () => entries, getSessionFile: () => "/session" },
  };
  const state = new ActivityController(host);
  disposers.push(() => state.dispose());
  const render = () => {
    state.sync();
    return plain(chat.render(80));
  };
  return { chat, scroll, state, render };
}
function assistant(text: string) {
  return new AssistantMessageComponent({ role: "assistant", content: [{ type: "text", text }] } as never, false);
}
function user(id: string) {
  return { type: "message", id, message: { role: "user" } };
}
function calls(...ids: string[]) {
  return { type: "message", message: { role: "assistant", content: ids.map((id) => ({ type: "toolCall", id })) } };
}
function boundary(id: string, ...ids: string[]) {
  return { type: "custom", id, customType: ACTIVITY_BOUNDARY, data: { callIds: ids } };
}

test("minimal grouped path counts unique outer calls and retains unknown prose", () => {
  const { chat, state, render } = setup();
  chat.addChild(tool("one"));
  chat.addChild(assistant("This deletes data. Proceed?"));
  chat.addChild(tool("two"));
  chat.addChild(tool("two"));
  expect(render()).toEqual(["2 tools called ▸", "This deletes data. Proceed?"]);
  state.toggle(state.groups[0]!);
  const expanded = render();
  expect(expanded[0]).toBe("2 tools called ▾");
  expect(expanded).toContain("EVIDENCE one");
  expect(expanded).toContain("artifact two");
  expect(chat.children.filter((child) => child instanceof ToolExecutionComponent)).toHaveLength(3);
});

test("header click toggles, detail click stays native, unrelated prose does not toggle", () => {
  const { chat, state, render } = setup();
  const first = tool("one");
  const second = tool("two");
  chat.addChild(first);
  chat.addChild(second);
  chat.addChild(assistant("Final answer"));
  render();
  const click = { type: "click", button: "left", x: 0, y: 0, width: 80, height: 1 } as const;
  expect(first.handleMouse(click as never)?.handled).toBe(true);
  expect(state.groups[0]!.expanded).toBe(true);
  render();
  second.handleMouse(click as never);
  expect(state.groups[0]!.expanded).toBe(true);
  chat.children[2]!.handleMouse?.(click as never);
  expect(state.groups[0]!.expanded).toBe(true);
});

test("latest live tool label replaces preview and settlement removes it", () => {
  const { chat, state, render } = setup();
  state.start();
  chat.addChild(tool("one"));
  expect(render()[0]).toContain("Check one");
  chat.addChild(tool("two"));
  expect(render()[0]).toContain("Check two");
  state.settle();
  expect(render()[0]).toBe("2 tools called ▸");
});

test("typed tasks, failures, handoff, unknown custom messages stay outside collapse", () => {
  const { chat, render } = setup();
  const row = taskRowFromLaunch({ id: "job", kind: "command", status: "running", title: "Job" }, "one")!;
  chat.addChild(tool("one", { taskRows: [row] }));
  chat.addChild(tool("failure", {}, true));
  chat.addChild(tool("handoff", { handoff: "Need your answer" }));
  chat.addChild(
    new CustomMessageComponent({
      role: "custom",
      customType: "unknown",
      content: "Question remains",
      display: true,
    } as never),
  );
  const lines = render();
  expect(lines[0]).toContain("1 failed");
  expect(lines).toContain("↗ Job");
  expect(lines).toContain("result failure");
  expect(lines.join("\n")).toContain("Need your answer");
  expect(lines.join("\n")).toContain("Question remains");
});

test("journal reconstructs automatic continuation, new user, and incomplete stretch", () => {
  const entries = [
    user("u1"),
    calls("a", "b"),
    boundary("end1", "a", "b"),
    calls("c"),
    boundary("end2", "c"),
    user("u2"),
    calls("d"),
    boundary("end3", "d"),
    calls("e"),
  ];
  const membership = activityMembership(entries);
  expect(membership.get("a")).toBe(membership.get("b"));
  expect(membership.get("a")).not.toBe(membership.get("c"));
  expect(membership.get("d")).not.toBe(membership.get("e"));
  const { chat, state, render } = setup(entries);
  for (const id of ["a", "b", "c", "d", "e"]) chat.addChild(tool(id));
  render();
  expect(state.groups.map((group) => state.count(group))).toEqual([2, 1, 1, 1]);
});

test("selected branch alone owns membership; result-only and nested evidence do not count", () => {
  const membership = activityMembership([
    user("u"),
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "outer" },
          { type: "toolCall", id: "nested", parentToolCallId: "outer" },
        ],
      },
    },
    boundary("end", "outer", "sibling"),
    { type: "message", message: { role: "toolResult", toolCallId: "unpaired" } } as any,
  ]);
  expect([...membership.keys()]).toEqual(["outer"]);
});

test("collapse above a prose reading position preserves its anchor", () => {
  const { chat, state, scroll, render } = setup();
  chat.addChild(tool("a"));
  chat.addChild(assistant("Read this"));
  chat.addChild(tool("b"));
  render();
  state.toggle(state.groups[0]!);
  render();
  scroll.scrollTop = chat.children[0]!.render(80).length;
  state.toggle(state.groups[0]!);
  expect(scroll.scrollTop).toBe(chat.children[0]!.render(80).length);
});

function nativeExpand(host: unknown, expanded: boolean): void {
  (
    InteractiveMode.prototype as unknown as { setToolsExpanded(this: unknown, expanded: boolean): void }
  ).setToolsExpanded.call(host, expanded);
}
function nativeHost(mode = "fullscreen") {
  const chat = new Container();
  const entries = [user("u"), calls("a", "b"), boundary("end", "a", "b")];
  const host = {
    renderer: { mode },
    chatContainer: chat,
    loadedResourcesContainer: new Container(),
    toolOutputExpanded: false,
    showStatus() {},
    ui: { requestRender() {} },
    sessionManager: { getBranch: () => entries, getSessionFile: () => "/native-session" },
    transcriptScrollView: {
      scrollTop: 0,
      scrollTo(top: number) {
        this.scrollTop = top;
      },
    },
  };
  return host;
}
test("real Pi Ctrl+O traversal participates in groups and restore", () => {
  disposers.push(installSdkTaskRows(theme));
  const restore = installRollingActivity();
  disposers.push(restore);
  const host = nativeHost();
  host.chatContainer.addChild(tool("a"));
  host.chatContainer.addChild(tool("b"));
  nativeExpand(host, false);
  expect(plain(host.chatContainer.render(80))[0]).toBe("2 tools called ▸");
  nativeExpand(host, true);
  expect(plain(host.chatContainer.render(80))[0]).toBe("2 tools called ▾");
  expect(plain(host.chatContainer.render(80))).toContain("EVIDENCE a");
  nativeExpand(host, false);
  expect(plain(host.chatContainer.render(80))).toEqual(["2 tools called ▸"]);
  restore();
  expect(plain(host.chatContainer.render(80))).toContain("Check a");
});

test("regular rendering is not projected or journaled", () => {
  disposers.push(installSdkTaskRows(theme));
  disposers.push(installRollingActivity());
  const host = nativeHost("regular");
  host.chatContainer.addChild(tool("a"));
  nativeExpand(host, false);
  expect(plain(host.chatContainer.render(80))).toEqual(["Check a", "result a"]);
  const handlers: Record<string, any> = {};
  const saved: unknown[] = [];
  registerRollingActivity({
    on(name: string, fn: unknown) {
      handlers[name] = fn;
    },
    registerCommand() {},
    appendEntry(_type: string, data: unknown) {
      saved.push(data);
    },
  } as never);
  handlers.agent_end(
    { messages: [{ role: "assistant", content: [{ type: "toolCall", id: "a" }] }] },
    { mode: "tui", sessionManager: host.sessionManager },
  );
  expect(saved).toEqual([]);
});

test("rebuild before task-owner installation still groups; picker cancel and open, boundary replay", async () => {
  disposers.push(installRollingActivity());
  const host = nativeHost();
  host.chatContainer.addChild(tool("a"));
  host.chatContainer.addChild(tool("b"));
  nativeExpand(host, false); // Attach before task rows.
  disposers.push(installSdkTaskRows(theme));
  expect(plain(host.chatContainer.render(80))).toEqual(["2 tools called ▸"]);
  const commands: Record<string, any> = {};
  const handlers: Record<string, any> = {};
  const saved: unknown[] = [];
  registerRollingActivity({
    on(name: string, fn: unknown) {
      handlers[name] = fn;
    },
    registerCommand(name: string, cmd: unknown) {
      commands[name] = cmd;
    },
    appendEntry(type: string, data: unknown) {
      saved.push({ type, data });
    },
  } as never);
  const ctx = {
    mode: "tui",
    sessionManager: host.sessionManager,
    ui: {
      notify() {},
      async select(_title: string, choices: string[]) {
        expect(choices[0]).toContain("2 tools called");
        return undefined as string | undefined;
      },
    },
  };
  await commands.activity.handler("", ctx);
  expect(plain(host.chatContainer.render(80))).toEqual(["2 tools called ▸"]);
  ctx.ui.select = async (_title, choices) => choices[0];
  await commands.activity.handler("", ctx);
  expect(plain(host.chatContainer.render(80))[0]).toBe("2 tools called ▾");
  handlers.agent_end(
    {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "toolCall", id: "a" },
            { type: "toolCall", id: "a" },
            { type: "toolCall", id: "b" },
          ],
        },
      ],
    },
    ctx,
  );
  expect(saved).toEqual([{ type: ACTIVITY_BOUNDARY, data: { callIds: ["a", "b"] } }]);
  host.chatContainer.clear();
  host.chatContainer.addChild(tool("a"));
  expect(plain(host.chatContainer.render(80))).toEqual(["1 tool called ▸"]);
});

test("boundary does not fuse a steering user with earlier tools", () => {
  const map = activityMembership([user("u1"), calls("a"), user("u2"), calls("b"), boundary("end", "a", "b")]);
  expect(map.get("a")).not.toBe(map.get("b"));
});

test("collapsed group retains live task snapshot and late canonical completion without adding tools", () => {
  let rows = [taskRowFromLaunch({ id: "job", kind: "command", status: "running", title: "Check job" }, "launch")!];
  disposers.push(installSdkTaskRows(theme, () => rows));
  const host = nativeHost();
  const source = tool("launch");
  (source as any).result = undefined;
  host.chatContainer.addChild(source);
  const state = new ActivityController(host);
  disposers.push(() => state.dispose());
  state.sync();
  expect(plain(host.chatContainer.render(80))).toContain("↗ Check job");
  expect(state.count(state.groups[0]!)).toBe(1);
  rows = [taskRowFromLaunch({ id: "job", kind: "command", status: "completed", title: "Check job" }, "launch")!];
  host.chatContainer.addChild(
    new CustomMessageComponent({
      role: "custom",
      customType: "task-complete",
      content: "Late completion",
      display: true,
      details: { taskRows: rows },
    } as never),
  );
  expect(plain(host.chatContainer.render(80)).filter((line) => line === "✓ Check job")).toHaveLength(1);
  expect(state.count(state.groups[0]!)).toBe(1);
});

test("native disk journal survives reopen and selects only the navigated branch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-activity-journal-"));
  try {
    const manager = SessionManager.create(dir, join(dir, "sessions"));
    manager.appendMessage({ role: "user", content: "Work", timestamp: Date.now() });
    const message = (id: string) =>
      ({
        role: "assistant",
        content: [{ type: "toolCall", id, name: "execute", arguments: { label: id } }],
        stopReason: "toolUse",
        timestamp: Date.now(),
      }) as never;
    manager.appendMessage(message("a"));
    const end1 = manager.appendCustomEntry(ACTIVITY_BOUNDARY, { callIds: ["a"] });
    manager.appendMessage(message("b"));
    const end2 = manager.appendCustomEntry(ACTIVITY_BOUNDARY, { callIds: ["b"] });
    manager.branch(end1);
    manager.appendMessage(message("c"));
    manager.appendCustomEntry(ACTIVITY_BOUNDARY, { callIds: ["c"] });
    const reopened = SessionManager.open(manager.getSessionFile()!);
    let map = activityMembership(reopened.getBranch());
    expect([...map.keys()]).toEqual(["a", "c"]);
    expect(map.get("a")).not.toBe(map.get("c"));
    reopened.branch(end2);
    map = activityMembership(reopened.getBranch());
    expect([...map.keys()]).toEqual(["a", "b"]);
    expect(map.get("a")).not.toBe(map.get("b"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("narrow resize keeps a discoverable header and exact native evidence on expand", () => {
  const { chat, state } = setup();
  chat.addChild(tool("a"));
  state.sync();
  expect(plain(chat.render(18))[0]).toBe("1 tool called ▸");
  state.toggle(state.groups[0]!);
  expect(plain(chat.render(80))).toContain("artifact a");
});

test("group expansion retains actual native image components and original evidence", () => {
  const capabilities = getCapabilities();
  setCapabilities({ ...capabilities, images: "kitty" });
  try {
    const { chat, state, render } = setup();
    const source = tool("image");
    source.updateResult({
      content: [{ type: "image", data: makePng().toString("base64"), mimeType: "image/png" }],
      isError: false,
    });
    chat.addChild(source);
    render();
    expect(chat.render(80).join("\n")).not.toContain("\x1b_G");
    state.toggle(state.groups[0]!);
    expect(chat.render(80).join("\n")).toContain("\x1b_G");
    state.toggle(state.groups[0]!);
    expect(chat.render(80).join("\n")).not.toContain("\x1b_G");
    state.toggle(state.groups[0]!);
    expect(chat.render(80).join("\n")).toContain("\x1b_G");
  } finally {
    setCapabilities(capabilities);
  }
});
