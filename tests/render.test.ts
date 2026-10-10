import { expect, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { initTheme, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Jobs, registerJobs } from "../src/jobs";
import { outputLines, registerRender } from "../src/render";
import { sdk } from "./sdk";

test("JSON output becomes plain lines and unknown data stays intact", () => {
  expect(outputLines(JSON.stringify({ output: "\x1b[31mone\x1b[0m\ntwo\n" }), false)).toEqual(["one", "two"]);
  const wait = JSON.stringify({
    done: [{ id: "j2", status: "done", output: "one\ntwo" }],
    running: [{ id: "a1", status: "running" }],
  });
  expect(outputLines(wait, false)).toHaveLength(2);
  expect(outputLines(wait, true)).toHaveLength(4);
  for (const value of ['{"unknown":3}', '{"done":[null],"running":[]}', "{bad"])
    expect(outputLines(value, false)).toEqual([value]);
});

test("codemode lists real nested calls, expands output and script, and restores saved calls", async () => {
  initTheme("dark", false);
  const jobs = new Jobs();
  const app = await sdk([
    (pi) => {
      registerJobs(pi, jobs);
      registerRender(pi);
    },
  ]);
  const code =
    'text(await tools.bash({command:"printf \'first\\nsecond\\n\'"})); text(await tools.bash({command:"exit 1"})); const j = await tools.job_start({command:"true"}); text(await tools.wait({ids:[j.id],all:true}));';
  try {
    app.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("codemode", { code }), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    await app.session.prompt("go");
    const result = app.session.messages.find((m) => m.role === "toolResult");
    if (result?.role !== "toolResult") throw new Error("Missing tool result");
    const runner = app.session.extensionRunner;
    const renderers = runner.resolveToolRenderers("codemode", () => undefined);
    const theme = runner.createContext().ui.theme;
    const context = { args: { code }, toolCallId: result.toolCallId, expanded: false } as Parameters<
      NonNullable<ToolRenderers["renderCall"]>
    >[2];
    const render = (expanded: boolean) =>
      renderers
        ?.renderResult?.({ content: result.content, details: result.details }, { expanded, isPartial: false }, theme, {
          ...context,
          expanded,
        })
        .render(120)
        .map(stripVTControlCharacters) ?? [];
    const rows = render(false);
    expect(rows.filter((row) => row.startsWith("✓"))).toHaveLength(3);
    expect(rows.filter((row) => row.startsWith("✗"))).toHaveLength(1);
    expect(rows.some((row) => /✗ bash .* · exit 1/.test(row))).toBe(true);
    expect(rows).toContain("first");
    expect(rows).toContain("second");
    expect(rows.some((row) => row.includes("j1"))).toBe(true);
    const expanded = renderers
      ?.renderCall?.({ code }, theme, { ...context, expanded: true })
      .render(1000)
      .map(stripVTControlCharacters)
      .join("\n");
    expect(expanded?.trimEnd()).toBe(code);
    await runner.emit({ type: "session_start", reason: "resume" });
    expect(render(false).filter((row) => row.startsWith("✓"))).toHaveLength(3);
    const long = {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ output: Array.from({ length: 30 }, (_, i) => `row-${i}`).join("\n") }),
        },
      ],
      details: { calls: [] },
    };
    expect(
      renderers
        ?.renderResult?.(long, { expanded: false, isPartial: false }, theme, { ...context, toolCallId: "long" })
        .render(120),
    ).toHaveLength(13);
    expect(
      renderers
        ?.renderResult?.(long, { expanded: true, isPartial: false }, theme, { ...context, toolCallId: "long" })
        .render(120),
    ).toHaveLength(30);
    const fallback = new Text("fixture", 0, 0);
    const unknown = runner.resolveToolRenderers("codemode", () => ({ renderResult: () => fallback }));
    expect(
      unknown?.renderResult?.(
        { content: [], details: undefined },
        { expanded: false, isPartial: false },
        theme,
        context,
      ),
    ).toBe(fallback);
  } finally {
    await app.close();
  }
});
