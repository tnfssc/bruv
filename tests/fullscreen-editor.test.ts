import { expect, test } from "bun:test";
import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { Container, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "@earendil-works/pi-tui/dist/layout.js";
import { getLayoutNode } from "@earendil-works/pi-tui/dist/layout-node.js";
import { createChatViewport } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/chat-viewport.js";
import { CompactEditor, IDLE_PROMPT_ICON } from "../src/ui/editor";

const identity = (text: string) => text;
const theme: EditorTheme = {
  borderColor: identity,
  selectList: {
    selectedPrefix: identity,
    selectedText: identity,
    description: identity,
    scrollInfo: identity,
    noMatch: identity,
  },
};
function fixture() {
  const tui = { terminal: { rows: 40 }, requestRender() {} } as unknown as TUI;
  const keys = { matches: () => false } as unknown as KeybindingsManager;
  const input = new CompactEditor(tui, theme, keys, { paddingX: 0 });
  const editor = new Container();
  editor.addChild(input);
  const viewport = createChatViewport({
    document: { render: () => Array.from({ length: 100 }, (_, i) => "transcript " + i), invalidate() {} },
    pendingMessages: new Container(),
    status: new Container(),
    editor,
    footer: { render: () => ["fixture footer"], invalidate() {} },
    scrollbar: "hidden",
  });
  const paint = () =>
    renderLayoutFrame(viewport.root, 120, 40, () => {}).lines.map((line) => Bun.stripANSI(line).trimEnd());
  return { input, editor, viewport, paint, native: () => new CustomEditor(tui, theme, keys) };
}

test("fullscreen prompt reserves only its rendered rows, including wrapping and multiline", () => {
  const { input, paint, viewport } = fixture();
  for (const [draft, rows] of [
    ["", 1],
    ["draft", 1],
    ["x".repeat(130), 2],
    ["x".repeat(250), 3],
    ["first\nsecond", 2],
    ["first\nsecond\nthird", 3],
    ["", 1],
  ] as const) {
    input.setText(draft);
    const frame = paint();
    expect(frame).toHaveLength(40);
    expect(frame[39]).toBe("fixture footer");
    expect(frame[39 - rows]).toStartWith(IDLE_PROMPT_ICON + (draft ? " " : ""));
    expect(frame.slice(39 - rows, 39).every((line) => line.length > 0)).toBe(true);
    expect(frame[38 - rows]).toBe("transcript 99");
    expect(viewport.transcript.isFollowingEnd).toBe(true);
  }
});

test("transcript can scroll independently while the compact dock stays bottom anchored", () => {
  const { input, paint, viewport } = fixture();
  input.setText("draft");
  paint();
  viewport.transcript.scrollToStart();
  const top = paint();
  expect(top[0]).toBe("transcript 0");
  expect(top[38]).toBe(IDLE_PROMPT_ICON + " draft");
  expect(top[39]).toBe("fixture footer");
  expect(viewport.transcript.isFollowingEnd).toBe(false);
  viewport.transcript.scrollToEnd();
  expect(paint()[37]).toBe("transcript 99");
});

test("the reused dock restores native editor/dialog reservation and accepts compact restoration", () => {
  const { editor, input, native, viewport, paint } = fixture();
  const root = getLayoutNode(viewport.root)!;
  if (root.type !== "vstack") throw new Error("Expected native root stack");
  const dock = getLayoutNode(root.entries[1]!.component)!;
  if (dock.type !== "vstack") throw new Error("Expected native input dock");
  const slot = dock.entries.find((entry) => entry.component === editor)!;
  expect(slot.minSize).toBe(1);
  editor.clear();
  const bordered = native();
  editor.addChild(bordered);
  expect(slot.minSize).toBe(3);
  const frame = paint();
  expect(frame.slice(36, 39)).toEqual(bordered.render(120).map((line) => Bun.stripANSI(line).trimEnd()));
  editor.clear();
  editor.addChild({ render: () => ["native dialog"], invalidate() {} });
  expect(slot.minSize).toBe(3);
  expect(paint().slice(36)).toEqual(["native dialog", "", "", "fixture footer"]);
  editor.clear();
  editor.addChild(input);
  expect(slot.minSize).toBe(1);
  expect(paint()[38]).toBe(IDLE_PROMPT_ICON);
});
