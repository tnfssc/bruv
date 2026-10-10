import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Jobs, registerJobs } from "../src/jobs";
import { registerPrompt } from "../src/prompt";
import { registerSettle } from "../src/settle";
import { sdk } from "./sdk";

const script = (code: string) => fauxAssistantMessage(fauxToolCall("codemode", { code }), { stopReason: "toolUse" });
const start = (detach = false) =>
  script(
    `return await tools.job_start(${JSON.stringify({
      command: "sh -c 'while [ ! -f release ]; do sleep 0.01; done; echo done'",
      waitSeconds: 0,
      detach,
    })});`,
  );
async function setup() {
  const jobs = new Jobs();
  const waiting = Promise.withResolvers<void>();
  const app = await sdk([
    (pi) => {
      registerSettle(pi, jobs);
      registerJobs(pi, jobs);
      registerPrompt(pi);
      pi.on("tool_execution_start", (event) => {
        if (event.toolName === "wait") waiting.resolve();
      });
    },
  ]);
  const release = () => writeFileSync(join(app.dir, "release"), "");
  const reports = () =>
    app.session.sessionManager
      .getEntries()
      .filter((entry) => entry.type === "custom_message" && entry.customType === "bruv-report");
  return {
    ...app,
    jobs,
    waiting: waiting.promise,
    release,
    reports,
    async nextPrompt() {
      app.faux.setResponses([
        (context) => {
          const path = jobs.get("j1").outputPath;
          expect(context.messages.some((message) => JSON.stringify(message).includes(path))).toBe(true);
          return fauxAssistantMessage("received");
        },
      ]);
      await app.session.prompt("next");
    },
    async close() {
      release();
      await Promise.all([...jobs.items.values()].map((item) => item.completion));
      await app.close();
    },
  };
}

test("finished unseen work continues with its result and keeps prompt guidance", async () => {
  const app = await setup();
  try {
    app.faux.setResponses([
      start(),
      async () => {
        app.release();
        await app.jobs.get("j1").completion;
        expect(app.jobs.get("j1").exitCode).toBe(0);
        expect(app.jobs.get("j1").seen).toBe(false);
        return fauxAssistantMessage("ready");
      },
      (context) => {
        expect(
          context.messages.some((message) => JSON.stringify(message).includes(app.jobs.get("j1").outputPath)),
        ).toBe(true);
        expect(context.messages.find((message) => message.role === "system")?.sections?.bruv?.length).toBeGreaterThan(
          0,
        );
        return fauxAssistantMessage("finished");
      },
    ]);
    await app.session.prompt("go");
    expect(app.faux.state.callCount).toBe(3);
    expect(app.reports()).toHaveLength(1);
    expect(app.jobs.get("j1").seen).toBe(true);
  } finally {
    await app.close();
  }
});

test.each([false, true])("running work gets at most one reminder and delivers later (detach=%s)", async (detach) => {
  const app = await setup();
  try {
    app.faux.setResponses([
      start(detach),
      fauxAssistantMessage("ready"),
      ...(detach ? [] : [fauxAssistantMessage("leave running")]),
    ]);
    await app.session.prompt("go");
    expect(app.faux.state.callCount).toBe(detach ? 2 : 3);
    expect(app.reports()).toHaveLength(detach ? 0 : 1);
    expect(app.jobs.get("j1").status).toBe("running");
    app.release();
    await app.jobs.get("j1").completion;
    expect(app.faux.state.callCount).toBe(detach ? 2 : 3);
    await app.nextPrompt();
    expect(app.reports()).toHaveLength(detach ? 1 : 2);
  } finally {
    await app.close();
  }
});

test("codemode wait returns the finished job without another result report", async () => {
  const app = await setup();
  try {
    app.faux.setResponses([
      start(),
      script('return await tools.wait({ids: ["j1"]});'),
      (context) => {
        const result = [...context.messages].reverse().find((message) => message.role === "toolResult");
        expect(result?.role === "toolResult" && result.isError).toBe(false);
        expect(JSON.stringify(result)).toContain(app.jobs.get("j1").outputPath);
        expect(app.jobs.get("j1").status).toBe("done");
        expect(app.jobs.get("j1").seen).toBe(true);
        return fauxAssistantMessage("finished");
      },
    ]);
    const run = app.session.prompt("go");
    await app.waiting;
    app.release();
    await run;
    expect(app.reports()).toHaveLength(0);
  } finally {
    await app.close();
  }
});

test("a steer message promptly releases codemode wait", async () => {
  const app = await setup();
  try {
    app.faux.setResponses([
      start(),
      script(
        'const result = await tools.wait(); if (!result.userMessagePending || result.running.length !== 1) throw new Error("wait failed"); return result;',
      ),
      (context) => {
        const result = [...context.messages].reverse().find((message) => message.role === "toolResult");
        expect(result?.role === "toolResult" && result.isError).toBe(false);
        expect(context.messages.some((message) => JSON.stringify(message).includes("steer-781"))).toBe(true);
        expect(app.jobs.get("j1").status).toBe("running");
        return fauxAssistantMessage("ready");
      },
      fauxAssistantMessage("leave running"),
    ]);
    const run = app.session.prompt("go");
    await app.waiting;
    await Bun.sleep(10);
    const began = performance.now();
    await app.session.steer("steer-781");
    await run;
    expect(performance.now() - began).toBeLessThan(1000);
  } finally {
    await app.close();
  }
});

test("abort ends codemode wait within one second and delivers the job next prompt", async () => {
  const app = await setup();
  try {
    app.faux.setResponses([start(), script("return await tools.wait();")]);
    const run = app.session.prompt("go");
    await app.waiting;
    await Bun.sleep(10);
    const began = performance.now();
    await app.session.abort();
    await run;
    expect(performance.now() - began).toBeLessThan(1000);
    const item = app.jobs.get("j1");
    expect(item.status, JSON.stringify(app.jobs.result(item))).toBe("running");
    expect(item.stopped).toBe(false);
    expect(app.reports()).toHaveLength(0);
    app.release();
    await item.completion;
    expect(item.status, JSON.stringify(app.jobs.result(item))).toBe("done");
    expect(app.faux.state.callCount).toBe(2);
    await app.nextPrompt();
    expect(app.reports()).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test("a nested wait resets the reminder", async () => {
  const app = await setup();
  try {
    app.faux.setResponses([
      start(),
      fauxAssistantMessage("ready"),
      script("return await tools.wait({timeoutSeconds: 0});"),
      fauxAssistantMessage("ready"),
      fauxAssistantMessage("leave running"),
    ]);
    await app.session.prompt("go");
    expect(app.faux.state.callCount).toBe(5);
    expect(app.reports()).toHaveLength(2);
  } finally {
    await app.close();
  }
});
