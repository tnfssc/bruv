import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { type ExtensionFactory, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createClaudeCompatRuntime, type ClaudeCompatRuntime } from "../../src/claude-compat/runtime";
import type { CompatFrame } from "../../src/claude-compat/frontend";
import { latestGoal } from "../../src/goals/store";
import type { QuestionCommands } from "../../src/questions/extension";
import { NATIVE_QUESTION_ACCESS, type NativeQuestionAccess } from "../../src/questions/runtime";
import type { Question } from "../../src/questions/service";

if (process.env.BRUV_TEST_COMPAT_STOP_CHILD !== import.meta.path) {
  test("native Stop boundary regressions in an isolated SDK process", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, BRUV_TEST_COMPAT_STOP_CHILD: import.meta.path, HERDR_ENV: "0", BRUV_SUBAGENT_DEPTH: "0" },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stdout + stderr).toBe(0);
  }, 30_000);
} else {
  const runtimes: ClaudeCompatRuntime[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  function assistant(text: string): AssistantMessage {
    return {
      role: "assistant",
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      timestamp: Date.now(),
      content: [{ type: "text", text }],
      stopReason: "stop",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
  }
  function output(text: string) {
    const stream = createAssistantMessageEventStream();
    const message = assistant(text);
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "stop", message });
    return stream;
  }
  async function fixture(factory?: ExtensionFactory) {
    const dir = await mkdtemp(join(tmpdir(), "bruv-native-stop-boundary-"));
    dirs.push(dir);
    await writeFile(join(dir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "offline-fixture" } }));
    const modelRuntime = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    const frames: CompatFrame[] = [];
    const runtime = await createClaudeCompatRuntime({
      cwd: dir,
      agentDir: dir,
      modelRuntime,
      model: "anthropic/claude-sonnet-4-5",
      settingsManager: SettingsManager.inMemory({ cacheWarming: "off" }, { projectTrusted: false }),
      sessionManager: SessionManager.create(dir, join(dir, "sessions")),
      permissionMode: "bypassPermissions",
      emit(frame) {
        frames.push(frame);
      },
      extensionFactories: factory ? [{ name: "stop-boundary-fixture", factory }] : [],
    });
    runtimes.push(runtime);
    const control = (subtype: string) =>
      runtime.controls[subtype]!(
        { type: "control_request", request_id: subtype, request: { subtype } },
        new AbortController().signal,
      );
    await control("initialize");
    return {
      runtime,
      frames,
      control,
      goal: () => latestGoal(runtime.session.sessionManager.getBranch()),
      send: (text: string) =>
        runtime.onUser(
          { type: "user", uuid: text, parent_tool_use_id: null, message: { role: "user", content: text } },
          new AbortController().signal,
        ),
    };
  }
  async function until(check: () => boolean) {
    for (let i = 0; i < 100; i++) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Fixture boundary did not occur");
  }

  test.each(["interrupt", "close"] as const)(
    "%s revokes a goal reminder already queued during agent_settled",
    async (operation) => {
      const boundary = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let held = false;
      const h = await fixture((pi) => {
        pi.on("agent_settled", async () => {
          if (held) return;
          held = true;
          boundary.resolve();
          await release.promise;
        });
      });
      let calls = 0;
      h.runtime.session.agent.streamFunction = () => {
        if (++calls > 1) throw new Error("A provider request started after Stop");
        return output("A useful step; more work remains");
      };
      await h.send("/goal Complete the offline fixture");
      await boundary.promise;
      const replay = spyOn(h.runtime.session, "prompt");
      try {
        expect(h.runtime.session.isIdle).toBe(true);
        if (operation === "close") await h.runtime.close();
        else await h.control("interrupt");
        expect(h.goal()?.status).toBe("paused");
        release.resolve();
        await until(() => replay.mock.results.length > 0);
        await replay.mock.results[0]!.value;
        expect(calls).toBe(1);
        expect(h.goal()?.status).toBe("paused");
        expect(h.frames.filter((frame) => frame.type === "result")).toEqual([
          expect.objectContaining({ is_error: true }),
        ]);
      } finally {
        release.resolve();
        replay.mockRestore();
      }
    },
  );

  test.each(["interrupt", "close"] as const)(
    "%s fences a goal prompt accepted before agent_start",
    async (operation) => {
      const boundary = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const h = await fixture((pi) => {
        pi.on("before_agent_start", async () => {
          boundary.resolve();
          await release.promise;
        });
      });
      let calls = 0;
      h.runtime.session.agent.streamFunction = () => {
        calls++;
        return output("Must not run after cancelled admission");
      };
      const admitted = spyOn(h.runtime.session, "prompt");
      try {
        await h.send("/goal Do not start after Stop");
        await boundary.promise;
        expect(h.runtime.session.isIdle).toBe(true);
        expect(calls).toBe(0);
        if (operation === "close") await h.runtime.close();
        else await h.control("interrupt");
        expect(h.goal()?.status).toBe("paused");
        release.resolve();
        await expect(admitted.mock.results[0]!.value).rejects.toThrow(
          operation === "close" ? "closed" : "Interrupted during goal admission",
        );
        expect(calls).toBe(0);
        expect(h.frames.filter((frame) => frame.type === "result")).toEqual([
          expect.objectContaining({ is_error: true }),
        ]);
      } finally {
        release.resolve();
        admitted.mockRestore();
      }
    },
  );

  test("Stop while already idle leaves old saved questions requiring explicit resume", async () => {
    let questions!: QuestionCommands;
    const h = await fixture((pi) => {
      pi.on("session_start", (_event, context) => {
        pi.events.emit(NATIVE_QUESTION_ACCESS, {
          context,
          accept(port) {
            questions = port;
          },
        } satisfies NativeQuestionAccess);
      });
    });
    let calls = 0;
    h.runtime.session.agent.streamFunction = () => {
      calls++;
      return output("Handled the explicitly resumed answer");
    };
    const old = (await questions.handle("questions.ask", { text: "Which target?" })) as Question;
    expect(h.runtime.session.isIdle).toBe(true);
    await h.control("interrupt");
    await h.send(`/questions answer ${old.id} Selected target`);
    const answered = (await questions.handle("questions.get", { id: old.id })) as Question;
    expect(answered).toMatchObject({ status: "answered", delivery: "resume-needed" });
    expect(calls).toBe(0);
    await h.send(`/questions resume ${old.id}`);
    await until(() => calls === 1 && h.runtime.session.isIdle);
    expect((await questions.handle("questions.get", { id: old.id })) as Question).toMatchObject({
      status: "answered",
      delivery: "delivered",
    });
  });

  test.each(["completed", "budget_exceeded"] as const)("Stop preserves a %s goal", async (status) => {
    const h = await fixture();
    const { GoalStore } = await import("../../src/goals/store");
    const store = new GoalStore((type, data) => h.runtime.session.sessionManager.appendCustomEntry(type, data));
    store.set({ objective: "Preserve the saved state", tokenBudget: 1 });
    if (status === "completed") store.update({ status: "completed", evidence: "Verified by fixture" });
    else store.addUsage(1);
    await h.control("interrupt");
    expect(h.goal()?.status).toBe(status);
  });
}
