import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { registerAgents, resolveProfile } from "../src/agents";
import { Jobs, registerJobs } from "../src/jobs";
import { registerRace } from "../src/race";
import { sdk } from "./sdk";

setDefaultTimeout(15000);
test("profile fields fall back independently and calls take precedence", () => {
  const parent = { model: "parent/model", thinking: "medium" };
  const config = { profiles: { fast: { thinking: "low" as const } } };
  expect(resolveProfile(config, "normal", parent, {})).toEqual(parent);
  expect(resolveProfile(config, "fast", parent, {})).toEqual({ model: parent.model, thinking: "low" });
  expect(resolveProfile(config, "fast", parent, { model: "override/model", thinking: "high" })).toEqual({
    model: "override/model",
    thinking: "high",
  });
});

test.each([false, true])("codemode starts a job, waits, and parses fake child agents (fast=%s)", async (fast) => {
  const previous = process.env.BRUV_PI_COMMAND;
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const previousFast = process.env.BRUV_FAST;
  process.env.BRUV_FAST = "1";
  process.env.BRUV_PI_COMMAND = resolve("tests/fixtures/pi-child.ts");
  const jobs = new Jobs();
  const app = await sdk([
    (pi) => {
      registerJobs(pi, jobs);
      registerAgents(pi, jobs, () => fast);
    },
  ]);
  process.env.PI_CODING_AGENT_DIR = app.dir;
  try {
    app.faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("codemode", {
          code: `
        const job = await tools.job_start({command: 'sleep 0.05; echo "fast=$BRUV_FAST"' , waitSeconds: 0});
        const result = await tools.wait({ids: [job.id], all: true});
        if (result.done[0].exitCode !== 0) throw new Error("job failed");
        const {ids} = await tools.agent({prompts: ["one", "two"], title: "Lint", model: "faux/selected", thinking: "low"});
        return await tools.wait({ids, all: true});`,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        const result = [...context.messages].reverse().find((message) => message.role === "toolResult");
        expect(result?.role === "toolResult" && result.isError).toBe(false);
        return fauxAssistantMessage("finished");
      },
    ]);
    await app.session.prompt("go");
    expect(jobs.list().map((item) => item.status)).toEqual(["done", "done", "done"]);
    // Agent settings stay out of plain commands; each agent in a batch gets its own title.
    expect(jobs.result(jobs.get("j1")).output).toBe("fast=\n");
    expect(jobs.list().map((item) => item.title)).toEqual([expect.any(String), "Lint 1", "Lint 2"]);
    for (const id of ["a1", "a2"]) {
      const result = jobs.result(jobs.get(id));
      expect(result.usage).toEqual({ input: 7, output: 3, cost: 0.3 });
      const answer = JSON.parse(result.answer as string);
      expect(answer.depth).toBe("1");
      expect(answer.fast).toBe(fast ? "1" : undefined);
      expect(answer.cwd).toBe(app.dir);
      expect(answer.args.slice(0, 2)).toEqual(["--mode", "json"]);
      expect(answer.args[answer.args.indexOf("--model") + 1]).toBe("faux/selected");
      expect(answer.args[answer.args.indexOf("--thinking") + 1]).toBe("low");
      expect(answer.separator).toBe("one\u2028two");
      expect(existsSync(result.sessionPath as string)).toBe(true);
    }
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.BRUV_PI_COMMAND;
    else process.env.BRUV_PI_COMMAND = previous;
    if (previousFast === undefined) delete process.env.BRUV_FAST;
    else process.env.BRUV_FAST = previousFast;
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
  }
});

test("child sessions do not register agent or race", async () => {
  const previous = process.env.BRUV_DEPTH;
  process.env.BRUV_DEPTH = "1";
  const app = await sdk([
    (pi) => {
      const jobs = new Jobs();
      registerRace(pi, jobs, registerAgents(pi, jobs));
    },
  ]);
  try {
    const names = app.session.getAllTools().map((tool) => tool.name);
    expect(names).not.toContain("agent");
    expect(names).not.toContain("race");
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.BRUV_DEPTH;
    else process.env.BRUV_DEPTH = previous;
  }
});
