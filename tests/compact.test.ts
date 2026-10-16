import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { fauxAssistantMessage, fauxText, fauxThinking } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  CustomMessageComponent,
  initTheme,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, VStack } from "@earendil-works/pi-tui";
import { Compact, compactProse, fits, type Mode, registerCompact, thinkingView } from "../src/compact";
import { CompactEditor, inputRows } from "../src/editor";
import { sdk } from "./sdk";

const blank = (line: string) => !stripVTControlCharacters(line).trim();

test("thinking loses blank lines between plain prose but keeps lists and code", () => {
  expect(compactProse("a\n\nb\n\n\nc")).toBe("a\nb\nc");
  expect(compactProse("a\n\n- b\n\nc")).toBe("a\n\n- b\n\nc");
  expect(compactProse("```\nx\n\ny\n```\n\nz")).toBe("```\nx\n\ny\n```\n\nz");
  const message = fauxAssistantMessage([fauxThinking("a\n\nb"), fauxThinking("c"), fauxText("x")]);
  const shown = thinkingView(message, false).content;
  expect(shown.map((part) => part.type)).toEqual(["thinking", "text"]);
  expect(thinkingView(message, true).content.map((part) => part.type)).toEqual(["text"]);
  expect(thinkingView(fauxAssistantMessage("x"), true)).toEqual(fauxAssistantMessage("x"));
});

function transcript() {
  const chat = new Container();
  const report = new CustomMessageComponent(
    { role: "custom", customType: "bruv-report", content: "a1 done", display: true, timestamp: 0 },
    () => new Text("a1 done", 1, 0),
  );
  const looking = new AssistantMessageComponent(fauxAssistantMessage("Looking."));
  for (const child of [
    new UserMessageComponent("fix it"),
    looking,
    report,
    new AssistantMessageComponent(fauxAssistantMessage("Done.")),
    new Spacer(1),
    new UserMessageComponent("thanks"),
  ])
    chat.addChild(child);
  return { chat, looking };
}

function fakeMode(chat: Container) {
  const editorContainer = new Container();
  const tui = { terminal: { rows: 40, columns: 80 }, requestRender() {} } as never;
  const theme = { borderColor: (text: string) => text, selectList: {} } as never;
  const keys = { matches: () => false, getKeys: () => [] } as never;
  const editor = new CompactEditor(tui, theme, keys, { paddingX: 0, embedWorkingStatus: true });
  editorContainer.addChild(editor);
  const dock = new VStack([{ component: editorContainer, shrink: 1, minSize: 3 }]);
  const root = new VStack([{ component: chat }, { component: dock }]);
  const slot = (dock as unknown as { entries: { minSize?: number }[] }).entries[0];
  let renders = 0;
  const mode: Mode = {
    chatContainer: chat,
    editorContainer,
    fullscreenLayoutRoot: root,
    ui: { requestRender: () => renders++ },
  };
  return { mode, slot, editor, renders: () => renders };
}

test("the transcript drops Pi's blank rows, and turning it off puts them back", () => {
  initTheme("dark", false);
  const { chat, looking } = transcript();
  const native = chat.render(80);
  const { mode, slot, editor, renders } = fakeMode(chat);
  const compact = new Compact();
  compact.install();
  try {
    compact.attach(mode);
    compact.set(true);
    const lines = chat.render(80);
    // One plain row around each user message; a report line sits under the reply; the answer
    // after the report keeps its gap; Pi's spacer before the second user message is gone.
    expect(lines.map(blank)).toEqual([true, false, true, false, false, true, false, true, false, true]);
    expect(lines.length).toBeLessThan(native.length);
    expect(slot.minSize).toBe(1);
    expect(editor.render(60)).toHaveLength(1);
    expect(renders()).toBe(1);

    // Clicks still reach the right row of a message drawn one row higher.
    let row: number | undefined;
    (looking as { handleMouse: unknown }).handleMouse = (event: { y: number }) => {
      row = event.y;
      return { handled: true };
    };
    const at = (y: number) =>
      chat.handleMouse({
        type: "click",
        button: "left",
        x: 2,
        y,
        screenX: 2,
        screenY: y,
        width: 80,
        height: lines.length,
      } as never);
    expect(at(3)?.handled).toBe(true);
    expect(row).toBe(1);

    compact.set(false);
    expect(chat.render(80)).toEqual(native);
    expect(slot.minSize).toBe(3);
    expect(editor.render(60)).toHaveLength(3);
  } finally {
    compact.uninstall();
  }
  expect(inputRows.min).toBe(3);
});

test("hidden thinking takes no rows, and the real message comes back when turned off", () => {
  initTheme("dark", false);
  const compact = new Compact();
  compact.install();
  try {
    compact.set(true);
    const message = fauxAssistantMessage([fauxThinking("plan\n\nmore"), fauxText("x")]);
    const reply = new AssistantMessageComponent(message, true);
    const chat = new Container();
    chat.addChild(reply);
    expect(reply.render(80).filter((line) => !blank(line))).toHaveLength(1);
    reply.setHideThinkingBlock(false);
    // Shown thinking keeps its lines but not the blank row between them.
    compact.set(false);
    const before = new AssistantMessageComponent(message, false).render(80);
    compact.set(true);
    expect(reply.render(80).filter(blank).length).toBe(before.filter(blank).length - 1);
    compact.attach(fakeMode(chat).mode);
    compact.set(false);
    const shown = (reply as unknown as { lastMessage: typeof message }).lastMessage;
    expect(shown.content).toEqual(message.content);
  } finally {
    compact.uninstall();
  }
});

test("compact spacing fits the installed Pi, and not one missing a wrapped method", () => {
  expect(fits()).toBe(true);
  const proto = AssistantMessageComponent.prototype as unknown as Record<string, unknown>;
  const update = proto.updateContent;
  delete proto.updateContent;
  try {
    expect(fits()).toBe(false);
  } finally {
    proto.updateContent = update;
  }
});

test("a Pi that does not fit keeps Pi's own drawing", async () => {
  const update = AssistantMessageComponent.prototype.updateContent;
  const app = await sdk([(pi) => void registerCompact(pi, false)]);
  try {
    expect(AssistantMessageComponent.prototype.updateContent).toBe(update);
  } finally {
    await app.close();
  }
  const supported = await sdk([(pi) => void registerCompact(pi)]);
  try {
    expect(AssistantMessageComponent.prototype.updateContent).not.toBe(update);
  } finally {
    await supported.close();
  }
  expect(AssistantMessageComponent.prototype.updateContent).toBe(update);
});
