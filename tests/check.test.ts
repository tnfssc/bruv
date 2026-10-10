import { expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { registerAgents } from "../src/agents";
import { type Checker, registerCheck } from "../src/check";
import { readConfig, saveConfig } from "../src/config";
import type { FinishResult } from "../src/finish";
import { registerFinish } from "../src/finish";
import { type Goal, registerGoal } from "../src/goal";
import { Jobs, registerJobs } from "../src/jobs";
import type { Receipt } from "../src/receipt";
import { registerSettle } from "../src/settle";
import { registerTurn } from "../src/turn";
import { sdk } from "./sdk";

setDefaultTimeout(15000);
const finish = () =>
  fauxAssistantMessage([fauxText("reply-781"), fauxToolCall("finish", { status: "done" })], { stopReason: "toolUse" });
const answer = (gaps: string[] = []) =>
  `\`\`\`json\n${JSON.stringify({ verdict: gaps.length ? "gaps" : "pass", checked: ["used-781"], gaps })}\n\`\`\``;
async function setup(repo = true) {
  mkdirSync(".tmp", { recursive: true });
  const dir = mkdtempSync(resolve(".tmp/check-"));
  const cwd = join(dir, "project");
  mkdirSync(join(cwd, ".tmp"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
  if (repo) {
    git("init", "-q");
    writeFileSync(join(cwd, "file.txt"), "initial-781\n");
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "Initial");
    writeFileSync(join(cwd, "file.txt"), "before-781\n");
    git("add", "file.txt");
    writeFileSync(join(cwd, "existing.txt"), "preexisting-781\n");
  }
  saveConfig({ keepGoing: "on" }, dir);
  const previous = process.env.BRUV_PI_COMMAND;
  process.env.BRUV_PI_COMMAND = resolve("tests/fixtures/pi-child.ts");
  const jobs = new Jobs();
  let check: Checker;
  const app = await sdk(
    [
      (pi) => {
        registerSettle(pi, jobs, () => hasFinished());
        registerJobs(pi, jobs);
        const goal = registerGoal(pi, () => hasFinished());
        check = registerCheck(pi, jobs, registerAgents(pi, jobs), dir, goal);
        const summary = registerTurn(pi, jobs, () => undefined);
        const hasFinished = registerFinish(pi, dir, check, () => !!goal.active(), summary);
      },
    ],
    undefined,
    cwd,
  );
  const children = () => [...jobs.items.values()];
  const args = () =>
    JSON.parse(readFileSync(children()[0].sessionPath as string, "utf8").split("\n")[0]).args as string[];
  return {
    ...app,
    cwd,
    git,
    jobs,
    children,
    args,
    check: () => check.report(),
    fixture: (value: object) => writeFileSync(join(cwd, ".tmp/checker.json"), JSON.stringify(value)),
    change: () => {
      writeFileSync(join(cwd, "file.txt"), "after-781\n");
      writeFileSync(join(cwd, "new.txt"), "new-781\n");
    },
    async close() {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
      if (previous === undefined) delete process.env.BRUV_PI_COMMAND;
      else process.env.BRUV_PI_COMMAND = previous;
    },
    receipts: () =>
      app.session.sessionManager
        .getBranch()
        .flatMap((entry) =>
          entry.type === "message" &&
          entry.message.role === "toolResult" &&
          (entry.message.details as FinishResult)?.receipt
            ? [(entry.message.details as FinishResult).receipt as Receipt]
            : [],
        ),
    goal: () => {
      const entry = app.session.sessionManager
        .getBranch()
        .reverse()
        .find((e) => e.type === "custom" && e.customType === "bruv-goal");
      return entry?.type === "custom" ? (entry.data as Goal) : undefined;
    },
    async command(command: string) {
      const settled = Promise.withResolvers<void>();
      const unsubscribe = app.session.subscribe((event) => {
        if (event.type === "agent_settled") settled.resolve();
      });
      try {
        await app.session.prompt(command);
        await settled.promise;
      } finally {
        unsubscribe();
      }
    },
    configDir: dir,
  };
}

test("finish checks only the request, final reply and changes using the parent model and thinking", async () => {
  const app = await setup();
  try {
    app.session.setThinkingLevel("high");
    app.faux.setResponses([
      () => {
        app.change();
        return fauxAssistantMessage("private-parent-781");
      },
      finish(),
    ]);
    const request = "request-781\n  preserve spacing é";
    await app.session.prompt(request);
    expect(app.faux.state.callCount).toBe(2);
    expect(app.children()).toHaveLength(1);
    expect(app.children()[0]).toMatchObject({ kind: "agent", status: "done", seen: true });
    const args = app.args();
    const prompt = JSON.parse(args.at(-1) as string);
    expect(Object.keys(prompt).sort()).toEqual(["diff", "messages", "reply"]);
    expect(prompt.messages).toEqual([request]);
    expect(prompt.reply).toBe("reply-781");
    expect(prompt.diff).toContain("-before-781");
    expect(prompt.diff).toContain("+after-781");
    expect(prompt.diff).toContain("+new-781");
    expect(prompt.diff).not.toContain("preexisting-781");
    expect(JSON.stringify(args)).not.toContain("private-parent-781");
    expect(args[args.indexOf("--model") + 1]).toBe(`${app.faux.getModel().provider}/${app.faux.getModel().id}`);
    expect(args[args.indexOf("--thinking") + 1]).toBe(app.session.thinkingLevel);
    for (const flag of ["--no-extensions", "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-mcp"])
      expect(args).toContain(flag);
    expect(app.git("diff", "--cached", "--numstat").trim()).toBe("1\t1\tfile.txt");
    expect(app.check()).toMatchObject({
      checked: ["used-781"],
      gaps: [],
      failed: false,
      changes: { files: 2, added: 2, removed: 1 },
    });
  } finally {
    await app.close();
  }
});

test("two gaps continue, the third finish accepts them, and a new message resets checks", async () => {
  const app = await setup();
  try {
    app.fixture({ answer: answer(["missing-781"]) });
    app.faux.setResponses([
      () => {
        app.change();
        return finish();
      },
      () => {
        expect(app.check()).toBeUndefined();
        expect(app.children()).toHaveLength(1);
        return finish();
      },
      () => {
        expect(app.check()).toBeUndefined();
        expect(app.children()).toHaveLength(2);
        return finish();
      },
    ]);
    await app.session.prompt("request-781");
    expect(app.faux.state.callCount).toBe(3);
    expect(app.children()).toHaveLength(2);
    expect(app.check()?.gaps).toEqual(["missing-781"]);
    expect(app.receipts()[0].gaps).toEqual(["missing-781"]);
    app.fixture({ answer: answer() });
    app.faux.setResponses([
      () => {
        writeFileSync(join(app.cwd, "new.txt"), "again-781\n");
        return finish();
      },
    ]);
    await app.session.prompt("second-781");
    expect(app.children()).toHaveLength(3);
    expect(app.check()?.gaps).toEqual([]);
  } finally {
    await app.close();
  }
});

test.each(["unchanged", "off", "nonrepo", "need_you"])("%s skips the checker", async (kind) => {
  const app = await setup(kind !== "nonrepo");
  try {
    if (kind === "off") {
      await app.session.prompt("/check off");
      expect(readConfig(app.configDir)).toMatchObject({ checkWork: false, keepGoing: "on" });
    }
    app.faux.setResponses([
      () => {
        if (kind !== "unchanged") app.change();
        return kind === "need_you"
          ? fauxAssistantMessage(fauxToolCall("finish", { status: "need_you" }), { stopReason: "toolUse" })
          : finish();
      },
    ]);
    // Stop Git searching above this test directory for the non-repository case.
    const previous = process.env.GIT_CEILING_DIRECTORIES;
    if (kind === "nonrepo") process.env.GIT_CEILING_DIRECTORIES = app.cwd;
    try {
      await app.session.prompt("go");
    } finally {
      if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
      else process.env.GIT_CEILING_DIRECTORIES = previous;
    }
    expect(app.children()).toHaveLength(0);
    expect(app.faux.state.callCount).toBe(1);
    expect(app.check()).toBeUndefined();
  } finally {
    await app.close();
  }
});

test.each([{ fail: true }, { answer: "invalid-781" }, { answer: "```json\n{}\n```" }])(
  "checker failure accepts finish: %j",
  async (fixture) => {
    const app = await setup();
    try {
      app.fixture(fixture);
      app.faux.setResponses([
        () => {
          app.change();
          return finish();
        },
      ]);
      await app.session.prompt("go");
      expect(app.faux.state.callCount).toBe(1);
      expect(app.check()?.failed).toBe(true);
      expect(app.receipts()[0].failed).toBe(true);
    } finally {
      await app.close();
    }
  },
);

test("moving HEAD alone starts a check and a large diff is capped", async () => {
  const app = await setup();
  try {
    app.faux.setResponses([
      () => {
        app.git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "Move");
        return finish();
      },
    ]);
    await app.session.prompt("go");
    expect(app.children()).toHaveLength(1);
    app.faux.setResponses([
      () => {
        writeFileSync(join(app.cwd, "large.txt"), "line\n".repeat(20000));
        return finish();
      },
    ]);
    await app.session.prompt("more");
    const args = JSON.parse(readFileSync(app.children()[1].sessionPath as string, "utf8")).args;
    expect(JSON.parse(args.at(-1)).diff).toHaveLength(40000);
  } finally {
    await app.close();
  }
});

test("abort during the check stops its child and does not accept finish", async () => {
  const app = await setup();
  try {
    app.fixture({ hang: true });
    const started = Promise.withResolvers<void>();
    app.jobs.listeners.add(() => {
      if (app.children().length) started.resolve();
    });
    app.faux.setResponses([
      () => {
        app.change();
        return finish();
      },
    ]);
    const run = app.session.prompt("go");
    await started.promise;
    await app.session.abort();
    await run;
    expect(app.children()[0]).toMatchObject({ stopped: true, status: "stopped" });
    expect(app.check()).toBeUndefined();
    expect(app.faux.state.callCount).toBe(1);
  } finally {
    await app.close();
  }
});

test("accepted checks appear once in finish results and replace the turn entry", async () => {
  const app = await setup();
  try {
    app.faux.setResponses([
      () => {
        app.change();
        return finish();
      },
    ]);
    await app.session.prompt("receipt-request-781");
    expect(app.receipts()).toHaveLength(1);
    expect(app.receipts()[0]).toMatchObject({
      asked: "receipt-request-781",
      calls: 1,
      agents: 1,
      checked: ["used-781"],
    });
    expect(
      app.session.sessionManager
        .getBranch()
        .some((entry) => entry.type === "custom" && entry.customType === "bruv-turn"),
    ).toBe(false);
    expect(
      app.session.sessionManager
        .getBranch()
        .some((entry) => entry.type === "custom" && entry.customType === "bruv-receipt"),
    ).toBe(false);
    app.faux.setResponses([finish()]);
    await app.session.prompt("next");
    expect(app.receipts()).toHaveLength(1);
    expect(
      app.session.sessionManager
        .getBranch()
        .filter((entry) => entry.type === "custom" && entry.customType === "bruv-turn"),
    ).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test("a goal with no file changes enables finish and completes only on a passing check", async () => {
  const app = await setup();
  try {
    await app.session.prompt("/keep-going off");
    app.faux.setResponses([finish()]);
    await app.command('/goal objective-781 --criteria "case-a; case-b"');
    expect(app.children()).toHaveLength(1);
    expect(JSON.parse(app.args().at(-1) as string).messages).toEqual([
      '/goal objective-781 --criteria "case-a; case-b"',
    ]);
    expect(app.goal()).toMatchObject({ status: "completed", evidence: ["used-781"] });
    expect(JSON.parse(app.args().at(-1) as string).goal).toEqual({
      objective: "objective-781",
      criteria: ["case-a", "case-b"],
    });
    expect(app.receipts()).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test.each(["pass", "limit", "fail"])("goal gaps stay active until %s", async (next) => {
  const app = await setup();
  try {
    app.fixture({ answer: answer(["missing-781"]) });
    app.faux.setResponses([
      finish(),
      () => {
        expect(app.goal()).toMatchObject({ status: "active", gaps: ["missing-781"] });
        expect(app.goal()?.evidence).toBeUndefined();
        if (next === "pass") app.fixture({ answer: answer() });
        if (next === "fail") app.fixture({ fail: true });
        return finish();
      },
      finish(),
    ]);
    await app.command("/goal objective-781");
    expect(app.children()).toHaveLength(2);
    expect(app.goal()?.status).toBe(next === "pass" ? "completed" : "active");
    expect(app.goal()?.evidence).toEqual(next === "pass" ? ["used-781"] : undefined);
    expect(app.receipts()[0]).toMatchObject({ gaps: next === "pass" ? [] : ["missing-781"], failed: next === "fail" });
    expect(app.faux.state.callCount).toBe(next === "limit" ? 3 : 2);
  } finally {
    await app.close();
  }
});

test("aborting a goal check pauses the goal without evidence", async () => {
  const app = await setup();
  try {
    app.fixture({ hang: true });
    const started = Promise.withResolvers<void>();
    app.jobs.listeners.add(() => {
      if (app.children().length) started.resolve();
    });
    app.faux.setResponses([finish()]);
    const run = app.command("/goal objective-781");
    await started.promise;
    await app.session.abort();
    await run;
    expect(app.goal()).toMatchObject({ status: "paused" });
    expect(app.goal()?.evidence).toBeUndefined();
    expect(app.children()[0].status).toBe("stopped");
    expect(app.receipts()).toHaveLength(0);
  } finally {
    await app.close();
  }
});

test("goal budget and repeated blockers stop without keep-going restarting the run", async () => {
  const app = await setup();
  try {
    app.faux.setResponses([fauxAssistantMessage("step")]);
    await app.command("/goal budget-781 --budget 1");
    expect(app.goal()?.status).toBe("budget_exceeded");
    expect(app.faux.state.callCount).toBe(1);
    expect(app.children()).toHaveLength(0);
    await app.session.prompt("/goal clear");
    const blocked = fauxAssistantMessage(
      fauxToolCall("codemode", {
        code: 'return await tools.goal_update({status:"blocked",blocker:"missing-781"});',
      }),
      { stopReason: "toolUse" },
    );
    app.faux.setResponses(Array.from({ length: 3 }, () => [blocked, fauxAssistantMessage("step")]).flat());
    await app.command("/goal blocker-781");
    expect(app.goal()?.status).toBe("blocked");
    expect(app.faux.state.callCount).toBe(7);
    expect(app.children()).toHaveLength(0);
  } finally {
    await app.close();
  }
});

test("steering keeps both user messages and refreshes the snapshot", async () => {
  const app = await setup();
  try {
    const requests = ["first-781\n  whitespace", "steer-781\n  more whitespace"];
    app.faux.setResponses([
      async () => {
        app.change();
        await app.session.steer(requests[1]);
        return fauxAssistantMessage("private-781");
      },
      () => {
        writeFileSync(join(app.cwd, "new.txt"), "steered-781\n");
        return finish();
      },
    ]);
    await app.session.prompt(requests[0]);
    const prompt = JSON.parse(app.args().at(-1) as string);
    expect(prompt.messages).toEqual(requests);
    expect(prompt.diff).toContain("+steered-781");
    expect(prompt.diff).not.toContain("+after-781");
    expect(app.receipts()[0].asked).toBe("first-781");
  } finally {
    await app.close();
  }
});

test("a message arriving during a check stops it and checks the updated request", async () => {
  const app = await setup();
  try {
    app.fixture({ hang: true });
    const started = Promise.withResolvers<void>();
    app.jobs.listeners.add(() => {
      if (app.children().length) started.resolve();
    });
    app.faux.setResponses([
      () => {
        app.change();
        return finish();
      },
      () => {
        writeFileSync(join(app.cwd, "new.txt"), "steered-781\n");
        return finish();
      },
    ]);
    const run = app.session.prompt("first-781");
    await started.promise;
    app.fixture({ answer: answer() });
    await app.session.steer("second-781");
    await run;
    expect(app.children().map((child) => child.status)).toEqual(["stopped", "done"]);
    const args = JSON.parse(readFileSync(app.children()[1].sessionPath as string, "utf8")).args;
    expect(JSON.parse(args.at(-1)).messages).toEqual(["first-781", "second-781"]);
    expect(app.receipts()).toHaveLength(1);
    expect(app.receipts()[0].failed).toBe(false);
  } finally {
    await app.close();
  }
});
