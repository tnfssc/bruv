import { expect, setDefaultTimeout, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { initTheme, type ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { Jobs, registerJobs } from "../src/jobs";
import { outputLines, registerRender } from "../src/render";
import { sdk } from "./sdk";

setDefaultTimeout(15000);
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

test("nested call durations below one second are hidden for saved and live calls", async () => {
  initTheme("dark", false);
  const app = await sdk([registerRender]);
  try {
    const runner = app.session.extensionRunner;
    const renderer = runner.resolveToolRenderers("codemode", () => undefined);
    expect(renderer?.renderResult).toBeDefined();
    const theme = runner.createContext().ui.theme;
    for (const source of ["saved", "live"]) {
      for (const name of ["read", "edit", "bash"]) {
        const command = `${name === "bash" ? "echo short" : "界".repeat(80)}\nsecond line`;
        for (const durationMs of [undefined, 0, 1, 499, 999, 1000, 1500]) {
          const id = `${source}-${name}-${durationMs}`;
          if (source === "live") {
            await runner.emit({
              type: "tool_execution_start",
              toolCallId: id,
              parentToolCallId: id,
              toolName: name,
              args: { command },
            });
            await runner.emit({
              type: "tool_execution_end",
              toolCallId: id,
              parentToolCallId: id,
              toolName: name,
              result: { content: [] },
              isError: false,
              durationMs,
            });
          }
          for (const expanded of [false, true]) {
            const rows = renderer
              ?.renderResult?.(
                {
                  content: [],
                  details: {
                    calls:
                      source === "saved"
                        ? [{ id, name, args: JSON.stringify({ command }), status: "ok", durationMs }]
                        : [],
                  },
                },
                { expanded, isPartial: false },
                theme,
                { args: {}, toolCallId: id, expanded } as Parameters<NonNullable<ToolRenderers["renderResult"]>>[3],
              )
              .render(200)
              .map(stripVTControlCharacters);
            expect(rows).toHaveLength(1);
            const fields = rows?.[0].trimEnd().split(" · ") ?? [];
            const visible = durationMs !== undefined && durationMs >= 1000;
            const target = fields[0].slice(`✓ ${name} `.length);
            expect(visibleWidth(target)).toBeLessThanOrEqual(60);
            expect(target.endsWith("…")).toBe(name !== "bash");
            expect(target).not.toContain("second line");
            expect(fields).toHaveLength(visible ? 2 : 1);
            if (visible) expect(fields[1]).toBe(`${durationMs / 1000}s`);
          }
        }
      }
    }
  } finally {
    await app.close();
  }
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

test("parallel pending script calls each keep one row through completion", async () => {
  initTheme("dark", false);
  const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  const waiting = Promise.withResolvers<void>();
  const updated = Promise.withResolvers<void>();
  let started = 0;
  let latest: { content: []; details: { calls: { status: string }[] } };
  let parent = "";
  const app = await sdk([
    (pi) => {
      registerRender(pi);
      pi.registerTool({
        name: "wait",
        label: "Wait",
        description: "Wait for test release",
        exposure: "codemode",
        parameters: Type.Object({ id: Type.String() }),
        async execute() {
          const gate = gates[started++];
          if (started === 2) waiting.resolve();
          await gate.promise;
          return { content: [], details: undefined };
        },
      });
      pi.on("tool_execution_update", (event) => {
        if (event.toolName !== "codemode") return;
        parent = event.toolCallId;
        latest = event.partialResult as typeof latest;
        if (latest.details.calls.some((call) => call.status === "ok")) updated.resolve();
      });
    },
  ]);
  const runner = app.session.extensionRunner;
  const renderer = runner.resolveToolRenderers("codemode", () => undefined);
  const rows = () =>
    renderer
      ?.renderResult?.(latest, { expanded: false, isPartial: true }, runner.createContext().ui.theme, {
        args: {},
        toolCallId: parent,
        expanded: false,
      } as Parameters<NonNullable<ToolRenderers["renderResult"]>>[3])
      .render(120)
      .map(stripVTControlCharacters) ?? [];
  app.faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("codemode", {
        code: 'await Promise.all([tools.wait({id:"j1"}), tools.wait({id:"j1"})]);',
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const run = app.session.prompt("go");
  try {
    await waiting.promise;
    expect(rows()).toHaveLength(2);
    expect(rows().filter((row) => row.startsWith("…"))).toHaveLength(2);
    gates[0].resolve();
    await updated.promise;
    expect(rows()).toHaveLength(2);
    expect(rows().filter((row) => row.startsWith("✓"))).toHaveLength(1);
    expect(rows().filter((row) => row.startsWith("…"))).toHaveLength(1);
    gates[1].resolve();
    await run;
    expect(rows()).toHaveLength(2);
    expect(rows().filter((row) => row.startsWith("✓"))).toHaveLength(2);
  } finally {
    for (const gate of gates) gate.resolve();
    await run;
    await app.close();
  }
});
