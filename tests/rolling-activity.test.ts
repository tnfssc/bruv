import { afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  getSelectListTheme,
  InteractiveMode,
  initTheme,
  SessionManager,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  getCapabilities,
  ScrollView,
  setCapabilities,
  stripTerminalSequences,
  Text,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "@earendil-works/pi-tui/dist/layout.js";
import { installConversationDensity } from "../src/ui/conversation-density";
import { completionPreview } from "../src/ui/execution-previews";
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
  const scroll = new ScrollView(chat, { scrollbar: "hidden" });
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
    const rows = chat.render(80);
    scroll.updateLayout(rows.length, 1, () => {});
    return plain(rows);
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
  expect(render()).toEqual(["1 tool called", "This deletes data. Proceed?", "1 tool called"]);
  state.toggle(state.groups[0]!);
  const expanded = render();
  expect(expanded[0]).toBe("1 tool called");
  expect(expanded).toContain("Check one");
  expect(expanded).not.toContain("EVIDENCE one");
  expect(state.groups.map((group) => state.count(group))).toEqual([1, 1]);
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
  expect(render()[0]).toBe("2 tools called");
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
  scroll.scrollTo(chat.children[0]!.render(80).length);
  state.toggle(state.groups[0]!);
  render();
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
    transcriptScrollView: new ScrollView(chat, { scrollbar: "hidden" }),
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
  expect(plain(host.chatContainer.render(80))[0]).toBe("2 tools called");
  nativeExpand(host, true);
  expect(plain(host.chatContainer.render(80))[0]).toBe("2 tools called");
  expect(plain(host.chatContainer.render(80))).toContain("EVIDENCE a");
  nativeExpand(host, false);
  expect(plain(host.chatContainer.render(80))).toEqual(["2 tools called"]);
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
  expect(plain(host.chatContainer.render(80))).toEqual(["2 tools called"]);
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
  expect(plain(host.chatContainer.render(80))).toEqual(["2 tools called"]);
  ctx.ui.select = async (_title, choices) => choices[0];
  await commands.activity.handler("", ctx);
  expect(plain(host.chatContainer.render(80))[0]).toBe("2 tools called");
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
  expect(plain(host.chatContainer.render(80))).toEqual(["1 tool called"]);
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
  expect(plain(chat.render(18))[0]).toBe("1 tool called");
  state.toggle(state.groups[0]!);
  expect(plain(chat.render(80))).toContain("Check a");
  expect(plain(chat.render(80))).not.toContain("artifact a");
  const source = chat.children[0] as ToolExecutionComponent;
  source.handleMouse({ type: "click", button: "left", x: 0, y: 2, width: 80, height: 4 } as never);
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

test("session_shutdown reload recreates the controller on the same InteractiveMode host", async () => {
  disposers.push(installSdkTaskRows(theme));
  disposers.push(installRollingActivity());
  const host = nativeHost();
  host.chatContainer.addChild(tool("a"));
  nativeExpand(host, false);
  expect(plain(host.chatContainer.render(80))).toEqual(["1 tool called"]);
  const handlers: Record<string, any> = {};
  const commands: Record<string, any> = {};
  const saved: unknown[] = [];
  registerRollingActivity({
    on(name: string, handler: unknown) {
      handlers[name] = handler;
    },
    registerCommand(name: string, command: unknown) {
      commands[name] = command;
    },
    appendEntry(type: string, data: unknown) {
      saved.push({ type, data });
    },
  } as never);
  const notices: string[] = [];
  const ctx = {
    mode: "tui",
    sessionManager: host.sessionManager,
    ui: {
      notify(message: string) {
        notices.push(message);
      },
      async select(_title: string, choices: string[]) {
        return choices[0];
      },
    },
  };
  handlers.session_shutdown({ reason: "reload" }, ctx);
  expect(plain(host.chatContainer.render(80))).toContain("Check a");
  // Pi /reload rebuilds the transcript on this same host. Use its real replay
  // method to create the new native tool component, then exercise registration.
  const definition = (host.chatContainer.children[0] as any).toolDefinition;
  host.chatContainer.clear();
  Object.assign(host.sessionManager, { getCwd: () => "/tmp" });
  Object.assign(host, {
    pendingTools: new Map(),
    settingsManager: {
      getShowCacheMissNotices: () => false,
      getShowImages: () => false,
      getImageWidthCells: () => 60,
    },
    getRegisteredToolDefinition: () => definition,
    addMessageToChat: (message: any) => host.chatContainer.addChild(new AssistantMessageComponent(message, false)),
  });
  (InteractiveMode.prototype as any).renderSessionItems.call(host, [
    { role: "assistant", content: [{ type: "toolCall", id: "a", name: "execute", arguments: { label: "Check a" } }] },
    { role: "toolResult", toolCallId: "a", content: [{ type: "text", text: "Evidence a" }], isError: false },
  ]);
  expect(plain(host.chatContainer.render(80))).toEqual(["1 tool called"]);
  await commands.activity.handler("", ctx);
  expect(notices).toEqual([]);
  expect(plain(host.chatContainer.render(80))[0]).toBe("1 tool called");
  handlers.agent_end({ messages: [{ role: "assistant", content: [{ type: "toolCall", id: "a" }] }] }, ctx);
  expect(saved).toEqual([{ type: ACTIVITY_BOUNDARY, data: { callIds: ["a"] } }]);
});

test("new child rows keep independent native details across group close and reopen", async () => {
  disposers.push(installSdkTaskRows(theme));
  disposers.push(installRollingActivity());
  const host = nativeHost();
  const first = tool("a");
  host.chatContainer.addChild(first);
  nativeExpand(host, false);
  host.chatContainer.render(80);
  first.handleMouse({ type: "click", button: "left", x: 0, y: 0, width: 80, height: 1 } as never);
  expect(host.toolOutputExpanded).toBe(false);
  const second = tool("b");
  host.chatContainer.addChild(second);
  expect(plain(host.chatContainer.render(80))[0]).toBe("2 tools called");
  expect((first as any).expanded).toBe(false);
  expect((second as any).expanded).toBe(false);
  expect(plain(host.chatContainer.render(80))).not.toContain("artifact b");
  // Dispatch through Pi's native detail mouse region, not a group/header action.
  expect(
    second.handleMouse({ type: "click", button: "left", x: 0, y: 1, width: 80, height: 3 } as never)?.handled,
  ).toBe(true);
  host.chatContainer.render(80);
  expect((second as any).expanded).toBe(true);
  expect((first as any).expanded).toBe(false);
  first.handleMouse({ type: "click", button: "left", x: 0, y: 0, width: 80, height: 4 } as never);
  host.chatContainer.render(80);
  first.handleMouse({ type: "click", button: "left", x: 0, y: 0, width: 80, height: 1 } as never);
  expect(plain(host.chatContainer.render(80))).toContain("artifact b");
  expect((first as any).expanded).toBe(false);
});

test("live header and activity picker normalize raw action labels", async () => {
  const { chat, state, render } = setup();
  state.start();
  const source = tool("a");
  (source as any).args.label = "Check\nInjected row\r\x1b[2J";
  chat.addChild(source);
  expect(render()).toEqual(["1 tool called · Check Injected row"]);
  for (const control of ["\n", "\r", "\x1b"]) expect(state.label(state.groups[0]!)).not.toContain(control);
  // Exercise the registered picker, with the actual Pi agent-start wrapper.
  disposers.push(installRollingActivity());
  const host = Object.assign(nativeHost(), {
    isInitialized: true,
    footer: { invalidate() {} },
    pendingTools: new Map(),
  });
  await (InteractiveMode.prototype as any).handleEvent.call(host, { type: "agent_start" });
  const live = tool("live");
  (live as any).args.label = "Check\nInjected row\r\x1b[2J";
  host.chatContainer.addChild(live);
  expect(plain(host.chatContainer.render(80))).toEqual(["1 tool called · Check Injected row"]);
  let activity: any;
  registerRollingActivity({
    on() {},
    registerCommand(_name: string, command: unknown) {
      activity = command;
    },
  } as never);
  await activity.handler("", {
    mode: "tui",
    sessionManager: host.sessionManager,
    ui: {
      notify(message: string) {
        throw new Error(message);
      },
      async select(_title: string, choices: string[]) {
        expect(choices).toEqual(["1. 1 tool called · Check Injected row", "  1.1. Details — Check Injected row"]);
        return undefined;
      },
    },
  });
});

test("duplicate failed tool components share the same failure identity as the denominator", () => {
  const { chat, render, state } = setup();
  chat.addChild(tool("a", {}, true));
  chat.addChild(tool("a", {}, true));
  expect(render()[0]).toBe("1 tool called · 1 failed");
  expect(state.count(state.groups[0]!)).toBe(1);
  expect(render().filter((line) => line === "result a")).toHaveLength(2);
});

test("Ctrl+O preserves READ 29 after native ScrollView lays out newly expanded content", () => {
  disposers.push(installConversationDensity());
  disposers.push(installSdkTaskRows(theme));
  disposers.push(installRollingActivity());
  const host = nativeHost();
  const scroll = new ScrollView(host.chatContainer, { follow: "end", scrollbar: "hidden" });
  Object.assign(host, { transcriptScrollView: scroll });
  const originalLayout = scroll.updateLayout;
  const source = new ToolExecutionComponent(
    "execute",
    "a",
    { label: "Check substantial output" },
    {},
    {
      renderShell: "self",
      renderCall: () => new Text("Check substantial output", 0, 0),
      renderResult: (_result: unknown, options: { expanded: boolean }) =>
        new Text(
          options.expanded ? Array.from({ length: 24 }, (_, i) => "EVIDENCE " + (i + 1)).join("\n") : "result",
          0,
          0,
        ),
    },
    { requestRender() {} } as never,
    "/tmp",
  );
  source.updateResult({ content: [{ type: "text", text: "substantial output" }], isError: false });
  host.chatContainer.addChild(source);
  host.chatContainer.addChild(assistant(Array.from({ length: 40 }, (_, i) => "READ " + (i + 1)).join("\n")));
  nativeExpand(host, false);
  const paint = () => {
    host.chatContainer.render(80);
    return renderLayoutFrame(scroll, 80, 10, () => {}).lines.map((line) => stripTerminalSequences(line).trim());
  };
  paint();
  const collapsedRows = host.chatContainer.render(80);
  const read29 = collapsedRows.findIndex((line) => stripTerminalSequences(line).trim() === "READ 29");
  expect(read29).toBeGreaterThan(0);
  scroll.scrollTo(read29, { disableFollow: true });
  expect(paint()[0]).toBe("READ 29");
  nativeExpand(host, true);
  const expandedRead29 = host.chatContainer
    .render(80)
    .findIndex((line) => stripTerminalSequences(line).trim() === "READ 29");
  expect(expandedRead29).toBeGreaterThan(collapsedRows.length - 10); // Old native max must clamp this target.
  expect(paint()[0]).toBe("READ 29");
  expect(scroll.scrollTop).toBe(expandedRead29);
  expect(scroll.isFollowingEnd).toBe(false);
  nativeExpand(host, false);
  expect(paint()[0]).toBe("READ 29");
  expect(scroll.scrollTop).toBe(read29);
  expect(scroll.updateLayout).toBe(originalLayout); // One-shot owned hook leaves no residue.
});

test("long grouped transcripts index membership instead of rescanning tools and children", () => {
  const { chat, state } = setup();
  const count = 1000;
  for (let i = 0; i < count; i++) chat.addChild(tool(String(i)));
  state.sync();
  let childReads = 0;
  chat.children = new Proxy(chat.children, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) childReads++;
      return Reflect.get(target, key, receiver);
    },
  });
  state.sync();
  // One traversal builds the next membership index; removal checks must not
  // scan this same transcript separately for each historical tool.
  expect(childReads).toBeLessThanOrEqual(count * 2);
  let memberReads = 0;
  const group = state.groups[0]!;
  group.tools = new Proxy(group.tools, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) memberReads++;
      return Reflect.get(target, key, receiver);
    },
  });
  expect(plain(chat.render(80))).toEqual(["1000 tools called"]);
  // Counting/labeling visits members a bounded number of times; finding each
  // child's group must not repeatedly search that group's tool array.
  expect(memberReads).toBeLessThanOrEqual(count * 8);
});

function notice(customType: "task-complete" | "task-attention", content: string, details?: unknown) {
  return new CustomMessageComponent(
    { role: "custom", customType, content, details, display: true } as never,
    (message, options, currentTheme) =>
      completionPreview(
        message.content,
        options.expanded,
        currentTheme,
        options.outputPad,
        customType,
        message.details,
      ),
  );
}

test("headers use transcript padding and subdued theme without a group arrow at narrow widths", () => {
  const { chat, state } = setup();
  state.host.outputPad = 2;
  chat.addChild(tool("a"));
  state.sync();
  const header = chat.render(22)[0]!;
  expect(header).toBe("  " + getSelectListTheme().description("1 tool called"));
  expect(stripTerminalSequences(header)).toBe("  1 tool called");
  expect(header).not.toContain("▸");
  expect(header).not.toContain("▾");
  for (const width of [1, 2, 4, 5, 9, 16]) {
    const lines = chat.render(width);
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
  }
});

test("live and saved activity keep prose, question, permission, and user boundaries", () => {
  const prose = {
    type: "message",
    id: "p",
    message: { role: "assistant", content: [{ type: "text", text: "Proceed?" }] },
  };
  const control = { type: "custom_message", id: "permission", customType: "permission-request" };
  const entries = [user("u"), calls("a"), prose, calls("b"), control, calls("c"), boundary("end", "a", "b", "c")];
  const membership = activityMembership(entries);
  expect(new Set([membership.get("a"), membership.get("b"), membership.get("c")]).size).toBe(3);
  const { chat, state, render } = setup(entries);
  state.start();
  chat.addChild(tool("a"));
  chat.addChild(assistant("Proceed?"));
  chat.addChild(tool("b"));
  chat.addChild(
    new CustomMessageComponent({
      role: "custom",
      customType: "permission-request",
      content: "Allow access?",
      display: true,
    } as never),
  );
  chat.addChild(tool("c"));
  expect(render().filter((line) => line.includes("tool called"))).toHaveLength(3);
  expect(render().join("\n")).toContain("Allow access?");
  state.settle();
  expect(render().filter((line) => line.includes("tool called"))).toHaveLength(3);
});

test("late callback provenance updates its original call without duplicate cards or invented calls", () => {
  const { chat, state, render } = setup();
  const original = tool("original");
  chat.addChild(original);
  chat.addChild(assistant("Checks are running."));
  chat.addChild(tool("foreground"));
  chat.addChild(assistant("Foreground answer."));
  const details = {
    tasks: [
      {
        id: "job-a",
        kind: "command",
        status: "failed",
        exitCode: 7,
        launchIdentity: { sourceSessionId: "/session", sourceCallId: "original", callIndex: 1 },
      },
    ],
  };
  const callback = notice("task-complete", "ORIGINAL_CALLBACK_OUTPUT", details);
  chat.addChild(callback);
  const collapsed = render();
  expect(state.groups.map((group) => state.count(group))).toEqual([1, 1, 0]);
  expect(collapsed.filter((line) => line === "✗ Check original — exit 7")).toHaveLength(1);
  expect(collapsed.join("\n")).not.toContain("ORIGINAL_CALLBACK_OUTPUT");
  expect(collapsed).toContain("1 job notification · 1 job failed");
  expect((original as any).expanded).toBe(false);
  state.toggle(state.groups[2]!);
  expect(render()).toContain("Job update — click for details");
  callback.handleMouse({ type: "click", button: "left", x: 0, y: 1, width: 80, height: 2 } as never);
  expect(render().join("\n")).toContain("ORIGINAL_CALLBACK_OUTPUT");
  expect((original as any).expanded).toBe(false);
  state.toggle(state.groups[2]!);
  state.toggle(state.groups[2]!);
  expect(render().join("\n")).toContain("ORIGINAL_CALLBACK_OUTPUT");
  expect((callback as any).message.details).toBe(details);
  expect(chat.children).toContain(callback);
});

test("notification-only batches keep failed and cancelled outcomes visible while progress and wake prose stays grouped", () => {
  const { chat, state, render } = setup();
  chat.addChild(
    notice("task-attention", "WAKE_CALLBACK_OUTPUT", { attention: [{ id: "running", reasons: ["review"] }] }),
  );
  chat.addChild(
    notice("task-attention", "PROGRESS_CALLBACK_OUTPUT", { attention: [{ id: "running", reasons: ["quiet"] }] }),
  );
  chat.addChild(
    notice("task-complete", "FAILED_CALLBACK_OUTPUT", {
      tasks: [
        { id: "bad", kind: "command", status: "failed", exitCode: 3 },
        { id: "stop", kind: "command", status: "killed" },
      ],
    }),
  );
  const rows = render();
  expect(state.groups).toHaveLength(1);
  expect(state.count(state.groups[0]!)).toBe(0);
  expect(rows[0]).toBe("3 job notifications · 1 job failed · 1 cancelled");
  expect(rows.join("\n")).not.toContain("CALLBACK_OUTPUT");
  expect(rows.join("\n")).not.toContain("tools called");
  expect(rows).toContain("✗ bad — exit 3");
  expect(rows).toContain("⊘ stop — cancelled");
  state.toggle(state.groups[0]!);
  expect(render().filter((line) => line === "Job update — click for details")).toHaveLength(2);
});

test("callback text does not classify unknown custom messages or absorb lasting custom controls", () => {
  const { chat, state, render } = setup();
  chat.addChild(notice("task-complete", "one"));
  chat.addChild(
    new CustomMessageComponent({
      role: "custom",
      customType: "question",
      content: "Background job completed. Allow deletion?",
      display: true,
    } as never),
  );
  chat.addChild(notice("task-attention", "two"));
  expect(render().join("\n")).toContain("Allow deletion?");
  expect(state.groups.map((group) => state.count(group))).toEqual([0, 0]);
  expect(render().filter((line) => line === "1 job notification")).toHaveLength(2);
});

test("notification projection restores native output on disposal and regular-mode rendering", () => {
  const { chat, state, render } = setup();
  const callback = notice("task-attention", "NATIVE_WAKE_OUTPUT");
  chat.addChild(callback);
  expect(render()).toEqual(["1 job notification"]);
  state.host.renderer.mode = "regular";
  callback.setExpanded(true);
  expect(render().join("\n")).toContain("NATIVE_WAKE_OUTPUT");
  state.host.renderer.mode = "fullscreen";
  state.dispose();
  expect(plain(chat.render(80)).join("\n")).toContain("NATIVE_WAKE_OUTPUT");
  expect(plain(chat.render(80)).join("\n")).not.toContain("job notification");
});

test("native journal reopen and branch replay reconstruct notice groups and late call ownership", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-activity-notices-"));
  try {
    const manager = SessionManager.create(dir, join(dir, "sessions"));
    manager.appendMessage({ role: "user", content: "Check", timestamp: Date.now() });
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "origin", name: "execute", arguments: { label: "Check origin" } }],
      stopReason: "toolUse",
      timestamp: Date.now(),
    } as never);
    manager.appendMessage({
      role: "toolResult",
      toolCallId: "origin",
      toolName: "execute",
      content: [{ type: "text", text: "LAUNCH_EVIDENCE" }],
      isError: false,
      timestamp: Date.now(),
    });
    const before = manager.appendCustomEntry(ACTIVITY_BOUNDARY, { callIds: ["origin"] });
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Saved answer" }],
      stopReason: "stop",
      timestamp: Date.now(),
    } as never);
    const details = {
      tasks: [
        {
          id: "late",
          kind: "command",
          status: "killed",
          launchIdentity: { sourceSessionId: manager.getSessionFile(), sourceCallId: "origin", callIndex: 1 },
        },
      ],
    };
    const after = manager.appendCustomMessageEntry("task-complete", "SAVED_CALLBACK_EVIDENCE", true, details);
    const reopened = SessionManager.open(manager.getSessionFile()!);
    disposers.push(installConversationDensity());
    disposers.push(installSdkTaskRows(theme));
    disposers.push(installRollingActivity());
    const host = nativeHost();
    Object.assign(host, {
      sessionManager: reopened,
      pendingTools: new Map(),
      settingsManager: {
        getShowCacheMissNotices: () => false,
        getShowImages: () => false,
        getImageWidthCells: () => 60,
      },
      getRegisteredToolDefinition: () => ({
        ...(tool("definition") as any).toolDefinition,
        renderResult: (result: any) => new Text(result.content.map((part: any) => part.text ?? "").join("\n"), 0, 0),
      }),
      addMessageToChat: (message: any) =>
        host.chatContainer.addChild(
          message.role === "custom"
            ? notice(message.customType, message.content, message.details)
            : message.role === "user"
              ? new UserMessageComponent(message.content)
              : new AssistantMessageComponent(message, false),
        ),
    });
    const replay = () => {
      host.chatContainer.clear();
      (host as any).pendingTools.clear();
      (InteractiveMode.prototype as any).renderSessionItems.call(host, reopened.buildSessionContext().messages);
      return plain(host.chatContainer.render(80));
    };
    const rows = replay();
    expect(rows).toContain("1 tool called");
    expect(rows).toContain("1 job notification · 1 cancelled");
    expect(rows.filter((line) => line === "⊘ Check origin — cancelled")).toHaveLength(1);
    expect(rows).toContain("Saved answer");
    expect(rows.join("\n")).not.toContain("SAVED_CALLBACK_EVIDENCE");
    nativeExpand(host, true);
    expect(plain(host.chatContainer.render(80)).join("\n")).toContain("SAVED_CALLBACK_EVIDENCE");
    expect(plain(host.chatContainer.render(80)).join("\n")).toContain("LAUNCH_EVIDENCE");
    reopened.branch(before);
    expect(replay().join("\n")).not.toContain("job notification");
    reopened.branch(after);
    nativeExpand(host, false);
    expect(replay()).toContain("1 job notification · 1 cancelled");
    expect(reopened.getBranch().filter((entry) => entry.type === "custom_message")).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("canonical task-card clicks open only their native tool details", () => {
  const { chat, state, render } = setup();
  const source = tool("a", {
    taskRows: [taskRowFromLaunch({ id: "job", kind: "command", status: "running", title: "Job" }, "a")],
  });
  const other = tool("b");
  chat.addChild(source);
  chat.addChild(other);
  expect(render()).toContain("↗ Job");
  source.handleMouse({ type: "click", button: "left", x: 0, y: 1, width: 80, height: 2 } as never);
  expect(render()).toContain("artifact a");
  expect((other as any).expanded).toBe(false);
  state.toggle(state.groups[0]!);
  state.toggle(state.groups[0]!);
  expect(render()).toContain("artifact a");
});

test("activity picker can open and close one native item without expanding its siblings", async () => {
  disposers.push(installSdkTaskRows(theme));
  disposers.push(installRollingActivity());
  const host = nativeHost();
  const a = tool("a"),
    b = tool("b");
  host.chatContainer.addChild(a);
  host.chatContainer.addChild(b);
  nativeExpand(host, false);
  host.chatContainer.render(80);
  let activity: any;
  registerRollingActivity({
    on() {},
    registerCommand(_name: string, command: any) {
      activity = command;
    },
  } as never);
  const ctx = {
    sessionManager: host.sessionManager,
    ui: {
      notify() {},
      async select(_title: string, choices: string[]) {
        return choices.find((label) => label.endsWith("Details — Check b"));
      },
    },
  };
  await activity.handler("", ctx);
  expect(plain(host.chatContainer.render(80))).toContain("artifact b");
  expect((a as any).expanded).toBe(false);
  expect((b as any).expanded).toBe(true);
  await activity.handler("", ctx);
  expect(plain(host.chatContainer.render(80))).not.toContain("artifact b");
  expect((a as any).expanded).toBe(false);
});

test("regular mode retains standalone callback task ownership when the launch has no task card", () => {
  const { chat, state, render } = setup();
  state.host.renderer.mode = "regular";
  const source = tool("origin");
  const callback = notice("task-complete", "REGULAR_CALLBACK", {
    tasks: [
      {
        id: "late",
        kind: "command",
        status: "failed",
        exitCode: 9,
        launchIdentity: { sourceSessionId: "/session", sourceCallId: "origin", callIndex: 1 },
      },
    ],
  });
  chat.addChild(source);
  chat.addChild(callback);
  expect(render()).toEqual(["Check origin", "result origin", "✗ Check origin — exit 9"]);
  state.host.renderer.mode = "fullscreen";
  expect(render().filter((line) => line === "✗ Check origin — exit 9")).toHaveLength(1);
  expect(render()).toEqual(["1 tool called", "✗ Check origin — exit 9", "1 job notification · 1 job failed"]);
});

test("collapsed notice groups retain producer-reported adverse outcomes beyond capped child rows", () => {
  const { chat, render } = setup();
  chat.addChild(
    notice("task-complete", "BATCH_OUTPUT", {
      tasks: [{ id: "ok", kind: "command", status: "completed" }],
      taskStatusCounts: { completed: 1, failed: 1, killed: 1, running: 0, unknown: 0 },
      omittedTasks: 2,
    }),
  );
  const rows = render();
  expect(rows[0]).toBe("1 job notification");
  expect(rows.join("\n")).toContain("failed");
  expect(rows.join("\n")).toContain("cancelled");
  expect(rows.join("\n")).not.toContain("BATCH_OUTPUT");
});
