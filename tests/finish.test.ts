import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall, type SystemMessage } from "@earendil-works/pi-ai";
import { type Config, readConfig, saveConfig } from "../src/config";
import { registerFinish } from "../src/finish";
import { registerGoal } from "../src/goal";
import { Jobs, registerJobs } from "../src/jobs";
import { registerPrompt } from "../src/prompt";
import { registerSettle } from "../src/settle";
import { sdk } from "./sdk";

setDefaultTimeout(15000);
const finish = (status = "done") =>
  fauxAssistantMessage([fauxText("reply-781"), fauxToolCall("finish", { status })], { stopReason: "toolUse" });
const script = (code: string) => fauxAssistantMessage(fauxToolCall("codemode", { code }), { stopReason: "toolUse" });
async function setup(api = "openai-codex-responses", mode?: Config["keepGoing"]) {
  mkdirSync(".tmp", { recursive: true });
  const configDir = mkdtempSync(resolve(".tmp/finish-"));
  saveConfig({ ...(mode ? { keepGoing: mode } : {}), fast: true }, configDir);
  const jobs = new Jobs();
  const rounds: string[][] = [];
  const app = await sdk(
    [
      (pi) => {
        registerSettle(pi, jobs, () => hasFinished());
        registerJobs(pi, jobs);
        registerGoal(pi, () => hasFinished());
        const hasFinished = registerFinish(pi, configDir);
        registerPrompt(pi);
        pi.on("agent_before_settle", (event) => {
          rounds.push(event.entries.flatMap((entry) => (entry.type === "custom_message" ? [entry.customType] : [])));
        });
      },
    ],
    undefined,
    undefined,
    "rpc",
    [],
    api,
  );
  const entries = () =>
    app.session.sessionManager
      .getBranch()
      .filter((entry) => entry.type === "custom_message" && entry.customType === "bruv-keep-going");
  return {
    ...app,
    configDir,
    jobs,
    rounds,
    entries,
    async close() {
      await app.close();
      rmSync(configDir, { recursive: true, force: true });
    },
  };
}

test.each(["done", "need_you", "blocked"])(
  "finish %s terminates with one request and stays declared in codemode-only",
  async (status) => {
    const app = await setup();
    try {
      app.faux.setResponses([
        (context) => {
          const system = [...context.messages].reverse().find((message) => message.role === "system");
          expect(system?.toolsAdded?.map((tool) => tool.name).sort()).toEqual(["codemode", "finish"]);
          return finish(status);
        },
      ]);
      await app.session.prompt("go");
      expect(app.faux.state.callCount).toBe(1);
      expect(app.session.getLastAssistantText()).toBe("reply-781");
      expect(app.entries()).toHaveLength(0);
      const results = app.session.messages.filter((message) => message.role === "toolResult");
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ toolName: "finish", isError: false, details: { status } });
    } finally {
      await app.close();
    }
  },
);

test("text continues with a hidden message and keeps the same system prompt", async () => {
  const app = await setup();
  try {
    let system: SystemMessage | undefined;
    app.faux.setResponses([
      (context) => {
        system = structuredClone([...context.messages].reverse().find((message) => message.role === "system"));
        return fauxAssistantMessage("next step");
      },
      (context) => {
        expect([...context.messages].reverse().find((message) => message.role === "system")).toEqual(system);
        expect(app.entries()).toHaveLength(1);
        const entry = app.entries()[0];
        expect(entry).toMatchObject({ display: false });
        if (entry.type === "custom_message")
          expect(JSON.stringify(context.messages)).toContain(JSON.stringify(entry.content).slice(1, -1));
        return finish();
      },
    ]);
    await app.session.prompt("go");
    expect(app.faux.state.callCount).toBe(2);
    app.faux.setResponses([fauxAssistantMessage("next step"), finish()]);
    await app.session.prompt("another task");
    expect(app.faux.state.callCount).toBe(4);
    expect(app.entries()).toHaveLength(2);
  } finally {
    await app.close();
  }
});

test("two empty continuations stop and a tool call resets the count", async () => {
  const app = await setup();
  try {
    const text = fauxAssistantMessage("next step");
    app.faux.setResponses([text, text, script("return await tools.jobs({});"), text, text, text]);
    await app.session.prompt("go");
    expect(app.faux.state.callCount).toBe(6);
    expect(app.entries()).toHaveLength(4);
    app.faux.setResponses([text, text, text]);
    await app.session.prompt("another task");
    expect(app.faux.state.callCount).toBe(9);
    expect(app.entries()).toHaveLength(6);
  } finally {
    await app.close();
  }
});

test("aborted runs do not continue", async () => {
  const app = await setup();
  try {
    app.faux.setResponses([fauxAssistantMessage("stopped", { stopReason: "aborted" })]);
    await app.session.prompt("go");
    expect(app.faux.state.callCount).toBe(1);
    expect(app.entries()).toHaveLength(0);
  } finally {
    await app.close();
  }
});

test.each(["faux", "openai-responses", "openai-codex-responses"])(
  "auto follows API %s, off is saved, and on enables other APIs",
  async (api) => {
    const app = await setup(api);
    try {
      const active = api !== "faux";
      expect(app.session.getActiveToolNames().includes("finish")).toBe(active);
      const prompts: string[] = [];
      const respond = () => {
        app.faux.setResponses([
          (context) => {
            const system = [...context.messages].reverse().find((message) => message.role === "system");
            prompts.push(system?.sections?.bruv ?? "");
            return app.session.getActiveToolNames().includes("finish") ? finish() : fauxAssistantMessage("reply");
          },
        ]);
      };
      respond();
      await app.session.prompt("go");
      expect(app.faux.state.callCount).toBe(1);
      await app.session.prompt("/keep-going");
      expect(readConfig(app.configDir)).toEqual({ fast: true });
      await app.session.prompt("/keep-going off");
      expect(readConfig(app.configDir)).toEqual({ fast: true, keepGoing: "off" });
      await app.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
      expect(app.session.getActiveToolNames()).not.toContain("finish");
      expect(app.session.getAllTools().find((tool) => tool.name === "finish")?.exposure).toBe("hidden");
      respond();
      await app.session.prompt("go");
      expect(app.faux.state.callCount).toBe(2);
      expect(prompts[0].length > prompts[1].length).toBe(active);
      await app.session.prompt("/keep-going on");
      expect(app.session.getActiveToolNames()).toContain("finish");
      respond();
      await app.session.prompt("go");
      expect(app.faux.state.callCount).toBe(3);
      expect(prompts[2].length).toBeGreaterThan(prompts[1].length);
      await app.session.prompt("/keep-going auto");
      expect(readConfig(app.configDir).keepGoing).toBe("auto");
      await app.session.setModel({ ...app.faux.getModel(), id: "switched", api: active ? "faux" : "openai-responses" });
      expect(app.session.getActiveToolNames().includes("finish")).toBe(!active);
    } finally {
      await app.close();
    }
  },
);

test.each([false, true])("job and goal settle order respects finish (finish=%s)", async (early) => {
  const app = await setup();
  const release = Promise.withResolvers<void>();
  try {
    app.faux.setResponses([
      () => {
        const item = app.jobs.create("job", "pending", app.dir);
        void app.jobs.run(item, async () => {
          await release.promise;
          return 0;
        });
        return early ? finish("need_you") : fauxAssistantMessage("next step");
      },
      fauxAssistantMessage("next step"),
      script('return await tools.goal_update({status: "completed", evidence: "checked-781"});'),
      fauxAssistantMessage("next step"),
      finish(),
    ]);
    const settled = Promise.withResolvers<void>();
    app.session.subscribe((event) => {
      if (event.type === "agent_settled") settled.resolve();
    });
    await app.session.prompt("/goal task");
    await settled.promise;
    expect(app.faux.state.callCount).toBe(early ? 1 : 5);
    expect(app.rounds).toEqual(early ? [[]] : [["bruv-report"], ["bruv-goal"], ["bruv-keep-going"], []]);
  } finally {
    release.resolve();
    await app.close();
  }
});

test("Stop aborts a waiting run and stops its job without continuing", async () => {
  const app = await setup();
  const release = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  const item = app.jobs.create("job", "pending", app.dir);
  void app.jobs.run(item, async () => {
    await release.promise;
    return 0;
  });
  try {
    app.session.subscribe((event) => {
      if (event.type === "tool_execution_start" && event.toolName === "wait") waiting.resolve();
    });
    app.faux.setResponses([script("return await tools.wait({});")]);
    const run = app.session.prompt("go");
    await waiting.promise;
    await app.session.abort();
    await run;
    expect(item.stopped).toBe(true);
    expect(app.entries()).toHaveLength(0);
    expect(app.faux.state.callCount).toBe(1);
  } finally {
    release.resolve();
    await app.close();
  }
});

test("child sessions follow the saved setting", async () => {
  const previous = process.env.BRUV_DEPTH;
  process.env.BRUV_DEPTH = "1";
  const app = await setup("faux", "on");
  try {
    app.faux.setResponses([finish()]);
    await app.session.prompt("go");
    expect(app.faux.state.callCount).toBe(1);
    await app.session.prompt("/keep-going off");
    const child = await sdk([
      (pi) => {
        registerFinish(pi, app.configDir);
      },
    ]);
    try {
      expect(child.session.getActiveToolNames()).not.toContain("finish");
    } finally {
      await child.close();
    }
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.BRUV_DEPTH;
    else process.env.BRUV_DEPTH = previous;
  }
});
