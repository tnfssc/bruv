import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { completionDiagnosticDetails } from "../src/agent/extension";
import { registerExecuteTool } from "../src/typescript/extension";
import {
  completionPreview,
  type ExecutePreviewState,
  executeInputPreview,
  executeOutputPreview,
} from "../src/ui/execution-previews";

const theme = { fg: (_color: string, text: string) => text } as any;
const code = 'console.log("first");\nconsole.log("last");';
const success = {
  content: [{ type: "text", text: "Execution completed with exit code 0.\n\nstdout:\nfirst\nlast" }],
  details: { exitCode: 0, stdout: "first\nlast", stderr: "", images: [] },
};

describe("execute call/result lifecycle", () => {
  test("collapsed execute call and settled result are deterministic single rows", () => {
    expect(executeInputPreview(code, false, theme, undefined).render(100)).toEqual(["⠋"]);
    expect(executeOutputPreview(success, false, false, theme, code).render(120)).toEqual(["✓ Action"]);
  });

  test("calls show a spinner and compact action label", () => {
    // SDK partial/start transitions are covered in foreground-execution-sdk.test.ts.
    expect(executeInputPreview(code, false, theme, undefined, 0, "Read output").render(100)).toEqual(["⠋ Read output"]);
  });

  test("shared renderer state prevents Pi call/result composition from adding a second row", () => {
    const state: ExecutePreviewState = {};
    const call = executeInputPreview(code, false, theme, state);
    expect(call.render(100)).toHaveLength(1);
    const result = executeOutputPreview(success, false, false, theme, code, state);
    expect([...call.render(100), ...result.render(100)]).toHaveLength(1);
  });

  test("default in-flight and settled action rows keep one label without lifecycle vocabulary", () => {
    for (const [source, label, caption] of [
      ["console.log(1)", undefined, ""],
      ["console.log(1)", "Read output", "Read output"],
      [undefined, undefined, ""],
    ]) {
      const state: ExecutePreviewState = {};
      const call = executeInputPreview(source, false, theme, state, 0, label);
      expect(call.render(100)).toEqual(["⠋" + (caption ? " " + caption : "")]);
      const result = executeOutputPreview(success, false, false, theme, source, state, 0, label);
      expect([...call.render(100), ...result.render(100)]).toEqual(["✓ " + (caption || "Action")]);
      expect(result.render(100).join("\n")).not.toMatch(/executing|executed|running|completed/i);
      expect(result.render(100).join("\n")).not.toContain("stdout");
    }
    expect(executeOutputPreview({ content: [], details: { exitCode: 8 } }, false, false, theme).render(100)).toEqual([
      "✗ Action — exit 8",
    ]);
    expect(executeOutputPreview({ content: [] }, false, true, theme).render(100)).toEqual(["✗ Action — failed"]);
    expect(executeOutputPreview({ content: [] }, false, false, theme).render(100)).toEqual([
      "? Action — Outcome unknown",
    ]);
  });

  test("partial execute results keep observing spinner state at the same width", () => {
    const state: ExecutePreviewState = { spinnerFrame: 0 };
    const preview = executeOutputPreview(success, false, false, theme, code, state, 2, "Read module", true);
    expect(preview.render(80)[0]).toContain("⠋ Read module");
    state.spinnerFrame = 1;
    expect(preview.render(80)[0]).toContain("⠙ Read module");
  });

  test("settled execute rows reuse one width and rerender after native invalidation", () => {
    let colorCalls = 0;
    let prefix = "old:";
    const renderTheme = {
      fg: (_color: string, text: string) => {
        colorCalls++;
        return prefix + text;
      },
    } as any;
    for (const expanded of [false, true]) {
      const preview = executeOutputPreview(success, expanded, false, renderTheme, code, undefined, 2, "Read module");
      const rows = preview.render(80);
      const warmCalls = colorCalls;
      for (let frame = 0; frame < 100; frame++) expect(preview.render(80)).toEqual(rows);
      expect(colorCalls).toBe(warmCalls);
      preview.render(40);
      expect(colorCalls).toBeGreaterThan(warmCalls);
      const resizedCalls = colorCalls;
      preview.render(80);
      expect(colorCalls).toBeGreaterThan(resizedCalls);
      prefix = "new:";
      preview.invalidate();
      expect(preview.render(80).join("\n")).toContain("new:");
      prefix = "old:";
    }
  });

  test("collapsed handoff results present their progress text once without requiring expansion", () => {
    const message = "Work is continuing while the background job finishes.";
    const handoff = {
      content: [{ type: "text", text: "Execution handed off.\n\n" + message }],
      details: { exitCode: 0, handoff: message, backgroundJobs: ["job_1"], images: [] },
    };
    const rows = executeOutputPreview(handoff, false, false, theme, "await handoff(message)").render(32);
    const rendered = rows.map((row) => stripTerminalSequences(row).trimEnd()).join("\n");

    expect(rows.length).toBeGreaterThan(1);
    expect(rendered).toContain("Work is continuing");
    expect(rendered.split("Work is continuing")).toHaveLength(2);
    expect(rendered).not.toContain("await handoff");
    expect(rendered).not.toContain("Execution handed off");
  });

  test("handoff-only execute calls still settle to one visible progress message", () => {
    const state: ExecutePreviewState = {};
    const message = "Waiting for the user to continue.";
    const call = executeInputPreview('await handoff("' + message + '")', false, theme, state);
    const result = executeOutputPreview(
      {
        content: [{ type: "text", text: "Execution handed off.\n\n" + message }],
        details: { exitCode: 0, handoff: message, backgroundJobs: [], images: [] },
      },
      false,
      false,
      theme,
      undefined,
      state,
    );
    const rendered = [...call.render(100), ...result.render(100)].join("\n");

    expect(rendered).toBe("↪ " + message);
    expect(rendered.split(message)).toHaveLength(2);
  });

  test("execute completion labels use structured outcomes and never infer false success", () => {
    const render = (details: unknown, isError = false) =>
      executeOutputPreview(
        { content: [{ type: "text", text: "Execution completed." }], details },
        false,
        isError,
        theme,
        "work()",
      )
        .render(80)[0]
        .trimEnd();
    expect(render({ exitCode: 0 })).toBe("✓ Action");
    expect(render({ handoff: "continue later" })).toBe("↪ continue later");
    expect(render({ exitCode: 9 })).toBe("✗ Action — exit 9");
    expect(
      executeOutputPreview(
        { content: [{ type: "text", text: "Execution failed with exit code 17." }], details: { exitCode: 17 } },
        false,
        false,
        theme,
        'await shell("exit 17")',
      )
        .render(80)[0]
        .trimEnd(),
    ).toBe("✗ Action — exit 17");
    expect(render({ exitCode: 0, cancelled: true })).toBe("✗ Action — cancelled");
    expect(render({ exitCode: 0, timedOut: true })).toBe("✗ Action — timed out");
    expect(render(undefined)).toBe("? Action — Outcome unknown");
    expect(render({}, true)).toBe("✗ Action — failed");
  });

  test("execute error flag takes precedence over handoff success", () => {
    const row = executeOutputPreview(
      { content: [{ type: "text", text: "Execution failed." }], details: { handoff: "later" } },
      false,
      true,
      theme,
    ).render(80)[0];
    expect(row).toBe("✗ Action — failed");
  });

  test("failed execute summaries retain failure status", () => {
    const failure = executeOutputPreview(
      { content: [{ type: "text", text: "Execution failed with exit code 2.\n\nstderr:\nBAD" }] },
      false,
      true,
      theme,
      "throw new Error()",
    ).render(100);
    expect(failure).toHaveLength(1);
    expect(failure[0]).toBe("✗ Action — BAD");
  });

  test("collapsed execute keeps useful failure and save warning on the action row, but no truncation notice", () => {
    const label = "Run checks";
    for (const [details, reason] of [
      [{ exitCode: 1 }, "exit 1"],
      [{ timedOut: true }, "timed out"],
      [{ cancelled: true }, "cancelled"],
    ] as const) {
      expect(
        executeOutputPreview({ ...success, details }, false, false, theme, code, undefined, 0, label).render(80)[0],
      ).toBe("✗ Run checks — " + reason);
    }
    expect(
      executeOutputPreview({ ...success, details: {} }, false, false, theme, code, undefined, 0, label).render(80)[0],
    ).toBe("? Run checks — Outcome unknown");
    for (const handoff of [undefined, "Work continues"]) {
      const result = {
        ...success,
        details: { exitCode: 0, handoff, stdoutLost: true, outputArtifactErrors: { stdout: "disk full" } },
      };
      const rows = executeOutputPreview(result, false, false, theme, code, undefined, 0, label).render(80);
      expect(rows[0]).toBe("✓ Run checks — ⚠ couldn’t save full output");
      expect(rows.join("\n")).not.toContain("truncated");
      if (handoff) expect(rows[1]).toBe("↪ Work continues");
    }
  });
});

describe("execute content, labels and layout", () => {
  test("action labels replace source only in collapsed previews and sanitize plain text", () => {
    const label = "\x1b[31mRead\x1b[0m\n task UI\u0007";
    expect(executeInputPreview(code, false, theme, undefined, 0, label).render(100)).toEqual(["⠋ Read task UI"]);
    expect(executeOutputPreview(success, false, false, theme, code, undefined, 0, label).render(100)).toEqual([
      "✓ Read task UI",
    ]);
    for (const absent of [undefined, null, 12, " ", "\x1b[31m\x1b[0m"]) {
      expect(executeOutputPreview(success, false, false, theme, code, undefined, 0, absent).render(120)).toEqual(
        executeOutputPreview(success, false, false, theme, code).render(120),
      );
    }
    const expanded = executeOutputPreview(success, true, false, theme, code, undefined, 0, label)
      .render(120)
      .join("\n");
    expect(expanded).toContain(code);
    expect(expanded).toContain("stdout:");
    expect(expanded).not.toContain("Read task UI");
  });

  test("execute previews apply configurable horizontal padding and deduct it from content width", () => {
    for (const padding of [0, 1, 2]) {
      const call = executeInputPreview("x".repeat(80), false, theme, undefined, padding).render(12);
      const result = executeOutputPreview(success, false, false, theme, "x".repeat(80), undefined, padding).render(12);
      for (const row of [...call, ...result]) {
        expect(row.startsWith(" ".repeat(padding))).toBe(true);
        expect(visibleWidth(row)).toBeLessThanOrEqual(12);
      }
      expect(stripTerminalSequences(call[0]).slice(padding)).toStartWith("⠋");
      expect(stripTerminalSequences(result[0]).slice(padding)).toStartWith("✓");
    }
  });

  test("expanded execute keeps source/result grouping inside configured padding", () => {
    const rows = executeOutputPreview(success, true, false, theme, code, undefined, 2).render(32);
    expect(rows.some((row) => row.trim().length === 0)).toBe(true);
    for (const row of rows) expect(row.startsWith("  ")).toBe(true);
    expect(rows.map((row) => row.slice(2)).join("\n")).toContain("stdout:");
  });

  test("expanded execute includes the full command and output", () => {
    const rendered = executeOutputPreview(success, true, false, theme, code)
      .render(100)
      .map((row) => row.trimEnd())
      .join("\n");
    expect(rendered).toContain('console.log("first")');
    expect(rendered).toContain('console.log("last")');
    expect(rendered).toContain("stdout:");
    expect(rendered).toContain("first\nlast");
  });

  test("image counts stay hidden collapsed and images remain represented by Pi content", () => {
    const rendered = executeOutputPreview(
      { content: [{ type: "image" }], details: { exitCode: 0, stdout: "", stderr: "", images: [{}] } },
      false,
      false,
      theme,
      "showImage()",
    ).render(80);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toBe("✓ Action");
  });

  test("collapsed execute hides truncation, image, background counts and raw source", () => {
    const result = {
      content: [{ type: "text", text: "Execution completed." }, { type: "image" }],
      details: { exitCode: 0, stdoutLost: true, stderrLost: true, images: [{}], backgroundJobs: ["a", "b"] },
    };
    const row = executeOutputPreview(
      result,
      false,
      false,
      theme,
      "LONG_COMMAND_SUFFIX".repeat(20),
      undefined,
      0,
      "Read output",
    ).render(82)[0];
    expect(row).toBe("✓ Read output");
    expect(result.content[1].type).toBe("image");
  });

  test("collapsed execute hides truncation marker and output-file counts", () => {
    const result = {
      ...success,
      details: {
        exitCode: 0,
        stdoutLost: true,
        stderrLost: true,
        stdoutPath: "/tmp/stdout",
        stderrPath: "/tmp/stderr",
      },
    };
    expect(executeOutputPreview(result, false, false, theme, code).render(160)).toEqual(["✓ Action"]);
  });
});

test("execute tool wiring supplies configured padding to call and result renderers", () => {
  const context = {
    args: { code },
    cwd: "/fixture",
    expanded: false,
    executionStarted: true,
    isError: false,
    state: {},
  };
  type PreviewTool = {
    renderCall(args: typeof context.args, renderTheme: typeof theme, renderContext: typeof context): Component;
    renderResult(
      result: typeof success,
      options: { expanded: boolean },
      renderTheme: typeof theme,
      renderContext: typeof context,
    ): Component;
  };
  let tool: PreviewTool | undefined;
  registerExecuteTool(
    {
      on() {},
      registerTool(definition: unknown) {
        tool = definition as PreviewTool;
      },
    } as unknown as ExtensionAPI,
    undefined,
    undefined,
    () => 2,
  );
  if (!tool) throw new Error("execute tool was not registered");
  expect(tool.renderCall(context.args, theme, context).render(80)[0]).toStartWith("  ⠋");
  expect(tool.renderResult(success, { expanded: false }, theme, context).render(80)[0]).toStartWith("  ✓ Action");
});

describe("task completion and attention previews", () => {
  test("task completion and attention collapse to recognizable summaries without output", () => {
    const content = "1 asynchronous task completed.\ntask_1 completed\nFinal output preview:\nSECRET_OUTPUT";
    const complete = completionPreview(content, false, theme, 0, "task-complete", {
      tasks: [{ id: "task_1", status: "completed", exitCode: 0 }],
    }).render(100);
    expect(complete.map((line) => line.trimEnd())).toEqual(["✓ task_1"]);
    expect(complete.join("\n")).not.toContain("SECRET_OUTPUT");
    const attention = completionPreview(
      "task_2 needs a progress checkpoint.\nSECRET_PROGRESS",
      false,
      theme,
      0,
      "task-attention",
      {
        attention: [{ id: "task_2" }],
      },
    ).render(100);
    expect(attention).toEqual([]);
    expect(attention.join("\n")).not.toContain("SECRET_PROGRESS");
  });

  test("routine attention previews are hidden without removing expanded checkpoint evidence", () => {
    const details = {
      attention: [
        { id: "task_a", reasons: ["quiet"], quietForMs: 300_999, elapsedMs: 420_000 },
        { id: "task_b", reasons: ["review"], elapsedMs: 600_000 },
        { id: "task_c", reasons: ["quiet", "review"], quietForMs: 600_000, elapsedMs: 1_200_000 },
      ],
      omittedAttention: 2,
    };
    const evidence = "Long checkpoint request\nSECRET_PROGRESS";
    expect(completionPreview(evidence, false, theme, 0, "task-attention", details).render(200)).toEqual([]);
    expect(
      completionPreview(evidence, true, theme, 0, "task-attention", details)
        .render(200)
        .map((row) => row.trimEnd())
        .join("\n"),
    ).toBe(evidence);
    expect(completionPreview(evidence, false, theme, 0, "task-attention").render(200)).toEqual([]);
  });

  test("attention notices use normal terminal color without weakening failures", () => {
    const colors: string[] = [];
    const trackingTheme = {
      fg: (color: string, text: string) => {
        colors.push(color);
        return text;
      },
    } as any;
    const content = "task_2 needs a progress checkpoint.\nProgress details";
    for (const expanded of [false, true]) {
      colors.length = 0;
      const rows = completionPreview(content, expanded, trackingTheme, 0, "task-attention").render(100);
      if (expanded) expect(rows.join("\n")).toContain("task_2 needs a progress checkpoint");
      else expect(rows).toEqual([]);
      expect(colors).not.toContain("warning");
    }
    colors.length = 0;
    const mixed = completionPreview("tasks updated", false, trackingTheme, 0, "task-complete", {
      tasks: [{ id: "task_bad", status: "failed" }],
      attention: [{ id: "task_waiting" }],
      omittedAttention: 1,
    }).render(100);
    expect(mixed[0]).not.toContain("Task check");
    expect(mixed[0]).not.toContain("more checks");
    expect(colors).toContain("error");
    expect(colors).not.toContain("warning");
  });

  test("failed task summaries retain failure status", () => {
    const failedTask = completionPreview("1 asynchronous task completed.\noutput", false, theme, 0, "task-complete", {
      tasks: [{ id: "task_bad", status: "failed", exitCode: 7 }],
    }).render(100);
    expect(failedTask[0].trimEnd()).toBe("✗ task_bad — exit 7");
  });

  test("task titles are explicit metadata, not inferred source, and status is only finished", () => {
    const tasks = [
      { id: "task_a", title: "\x1b[31mRead\x1b[0m\n renderer", status: "completed" },
      { id: "task_b", title: "Run checks", status: "failed" },
      { id: "task_c", title: " ", status: "killed" },
      { id: "task_d", title: "Slow check", status: "killed", timedOut: true },
      { id: "task_e", title: "Uncertain", status: "mystery" },
    ];
    expect(
      completionPreview("full evidence", false, theme, 0, "task-complete", { tasks }).render(200)[0].trimEnd(),
    ).toBe(
      "✓ Read renderer, ✗ Run checks — failed, ⊘ task_c — cancelled, ✗ Slow check — timed out, ? Uncertain — status unknown",
    );
    expect(
      completionPreview("full evidence", true, theme, 0, "task-complete", { tasks }).render(200)[0].trimEnd(),
    ).toBe("full evidence");
  });

  test("mixed completion batches preserve order and color each task outcome", () => {
    const colored = { fg: (color: string, text: string) => "<" + color + ">" + text + "</" + color + ">" } as any;
    const row = completionPreview("3 asynchronous tasks completed.", false, colored, 0, "task-complete", {
      tasks: [
        { id: "task_a", status: "completed", exitCode: 0 },
        { id: "task_b", status: "failed", exitCode: 2 },
        { id: "task_c", status: "completed", exitCode: 0 },
      ],
    }).render(200)[0];
    expect(row).toContain("<success>✓ task_a</success>, <error>✗ task_b — exit 2</error>, <success>✓ task_c</success>");
  });

  test("all-success legacy task details keep original order without risk markers", () => {
    const row = stripTerminalSequences(
      completionPreview("ignored", false, theme, 0, "task-complete", {
        tasks: [
          { id: "a", status: "completed" },
          { id: "b", status: "completed" },
        ],
      }).render(80)[0],
    );
    expect(row.trimEnd()).toBe("✓ a, ✓ b");
  });

  test("legacy or incomplete completion metadata renders unknown rather than success", () => {
    for (const details of [undefined, {}, { tasks: [{ id: "old" }] }, { tasks: [], omittedTasks: 1 }]) {
      const row = completionPreview("Task update", false, theme, 0, "task-complete", details).render(80)[0];
      expect(row).toStartWith("?");
      expect(row).not.toStartWith("✓");
    }
  });

  test("truncated completion rows reserve leading failure and uncertainty markers", () => {
    const long = "A very long successful task title " + "x".repeat(100);
    const details = {
      tasks: [
        { id: "first", title: long, status: "completed" },
        { id: "later", status: "failed" },
        { id: "uncertain", status: "unknown" },
      ],
    };
    const row = completionPreview("update", false, theme, 0, "task-complete", details).render(30)[0];
    expect(stripTerminalSequences(row)).toStartWith("✗? ");
    expect(visibleWidth(row)).toBeLessThanOrEqual(30);
    expect(
      stripTerminalSequences(completionPreview("update", false, theme, 0, "task-complete", details).render(1)[0]),
    ).toBe("✗");
    expect(
      stripTerminalSequences(completionPreview("update", false, theme, 0, "task-complete", details).render(2)[0]),
    ).toStartWith("✗?");
  });

  test("omitted cancellations are reported separately and unknown aggregate omissions stay visible", () => {
    const details = {
      tasks: Array.from({ length: 50 }, (_, i) => ({ id: "ok" + i, status: "completed" })),
      taskStatusCounts: { completed: 50, failed: 0, killed: 1, running: 0, unknown: 1 },
      omittedTasks: 2,
    };
    const row = stripTerminalSequences(completionPreview("", false, theme, 0, "task-complete", details).render(300)[0]);
    expect(row).toContain("1 more tasks cancelled");
    expect(row).toContain("1 more tasks unresolved");
    expect(row).not.toContain("more tasks failed");
  });

  test("long titles cannot hide remote actionable, cancelled, unknown, or legacy omitted outcomes", () => {
    const title = "success " + "x".repeat(100);
    for (const details of [
      {
        tasks: [{ title, status: "completed" }],
        remote: [
          { taskId: "f", state: "cancelled" },
          { taskId: "u", state: "unknown" },
        ],
      },
      {
        tasks: [{ title, status: "completed" }],
        remote: [
          { taskId: "a", state: "running", actionable: true },
          { taskId: "u", state: "unknown" },
        ],
      },
      { tasks: [{ title, status: "completed" }], omittedTasks: 2 },
    ]) {
      const row = stripTerminalSequences(
        completionPreview("", false, theme, 0, "task-complete", details).render(24)[0],
      );
      expect(row).toStartWith(details.remote?.some((item) => item.state === "cancelled") ? "⊘? " : "? ");
      expect(visibleWidth(row)).toBeLessThanOrEqual(24);
    }
  });

  test("mixed failure and attention indicators precede truncatable descriptions", () => {
    const row = completionPreview("A deliberately long completion description", false, theme, 0, "task-complete", {
      tasks: [{ id: "task_bad", status: "failed", signal: "SIGTERM" }],
      attention: [{ id: "task_waiting" }],
    }).render(80)[0];
    expect(row.trimEnd()).toBe("✗ task_bad — failed");
    expect(visibleWidth(row)).toBeLessThanOrEqual(80);
  });

  test("SSH fallback keeps actionable, cancelled and unknown states visible without inferring success", () => {
    const trackingTheme = { fg: (color: string, text: string) => "<" + color + ">" + text + "</" + color + ">" } as any;
    const details = {
      remote: [
        { taskId: "x", state: "done" },
        { taskId: "y", state: "cancelled" },
        { taskId: "z", state: "unknown" },
        { taskId: "q", state: "running", actionable: "grant requested" },
        { taskId: "invalid/ID", state: "unknown" },
      ],
    };
    const row = completionPreview("Remote evidence", false, trackingTheme, 0, "task-attention", details).render(500)[0];
    expect(row).toContain("? ssh:eA — status unknown");
    expect(row).toContain("<error>⊘ ssh:eQ — cancelled</error>");
    expect(row).toContain("<warning>? ssh:eg — status unknown</warning>");
    expect(row).toContain("needs your input");
    expect(row).toContain("SSH task — status unknown");
    expect(row).not.toContain("<success>");
  });

  test("untrusted task metadata is sanitized before terminal coloring", () => {
    const row = completionPreview("Done", false, theme, 0, "task-complete", {
      tasks: [{ id: "safe\x1b[2J", status: "failed\x1b]0;bad\x07", signal: "SIG\x1b[31mTERM" }],
    }).render(120)[0];
    expect(row).toContain("safe");
    expect(row).not.toContain("\x1b");
    expect(stripTerminalSequences(row)).not.toContain("\x07");
  });
});

describe("completion diagnostic metadata", () => {
  test("full-batch diagnostics retain a failure omitted after the first 50 tasks", () => {
    const tasks = Array.from({ length: 51 }, (_, index) => ({
      id: "task_" + index,
      status: index === 50 ? "failed" : "completed",
      command: "true",
      output: "",
    })) as any;
    const details = completionDiagnosticDetails(tasks, []);
    expect(details.tasks).toHaveLength(50);
    expect(details.omittedTasks).toBe(1);
    expect(details.taskStatusCounts).toEqual({ completed: 50, failed: 1, killed: 0, running: 0, unknown: 0 });
    const row = completionPreview("51 asynchronous tasks completed.", false, theme, 0, "task-complete", details).render(
      32,
    )[0];
    expect(row.startsWith("✗ ")).toBe(true);
    expect(stripTerminalSequences(row)).toContain("1 more tasks failed");
    expect(visibleWidth(row)).toBeLessThanOrEqual(32);
  });

  test("capped diagnostic aggregates classify actual timeout separately from cancellation", () => {
    const tasks = Array.from({ length: 51 }, (_, index) => ({
      id: "task_" + index,
      kind: "command",
      command: "test",
      output: "",
      status: index === 50 ? "killed" : "completed",
      timedOut: index === 50,
    })) as any;
    const details = completionDiagnosticDetails(tasks, []);
    expect(details.taskStatusCounts).toEqual({ completed: 50, failed: 1, killed: 0, running: 0, unknown: 0 });
    const rendered = completionPreview("", false, theme, 0, "task-complete", details).render(500).join("\n");
    expect(rendered).toContain("✗ 1 more tasks failed");
    expect(rendered).not.toContain("more tasks cancelled");
  });

  test("attention callbacks keep real launch provenance without copying output or changing notification delivery facts", () => {
    const launchIdentity = { sourceSessionId: "/owner", sourceCallId: "original", callIndex: 3 };
    const details = completionDiagnosticDetails(
      [],
      [
        {
          id: "job",
          reasons: ["quiet"],
          observedAt: "now",
          elapsedMs: 12,
          quietForMs: 10,
          outputBytes: 20,
          stdinOpen: false,
          task: {
            launchIdentity: { ...launchIdentity, prompt: "not provenance", profile: "normal" },
            output: "private output",
          },
        } as any,
      ],
    );
    expect(details.attention[0]?.launchIdentity).toEqual(launchIdentity);
    expect(details.attention[0]?.id).toBe("job");
    expect(details.attentionCount).toBe(1);
    expect(JSON.stringify(details.attention)).not.toContain("private output");
    expect(JSON.stringify(details.attention)).not.toContain("not provenance");
  });
});

test("collapsed rows are control-safe and bounded at small widths", () => {
  const hostile = "safe\x1b[2J\x1b]0;bad\x07\n" + "x".repeat(1_000);
  const result = { content: [{ type: "text", text: "Execution completed.\n" + hostile }] };
  const before = JSON.stringify(result);
  for (const width of [1, 5, 20, 80]) {
    for (const lines of [
      executeInputPreview(hostile, false, theme).render(width),
      executeOutputPreview(result, false, false, theme, hostile).render(width),
      completionPreview(hostile, false, theme).render(width),
    ]) {
      expect(lines).toHaveLength(1);
      expect(visibleWidth(lines[0])).toBeLessThanOrEqual(width);
      expect(stripTerminalSequences(lines[0])).not.toContain("\x1b");
    }
  }
  expect(JSON.stringify(result)).toBe(before);
  expect(executeInputPreview("text", true, theme).render(0)).toEqual([]);
});
