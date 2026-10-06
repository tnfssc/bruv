// Run in a separate Bun process: module controls must not leak into other UI tests.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { Container } from "@earendil-works/pi-tui";

const sdk = resolve(import.meta.dir, "../../node_modules/@earendil-works/pi-coding-agent");
assert.equal((await Bun.file(resolve(sdk, "package.json")).json()).version, "1.0.3");
const scenario = process.argv[2];
const saved = scenario !== "empty" && scenario !== "empty-stopped";
const events: string[] = [];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const colors = deferred();
const rebind = deferred();
const grammars = deferred();
const grammarReady = deferred();
const syntaxPath = resolve(sdk, "dist/utils/syntax-highlight.js");
const syntax = { ...(await import(syntaxPath)) };
assert.equal(syntax.supportsLanguage("elixir"), false, "fixture language must not be eagerly loaded");
mock.module(syntaxPath, () => ({
  ...syntax,
  loadAllHighlightLanguages: () => {
    events.push("grammars:start");
    return grammars.promise
      .then(() => syntax.loadAllHighlightLanguages())
      .then(() => {
        events.push("grammars:ready");
        grammarReady.resolve();
      });
  },
}));
mock.module(resolve(sdk, "dist/utils/tools-manager.js"), () => ({
  ensureTool: async (name: string) => {
    events.push("tool:" + name);
    return "/fixture/" + name;
  },
}));
// Execute the shipped, patched method; do not copy its implementation into the test.
const { InteractiveMode } = await import(resolve(sdk, "dist/modes/interactive/interactive-mode.js"));
const { AssistantMessageComponent } = await import(
  resolve(sdk, "dist/modes/interactive/components/assistant-message.js")
);
const { CustomEditor } = await import(resolve(sdk, "dist/modes/interactive/components/custom-editor.js"));
const { initTheme, setTheme, getEditorTheme } = await import(resolve(sdk, "dist/modes/interactive/theme/theme.js"));
initTheme("dark", false);
const message = { role: "assistant", content: [{ type: "text", text: "" }] };
message.content[0]!.text =
  "Saved prose with words that wrap at a narrow width.\n\n" +
  "```elixir\ndefmodule Demo do\n  def value, do: 42\nend\n```";
const chat = new Container();
let assistant: InstanceType<typeof AssistantMessageComponent> | undefined;
let invalidations = 0;
let rebuilds = 0;
const mode = Object.create(InteractiveMode.prototype);
const ui = {
  terminal: { rows: 24, columns: 80 },
  setFocus() {
    events.push("focus");
  },
  start() {
    events.push("ui:start");
  },
  requestRender() {
    events.push("render:request");
  },
  invalidate() {
    events.push("invalidate");
    invalidations++;
    chat.invalidate();
  },
  renderNow() {
    events.push("paint:transcript");
    chat.render(80);
  },
};
const editor = new CustomEditor(ui, getEditorTheme(), { matches: () => false });
const seams = {
  isInitialized: false,
  ui,
  renderer: ui,
  defaultEditor: editor,
  editor,
  session: { scopedModels: [], state: { messages: saved ? [message] : [] } },
  settingsManager: { getFullscreenScrollbar: () => "auto" },
  themeController: {
    applyFromSettings() {
      events.push("theme:apply");
    },
    waitForTerminalColors() {
      events.push("colors:wait");
      return colors.promise;
    },
  },
  footerDataProvider: { onBranchChange() {} },
  chatContainer: chat,
  registerSignalHandlers() {},
  getChangelogForDisplay() {},
  renderWidgets() {},
  shouldShowStartupHeader: () => false,
  mountInteractiveTui() {
    events.push("mount");
  },
  setupKeyHandlers() {
    events.push("keys:ready");
  },
  setupEditorSubmitHandler() {
    events.push("submit:ready");
  },
  async rebindCurrentSession() {
    events.push("rebind:start");
    await rebind.promise;
    if (scenario === "rebind-error") throw new Error("fixture extension startup failed");
    events.push("rebind:ready");
  },
  sessionManager: {
    buildContextEntries: () => (saved ? [message] : []),
    getEntries: () => [],
    getEntryCountByType(type: string) {
      assert.equal(type, "compaction");
      return 0;
    },
  },
  renderSessionEntries(entries: unknown[]) {
    events.push("messages:render");
    if (entries.length) {
      assert.equal(syntax.supportsLanguage("elixir"), true, "real grammar must be ready before saved content is built");
      assistant = new AssistantMessageComponent(message);
      const update = assistant.updateContent.bind(assistant);
      assistant.updateContent = (...args: unknown[]) => {
        rebuilds++;
        return update(...args);
      };
      chat.addChild(assistant);
    }
  },
  renderProjectTrustWarningIfNeeded() {},
  updateEditorBorderColor() {
    events.push("theme:border");
  },
  async updateAvailableProviderCount() {
    events.push("providers:ready");
  },
};
for (const [key, value] of Object.entries(seams)) Object.defineProperty(mode, key, { value, writable: true });
for (const key of [
  "documentContainer",
  "pendingMessagesContainer",
  "statusContainer",
  "widgetContainerAbove",
  "editorContainer",
  "widgetContainerBelow",
  "footerContainer",
  "headerContainer",
])
  mode[key] = new Container();
const tick = () => new Promise<void>((done) => setImmediate(done));
const until = async (event: string) => {
  for (let n = 0; n < 100 && !events.includes(event); n++) await tick();
  assert(events.includes(event), "missing event " + event + ": " + events);
};
const init = mode.init();
const outcome = init.then(
  () => undefined,
  (error: Error) => error,
);
assert(events.includes("ui:start"), "terminal must start synchronously before startup awaits");
assert(events.includes("focus"));
editor.handleInput("typing while startup awaits");
assert.equal(editor.getText(), "typing while startup awaits");
assert.equal(typeof editor.onSubmit, "function");
assert.equal(events.includes("grammars:start"), saved);
assert(!events.includes("messages:render"));
colors.resolve();
await until("rebind:start");
assert(events.includes("tool:fd") && events.includes("tool:rg"), "managed tools must use the fixture seam");
assert(events.includes("keys:ready") && events.includes("submit:ready"));
assert(!events.includes("messages:render"));
if (scenario === "saved-ready") {
  grammars.resolve();
  await grammarReady.promise;
  assert(events.includes("grammars:ready"));
  assert(!events.includes("messages:render"), "early grammar readiness cannot bypass extension setup");
}
rebind.resolve();
await tick();
if (scenario === "rebind-error") {
  assert.equal((await outcome)?.message, "fixture extension startup failed");
  assert(!events.includes("messages:render"));
  assert(!events.includes("paint:transcript"));
} else {
  if (saved) {
    if (scenario !== "saved-ready")
      assert(!events.includes("messages:render"), "rebind completion alone cannot paint saved messages");
    grammars.resolve();
    assert.equal(await outcome, undefined);
    assert(events.indexOf("grammars:ready") < events.indexOf("messages:render"));
    assert(events.indexOf("messages:render") < events.indexOf("paint:transcript"));
    assert.equal(invalidations, 0, "grammar readiness must not rebuild the saved transcript after paint");
    const highlighted = assistant!.render(80).join("\n");
    assert(highlighted.includes("defmodule") && highlighted.includes("\x1b["));
    assert.equal(rebuilds, 0);
    // Native theme callbacks, explicit invalidation, mutable results, and width changes remain live.
    assert.equal(setTheme("light", false).success, true);
    assert.equal(invalidations, 1);
    assert.equal(rebuilds, 1);
    assert(events.includes("theme:border"));
    assert.notEqual(assistant!.render(80).join("\n"), highlighted);
    assert.notDeepEqual(assistant!.render(25), assistant!.render(80));
    assistant!.updateContent({ ...message, content: [{ type: "text", text: "Updated result" }] });
    assert(assistant!.render(80).join("\n").includes("Updated result"));
    ui.invalidate();
    assert.equal(invalidations, 2);
    assert.equal(rebuilds, 3);
  } else {
    assert.equal(await outcome, undefined, "empty startup must finish before grammars are ready");
    assert(events.indexOf("paint:transcript") < events.indexOf("grammars:start"));
    assert.equal(invalidations, 0);
    if (scenario === "empty-stopped") mode.isInitialized = false;
    grammars.resolve();
    await grammarReady.promise;
    assert(events.includes("grammars:ready"));
    await tick();
    assert.equal(invalidations, scenario === "empty-stopped" ? 0 : 1);
  }
  if (mode.isInitialized) {
    const before = events.length;
    await mode.init();
    assert.equal(events.length, before, "repeat init must stay a no-op");
  }
}
console.log(JSON.stringify({ scenario, events, invalidations, rebuilds }));
