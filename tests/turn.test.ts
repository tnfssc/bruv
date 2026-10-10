import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { registerAgents } from "../src/agents";
import { Jobs, registerJobs } from "../src/jobs";
import { registerTurn, type TurnSummary } from "../src/turn";
import type { PlanUsage } from "../src/usage";
import { sdk } from "./sdk";

test("summary renders only positive counts and durations of at least one second", async () => {
  initTheme("dark", false);
  const app = await sdk([(pi) => registerTurn(pi, new Jobs(), () => undefined)]);
  try {
    const runner = app.session.extensionRunner;
    const renderer = runner.getEntryRenderer("bruv-turn");
    expect(renderer).toBeDefined();
    for (const [data, numbers] of [
      [{ scripts: 2, calls: 3, agents: 0, elapsedSeconds: 0 }, [2, 3]],
      [{ scripts: 0, calls: 3, agents: 0, elapsedSeconds: 0.999, weekPercent: 0 }, [3]],
      [{ scripts: 2, calls: 0, agents: 4, elapsedSeconds: 1, weekPercent: 5 }, [2, 4, 1, 5]],
      [{ scripts: 0, calls: 0, agents: 0, elapsedSeconds: 0 }, []],
    ] satisfies [TurnSummary, number[]][]) {
      const rows = renderer?.(
        { type: "custom", customType: "bruv-turn", id: "summary", parentId: null, timestamp: "", data },
        { expanded: false },
        runner.createContext().ui.theme,
      )?.render(200);
      const text = stripVTControlCharacters(rows?.join("") ?? "").trim();
      expect(text ? text.split(" · ").map(Number.parseFloat) : []).toEqual(numbers);
    }
  } finally {
    await app.close();
  }
});

test("one summary counts scripts, nested calls and agents across continuations without entering context", async () => {
  const previous = process.env.BRUV_PI_COMMAND;
  process.env.BRUV_PI_COMMAND = resolve("tests/fixtures/pi-child.ts");
  const jobs = new Jobs();
  const usage: PlanUsage = {
    plan_type: "test",
    rate_limits: {
      limit_reached: false,
      primary: null,
      secondary: { used_percent: 10, reset_at: 9999999999, window_minutes: 10080 },
    },
    credits: { has_credits: false, unlimited: false, balance: null },
  };
  let continued = false;
  const app = await sdk([
    (pi) => {
      registerJobs(pi, jobs);
      registerAgents(pi, jobs);
      registerTurn(pi, jobs, () => usage);
      pi.on("agent_before_settle", () => {
        if (!continued) {
          continued = true;
          return {
            entries: [
              { type: "custom_message" as const, customType: "test-continue", content: "next step", display: false },
            ],
            continue: true,
          };
        }
      });
    },
  ]);
  const summaries = () =>
    app.session.sessionManager
      .getBranch()
      .filter((entry) => entry.type === "custom" && entry.customType === "bruv-turn");
  const script = (code: string) => fauxAssistantMessage(fauxToolCall("codemode", { code }), { stopReason: "toolUse" });
  try {
    app.faux.setResponses([
      script('const {ids} = await tools.agent({prompts:["one","two"]}); return await tools.wait({ids,all:true});'),
      fauxAssistantMessage("first"),
      script('return await tools.bash({command:"true"});'),
      () => {
        if (usage.rate_limits.secondary) usage.rate_limits.secondary.used_percent = 12;
        return fauxAssistantMessage("last");
      },
    ]);
    await app.session.prompt("go");
    expect(summaries()).toHaveLength(1);
    const entry = summaries()[0];
    if (entry.type !== "custom") throw new Error("Missing summary");
    expect(entry.data).toEqual({
      scripts: 2,
      calls: 3,
      agents: 2,
      elapsedSeconds: expect.any(Number),
      weekPercent: 2,
    } satisfies TurnSummary);
    await app.session.extensionRunner.emit({ type: "agent_settled", aborted: false });
    expect(summaries()).toHaveLength(1);
    app.faux.setResponses([
      (context) => {
        expect(context.messages.some((message) => JSON.stringify(message).includes("bruv-turn"))).toBe(false);
        expect(context.messages.some((message) => JSON.stringify(message).includes("weekPercent"))).toBe(false);
        return fauxAssistantMessage("hello");
      },
    ]);
    await app.session.prompt("next");
    expect(summaries()).toHaveLength(1);
    const runner = app.session.extensionRunner;
    await runner.emit({ type: "agent_start" });
    await runner.emit({
      type: "tool_execution_start",
      toolName: "codemode",
      toolCallId: "aborted",
      args: { code: "" },
    });
    await runner.emit({ type: "agent_settled", aborted: true });
    expect(summaries()).toHaveLength(1);
    await runner.emit({ type: "agent_start" });
    await runner.emit({
      type: "tool_execution_start",
      toolName: "bash",
      toolCallId: "direct",
      args: { command: "true" },
    });
    if (usage.rate_limits.secondary) usage.rate_limits.secondary.reset_at++;
    await runner.emit({ type: "agent_settled", aborted: false });
    expect(summaries()).toHaveLength(2);
    const second = summaries()[1];
    expect(second.type === "custom" && second.data).toEqual({
      scripts: 0,
      calls: 1,
      agents: 0,
      elapsedSeconds: expect.any(Number),
    });
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.BRUV_PI_COMMAND;
    else process.env.BRUV_PI_COMMAND = previous;
  }
});
