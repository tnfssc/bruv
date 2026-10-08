import { expect, test } from "bun:test";
import { ToolExecutionComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, type Component } from "@earendil-works/pi-tui";
import { installSettledExecuteRendering } from "../../src/ui/settled-execute-render";
import { installConversationDensity } from "../../src/ui/conversation-density";
import { installSdkTaskRows } from "../../src/ui/sdk-task-rows";
import { executeInputPreview, executeOutputPreview } from "../../src/ui/execution-previews";

initTheme("dark");
const success = { content: [{ type: "text", text: "saved body" }], details: { exitCode: 0 }, isError: false };
function fixture(name = "execute") {
  let renders = 0;
  const tool = new ToolExecutionComponent(
    name,
    "call",
    { code: 'console.log("source")', label: "Inspect module" },
    { showImages: false },
    {
      renderShell: "self",
      renderCall: (args: any, theme: any, context: any) =>
        executeInputPreview(args.code, context.expanded, theme, context.state, 0, args.label),
      renderResult: (result: any, options: any, theme: any, context: any) => {
        const preview = executeOutputPreview(
          result,
          options.expanded,
          context.isError,
          theme,
          context.args.code,
          context.state,
          0,
          context.args.label,
          options.isPartial,
        );
        return {
          invalidate: () => preview.invalidate?.(),
          render: (width: number) => {
            renders++;
            return preview.render(width);
          },
        };
      },
    },
    { requestRender() {} } as never,
    "/tmp",
  );
  tool.markExecutionStarted();
  return { tool, renders: () => renders };
}
const plain = (lines: string[]) => lines.map((line) => Bun.stripANSI(line)).join("\n");

test("completed native execute shell reuses one width and refreshes on its display lifecycle", () => {
  const restore = installSettledExecuteRendering();
  try {
    const { tool, renders } = fixture();
    tool.updateResult(success as never);
    const lines = tool.render(80);
    for (let i = 0; i < 100; i++) expect(tool.render(80)).toBe(lines);
    expect(renders()).toBe(1);
    tool.render(30);
    tool.render(80);
    expect(renders()).toBe(3); // only the last width, not a multi-width cache
    tool.setExpanded(true);
    expect(plain(tool.render(80))).toContain("saved body");
    tool.updateResult({ ...success, content: [{ type: "text", text: "replacement body" }] } as never);
    expect(plain(tool.render(80))).toContain("replacement body");
    expect(plain(tool.render(80))).not.toContain("saved body");
    tool.setExpanded(false);
    expect(plain(tool.render(80))).not.toContain("replacement body");
    tool.updateArgs({ code: "new source", label: "New label" });
    expect(plain(tool.render(80))).toContain("New label");
    tool.updateResult({ ...success, details: { exitCode: 7 }, isError: true } as never);
    expect(plain(tool.render(80))).toContain("✗ New label");
    const before = renders();
    const dark = tool.render(80);
    initTheme("light");
    tool.invalidate();
    expect(tool.render(80)).not.toBe(dark);
    expect(renders()).toBe(before + 1);
    tool.setShowImages(true);
    tool.render(80);
    expect(renders()).toBe(before + 2);
    restore();
    tool.render(80);
    tool.render(80);
    expect(renders()).toBe(before + 4);
  } finally {
    initTheme("dark");
    restore();
  }
});

test("partial results, pending calls, other tools and native protocol images do not use settled rows", () => {
  const restore = installSettledExecuteRendering();
  try {
    const { tool, renders } = fixture();
    expect(tool.render(80)).not.toBe(tool.render(80));
    tool.updateResult(success as never, true);
    tool.render(80);
    tool.render(80);
    expect(renders()).toBe(2);
    tool.updateResult(success as never);
    tool.render(80);
    tool.render(80);
    expect(renders()).toBe(3);
    let imageFrame = 0;
    const image: Component = { invalidate() {}, render: () => ["image frame " + ++imageFrame] };
    const native = tool as unknown as { imageComponents: Component[]; imageSpacers: Component[] };
    native.imageComponents = [image];
    native.imageSpacers = [];
    expect(plain(tool.render(80))).toContain("image frame 1");
    expect(plain(tool.render(80))).toContain("image frame 2");
    expect(renders()).toBe(5);
    const other = fixture("other");
    other.tool.updateResult(success as never);
    other.tool.render(80);
    other.tool.render(80);
    expect(other.renders()).toBe(2);
  } finally {
    restore();
  }
});

test("native mouse expansion and changing task-row overlays remain above the settled shell", () => {
  const restore = installSettledExecuteRendering();
  const density = installConversationDensity();
  let rows: any[] = [];
  const taskRows = installSdkTaskRows({ fg: (_color: string, text: string) => text } as never, () => rows);
  try {
    const chat = new Container();
    const { tool } = fixture();
    chat.addChild(tool);
    tool.updateResult(success as never);
    const frame = chat.render(80);
    const y = frame.findIndex((line) => Bun.stripANSI(line).includes("Inspect module"));
    expect(
      chat.handleMouse({ type: "click", button: "left", x: 1, y, width: 80, height: frame.length } as never)?.handled,
    ).toBe(true);
    expect(plain(chat.render(80))).toContain("saved body");
    tool.setExpanded(false);
    rows = [
      { source: "local", id: "job", status: "running", terminal: false, title: "Live task", sourceCallId: "call" },
    ];
    expect(plain(chat.render(80))).toContain("Live task");
    rows = [{ ...rows[0], status: "succeeded", terminal: true }];
    expect(plain(chat.render(80))).toContain("✓");
    rows = [];
    expect(plain(chat.render(80))).toContain("Inspect module");
  } finally {
    taskRows();
    density();
    restore();
  }
});
