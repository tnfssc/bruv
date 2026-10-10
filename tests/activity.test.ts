import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { initTheme, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { Activity, registerActivity } from "../src/activity";
import { CompactEditor } from "../src/editor";
import { compactFooter } from "../src/footer";
import { registerRender } from "../src/render";
import { sdk } from "./sdk";

test("consecutive calls share one line until prose, and a click opens the whole run", async () => {
  initTheme("dark", false);
  const activity = new Activity();
  const app = await sdk([
    (pi) => {
      registerActivity(pi, activity);
      activity.scripts = registerRender(pi);
    },
  ]);
  try {
    const script = (n: number) => fauxToolCall("codemode", { code: `// step ${n}\ntext("${n}")` });
    app.faux.setResponses([
      fauxAssistantMessage(script(1), { stopReason: "toolUse" }),
      fauxAssistantMessage(script(2), { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Halfway there."), script(3)], { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    await app.session.prompt("go");
    const runner = app.session.extensionRunner;
    const theme = runner.createContext().ui.theme;
    const renderers = runner.resolveToolRenderers("codemode", () => undefined);
    expect(renderers?.renderShell).toBe("self");
    const ids = app.session.messages.flatMap((m) =>
      m.role === "assistant" ? m.content.flatMap((part) => (part.type === "toolCall" ? [part.id] : [])) : [],
    );
    expect(ids).toHaveLength(3);
    const call = (id: string) =>
      renderers?.renderCall?.({ code: "" }, theme, {
        args: {},
        toolCallId: id,
        expanded: false,
        outputPad: 1,
        invalidate() {},
      } as unknown as Parameters<NonNullable<ToolRenderers["renderCall"]>>[2]);
    const lines = (id: string) => call(id)?.render(80).map(stripVTControlCharacters) ?? [];
    const check = () => {
      expect(lines(ids[0])).toHaveLength(1);
      expect(lines(ids[0])[0].match(/\d+/g)).toEqual(["2"]);
      expect(lines(ids[1])).toEqual([]);
      expect(lines(ids[2])).toHaveLength(1);
      expect(lines(ids[2])[0].match(/\d+/g)).toEqual(["1"]);
    };
    check();
    const head = call(ids[0]);
    expect(head?.handleMouse?.({ type: "click", button: "left", x: 2, y: 0, width: 80, height: 1 } as never)).toEqual({
      handled: true,
    });
    expect(lines(ids[1]).length).toBeGreaterThan(0);
    expect(lines(ids[2])).toHaveLength(1);
    head?.handleMouse?.({ type: "click", button: "left", x: 2, y: 0, width: 80, height: 1 } as never);
    await runner.emit({ type: "session_start", reason: "resume" });
    check();
  } finally {
    await app.close();
  }
});

test("the input sits on the footer and the prompt mark becomes the spinner", () => {
  initTheme("dark", false);
  const tui = { terminal: { rows: 40, columns: 80 }, requestRender() {} } as never;
  const theme = { borderColor: (text: string) => text, selectList: {} } as never;
  const keys = { matches: () => false, getKeys: () => [] } as never;
  const editor = new CompactEditor(tui, theme, keys, { paddingX: 0, embedWorkingStatus: true });
  const idle = editor.render(60);
  expect(idle).toHaveLength(3);
  expect(idle.slice(0, 2)).toEqual(["", ""]);
  editor.setText("one\ntwo\nthree\nfour");
  expect(editor.render(60)).toHaveLength(4);
  editor.setWorkingStatusIndicator({
    kind: "working",
    renderSpinnerInBorder: () => "*",
    renderInBorder: () => "* busy",
  } as never);
  expect(editor.render(60)[0].startsWith("*")).toBe(true);
  for (const width of [1, 2, 3, 10, 60])
    expect(editor.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
});

test("the footer stays on one line at every width", async () => {
  initTheme("dark", false);
  const app = await sdk([]);
  try {
    const ctx = app.session.extensionRunner.createContext();
    const data = {
      getGitBranch: () => "feature/a-very-long-branch-name",
      getExtensionStatuses: () =>
        new Map([
          ["bruv", "week 40% · fast · agents $1.20"],
          ["other", "x"],
        ]),
      getAvailableProviderCount: () => 1,
      onBranchChange: () => () => {},
    };
    for (const width of [0, 1, 10, 30, 60, 80, 140]) {
      const lines = compactFooter(ctx, data, ctx.ui.theme, width, 0.5);
      expect(lines.length).toBeLessThanOrEqual(1);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  } finally {
    await app.close();
  }
});
