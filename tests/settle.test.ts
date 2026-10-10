import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { sdk } from "./sdk";

test("Pi abort waits for the pending settle handler", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let pending = false;
  let abortedWhilePending = false;
  let settledAborted = false;
  const app = await sdk([
    (pi) => {
      pi.on("agent_before_settle", async () => {
        pending = true;
        entered.resolve();
        await release.promise;
        pending = false;
      });
      pi.on("agent_settled", (event) => {
        abortedWhilePending = event.aborted && pending;
        settledAborted = event.aborted;
      });
    },
  ]);
  try {
    app.faux.setResponses([fauxAssistantMessage("ready")]);
    const run = app.session.prompt("go");
    await entered.promise;
    const start = performance.now();
    let ended = false;
    const abort = app.session.abort().then(() => {
      ended = true;
    });
    for (let i = 0; i < 5; i++) await Bun.sleep(100);
    expect(abortedWhilePending).toBe(false);
    expect(settledAborted).toBe(false);
    expect(ended).toBe(false);
    expect(pending).toBe(true);
    console.log(
      `abort: elapsed=${Math.round(performance.now() - start)}ms settledAbortedWhilePending=${abortedWhilePending} runEnded=${ended} handlerPending=${pending}`,
    );
    release.resolve();
    await abort;
    await run;
    expect(settledAborted).toBe(true);
  } finally {
    release.resolve();
    await app.close();
  }
});

import { fauxToolCall } from "@earendil-works/pi-ai";
import bruv from "../extensions/bruv";
import { Jobs, registerJobs } from "../src/jobs";
import { registerPrompt } from "../src/prompt";
import { registerSettle, report } from "../src/settle";

async function held(waitSeconds = 30, command = "sleep 0.2; echo done", detach = false) {
  const jobs = new Jobs();
  const entered = Promise.withResolvers<void>();
  const app = await sdk([
    (pi) => {
      pi.on("agent_before_settle", () => {
        entered.resolve();
      });
      registerSettle(pi, jobs, waitSeconds);
      registerJobs(pi, jobs);
      registerPrompt(pi);
    },
  ]);
  const responses = [
    fauxAssistantMessage(
      fauxToolCall("codemode", {
        code: `return await tools.job_start(${JSON.stringify({ command, waitSeconds: 0, detach })});`,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("working"),
  ];
  return { ...app, jobs, entered: entered.promise, responses };
}

test("settle continues with a real report and keeps prompt guidance", async () => {
  const app = await held();
  try {
    app.faux.setResponses([
      ...app.responses,
      (context) => {
        expect(app.jobs.get("j1").status).toBe("done");
        expect(
          context.messages.some((message) => message.role === "user" && JSON.stringify(message).includes("j1")),
        ).toBe(true);
        expect(context.messages.find((message) => message.role === "system")?.sections?.bruv?.length).toBeGreaterThan(
          0,
        );
        return fauxAssistantMessage("finished");
      },
    ]);
    await app.session.prompt("go");
    expect(app.faux.state.callCount).toBe(3);
    expect(app.session.getLastAssistantText()).toBe("finished");
    expect(app.session.sessionManager.getEntries().filter((entry) => entry.type === "custom_message").length).toBe(1);
    expect(app.jobs.get("j1").reported).toBe(true);
  } finally {
    await app.close();
  }
});

test("a queued user message releases the hold, then the next settle holds again", async () => {
  const app = await held(30, "sleep 0.6; echo done");
  try {
    app.faux.setResponses([
      ...app.responses,
      (context) => {
        expect(app.jobs.get("j1").status).toBe("running");
        expect(context.messages.some((message) => JSON.stringify(message).includes("user-781"))).toBe(true);
        return fauxAssistantMessage("still working");
      },
      fauxAssistantMessage("finished"),
    ]);
    const run = app.session.prompt("go");
    await app.entered;
    await app.session.steer("user-781");
    await run;
    expect(app.session.getLastAssistantText()).toBe("finished");
    expect(app.faux.state.callCount).toBe(4);
    expect(app.jobs.get("j1").status).toBe("done");
  } finally {
    await app.close();
  }
});

test.each([false, true])("quiet slices and detached jobs deliver on the next turn (detach=%s)", async (detach) => {
  const app = await held(0.02, "sleep 0.2; echo done", detach);
  try {
    app.faux.setResponses(app.responses);
    await app.session.prompt("go");
    expect(app.jobs.get("j1").status).toBe("running");
    await app.jobs.get("j1").completion;
    expect(app.faux.state.callCount).toBe(2);
    app.faux.setResponses([
      (context) => {
        expect(
          context.messages.some((message) => JSON.stringify(message).includes(app.jobs.get("j1").outputPath)),
        ).toBe(true);
        return fauxAssistantMessage("received");
      },
    ]);
    await app.session.prompt("next");
    expect(app.session.getLastAssistantText()).toBe("received");
    expect(app.faux.state.callCount).toBe(3);
  } finally {
    await app.close();
  }
});

test.each([0.02, 30])("abort keeps jobs running and delivers results next turn (slice=%s)", async (slice) => {
  const app = await held(slice);
  try {
    app.faux.setResponses(app.responses);
    const run = app.session.prompt("go");
    await app.entered;
    await app.session.abort();
    await run;
    if (slice < 1) expect(app.jobs.get("j1").status).toBe("running");
    expect(app.jobs.get("j1").stopped).toBe(false);
    await app.jobs.get("j1").completion;
    expect(app.jobs.get("j1").status).toBe("done");
    expect(app.faux.state.callCount).toBe(2);
    app.faux.setResponses([
      (context) => {
        expect(
          context.messages.some((message) => JSON.stringify(message).includes(app.jobs.get("j1").outputPath)),
        ).toBe(true);
        return fauxAssistantMessage("received");
      },
    ]);
    await app.session.prompt("next");
    expect(app.session.getLastAssistantText()).toBe("received");
    expect(app.faux.state.callCount).toBe(3);
  } finally {
    await app.close();
  }
});

test("reports cap content and preserve output and session paths", () => {
  const item = {
    id: "a1",
    kind: "agent" as const,
    title: "test",
    status: "done" as const,
    startedAt: 0,
    elapsedSeconds: 1,
    outputPath: "/test/output",
    sessionPath: "/test/session",
    output: "x".repeat(9000),
  };
  const result = report(item);
  expect(result.content.length).toBeLessThanOrEqual(4000);
  expect(result.content).toContain(item.outputPath);
  expect(result.content).toContain(item.sessionPath);
  const running = report({
    ...item,
    status: "running",
    output: Array.from({ length: 30 }, (_, i) => `line-${i}`).join("\n"),
  });
  expect(running.content).not.toContain("line-9\n");
  expect(running.content).toContain("line-29");
});

test("the full bruv extension holds and continues a codemode run", async () => {
  const app = await sdk([bruv]);
  try {
    app.faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("codemode", {
          code: 'return await tools.job_start({command: "sleep 0.2; echo entry-781", waitSeconds: 0});',
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("working"),
      fauxAssistantMessage("received-781"),
    ]);
    await app.session.prompt("go");
    expect(app.session.getLastAssistantText()).toBe("received-781");
    expect(app.faux.state.callCount).toBe(3);
    expect(
      app.session.sessionManager
        .getEntries()
        .filter((entry) => entry.type === "custom_message" && entry.customType === "bruv-report"),
    ).toHaveLength(1);
  } finally {
    await app.close();
  }
});
