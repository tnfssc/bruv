import { expect, setDefaultTimeout, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { registerAgents } from "../src/agents";
import { type Checker, registerCheck } from "../src/check";
import { readConfig, saveConfig } from "../src/config";
import { registerFinish } from "../src/finish";
import { Jobs, registerJobs } from "../src/jobs";
import { registerSettle } from "../src/settle";
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
        check = registerCheck(pi, jobs, registerAgents(pi, jobs), dir);
        const hasFinished = registerFinish(pi, dir, check);
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
