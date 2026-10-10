import { expect, spyOn, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { agentParser } from "../src/agents";
import { Jobs, registerJobs } from "../src/jobs";
import { setStatus } from "../src/status";
import { registerUI } from "../src/ui";
import { sdk } from "./sdk";

test.each(["tui", "rpc", "print"] as const)("board follows mode and stops its timer (%s)", async (mode) => {
  initTheme("dark", false);
  const jobs = new Jobs();
  let board: (Component & { dispose?: () => void }) | undefined;
  let renders = 0;
  let widgets = 0;
  const statuses = new Map<string, string | undefined>();
  const working: (string | undefined)[] = [];
  const timers = spyOn(globalThis, "setInterval");
  const cleared = spyOn(globalThis, "clearInterval");
  const app = await sdk(
    [
      (pi) => {
        registerUI(pi, jobs);
        registerJobs(pi, jobs);
      },
    ],
    {
      setStatus: (key, text) => {
        statuses.set(key, text);
      },
      setWorkingMessage: (message) => {
        working.push(message);
      },
      setWidget: (_key, content) => {
        widgets++;
        board =
          typeof content === "function"
            ? content({ requestRender: () => renders++ } as never, app.session.extensionRunner.createContext().ui.theme)
            : undefined;
      },
    },
    undefined,
    mode,
  );
  try {
    const runner = app.session.extensionRunner;
    await runner.emit({
      type: "tool_execution_start",
      toolName: "wait",
      toolCallId: "w1",
      args: { ids: ["a1", "a2"] },
    });
    await runner.emit({ type: "tool_execution_start", toolName: "wait", toolCallId: "w2", args: { ids: ["j1"] } });
    await runner.emit({ type: "tool_execution_end", toolName: "wait", toolCallId: "w1", result: {}, isError: true });
    if (mode === "tui") {
      expect(working[0]?.match(/a[12]/g)).toHaveLength(2);
      expect(working.at(-1)?.match(/j1/g)).toHaveLength(1);
    }
    await runner.emit({ type: "tool_execution_end", toolName: "wait", toolCallId: "w2", result: {}, isError: false });
    if (mode === "tui") expect(working.at(-1)).toBeUndefined();
    else expect(working).toEqual([]);
    const before = timers.mock.calls.length;
    const item = jobs.create("agent", "界".repeat(100), app.dir);
    const parser = agentParser(jobs, item);
    parser.push(`${JSON.stringify({ type: "tool_execution_start", toolName: "read" })}\n`);
    parser.push(`${JSON.stringify({ type: "message_update", usage: { input: 2, output: 3 } })}\n`);
    expect(item.progress).toBe("read");
    expect(item.tokens).toBe(5);
    if (mode === "tui") {
      expect(timers.mock.calls.length).toBe(before + 1);
      const timer = timers.mock.results.at(-1)?.value;
      const tick = timers.mock.calls.at(-1)?.[0] as () => void;
      const previous = renders;
      tick();
      expect(renders).toBe(previous + 1);
      expect(board?.render(30)).toHaveLength(1);
      expect(visibleWidth((board as Component).render(30)[0])).toBeLessThanOrEqual(30);
      await jobs.run(item, async () => 0);
      expect(cleared.mock.calls.some(([value]) => value === timer)).toBe(true);
      expect(board?.render(80)).toHaveLength(1);
      for (const part of ["goal", "fast", "usage"] as const) setStatus(runner.createContext(), part, part);
      expect([...statuses.keys()]).toEqual(["bruv"]);
      expect(statuses.get("bruv")?.split(" · ").slice(0, 3)).toEqual(["usage", "fast", "goal"]);
      setStatus(runner.createContext(), "fast", undefined);
      expect(statuses.get("bruv")?.split(" · ")).toHaveLength(3);
      app.faux.setResponses([fauxAssistantMessage("ready")]);
      await app.session.prompt("next");
      expect(board).toBeUndefined();
    } else {
      await jobs.run(item, async () => 0);
      expect(widgets).toBe(0);
      expect(timers.mock.calls.length).toBe(before);
    }
  } finally {
    for (const item of jobs.items.values()) if (item.status === "running") await jobs.run(item, async () => 0);
    await app.close();
    expect(statuses.get("bruv")).toBeUndefined();
    timers.mockRestore();
    cleared.mockRestore();
  }
});
