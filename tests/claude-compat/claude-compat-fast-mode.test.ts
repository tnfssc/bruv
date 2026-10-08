import { AuthStorage } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";
import { expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { nativeFastEnabled, NATIVE_FAST_CHILD_ENV, NATIVE_FAST_ENTRY } from "../../src/agent/native-fast-mode";
import { parseConnectorArguments, assertLaunchBindings } from "../../src/claude-compat/arguments";
import { createClaudeCompatRuntime } from "../../src/claude-compat/runtime";
import { runConnector } from "../../src/claude-compat/cli";
import { JobService } from "../../src/tasks/job-service";
import { TaskManager, type TaskLaunch } from "../../src/tasks/task-manager";

// Isolate SDK prototypes and production bootstrap environment from other suites.
if (process.env.BRUV_TEST_COMPAT_RUNTIME_CHILD !== import.meta.path) {
  test("native Fast connector tests in an isolated SDK process", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, BRUV_TEST_COMPAT_RUNTIME_CHILD: import.meta.path, HERDR_ENV: "0" },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stdout + stderr).toBe(0);
  }, 60000);
} else {
  const flags = ["--input-format", "stream-json", "--output-format", "stream-json"];
  const signal = new AbortController().signal;
  const token = [
    Buffer.from("{}").toString("base64url"),
    Buffer.from(
      JSON.stringify({
        "https://api.openai.com/auth": { chatgpt_account_id: "offline-acct" },
      }),
    ).toString("base64url"),
    "x",
  ].join(".");
  const credential = (oauth: boolean) =>
    oauth
      ? { type: "oauth" as const, access: token, refresh: "offline-refresh", expires: Date.now() + 3600000 }
      : { type: "api_key" as const, key: "sk-offline-fixture" };
  function sse() {
    return new Response(
      "data: " +
        JSON.stringify({
          type: "response.completed",
          response: {
            status: "completed",
            output: [
              { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok", annotations: [] }] },
            ],
            usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5, input_tokens_details: { cached_tokens: 0 } },
          },
        }) +
        "\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
  }

  test("only the verified boolean --settings fastMode signal is accepted", () => {
    for (const value of [true, false]) {
      expect(() =>
        assertLaunchBindings(parseConnectorArguments([...flags, "--settings", JSON.stringify({ fastMode: value })])),
      ).not.toThrow();
    }
    for (const value of ["true", 1, null]) {
      expect(() =>
        assertLaunchBindings(parseConnectorArguments([...flags, "--settings", JSON.stringify({ fastMode: value })])),
      ).toThrow("fastMode must be boolean");
    }
    for (const unsupported of [["--fast"], ["--fast-mode"], ["--settings", '{"speed":"fast"}']]) {
      expect(() => assertLaunchBindings(parseConnectorArguments([...flags, ...unsupported]))).toThrow();
    }
  });

  for (const oauth of [false, true])
    test("production launch and NDJSON control select actual " +
      (oauth ? "OAuth" : "API") +
      " request tiers", async () => {
      const dir = await mkdtemp(join(tmpdir(), "bruv-fast-inbound-"));
      const agentDir = join(dir, "agent");
      await mkdir(agentDir);
      await writeFile(join(agentDir, "auth.json"), JSON.stringify({ openai: credential(oauth) }));
      const input = new PassThrough(),
        output = new PassThrough(),
        stderr = new PassThrough();
      let errors = "",
        pending = "";
      stderr.on("data", (data) => {
        errors += data;
      });
      const frames: any[] = [],
        waiters: Array<{ match: (frame: any) => boolean; resolve: (frame: any) => void }> = [];
      output.on("data", (data) => {
        pending += data;
        let index: number;
        while ((index = pending.indexOf("\n")) >= 0) {
          const frame = JSON.parse(pending.slice(0, index));
          pending = pending.slice(index + 1);
          frames.push(frame);
          for (const waiter of [...waiters])
            if (waiter.match(frame)) {
              waiters.splice(waiters.indexOf(waiter), 1);
              waiter.resolve(frame);
            }
        }
      });
      const wait = (match: (frame: any) => boolean) => {
        const frame = frames.find(match);
        return frame
          ? Promise.resolve(frame)
          : Promise.race([
              new Promise<any>((resolve) => waiters.push({ match, resolve })),
              running.then((code) => {
                throw new Error("Connector exited early: " + code + " " + errors);
              }),
            ]);
      };
      const send = (frame: object) => input.write(JSON.stringify(frame) + "\n");
      const control = async (id: string, subtype: string, extra: object = {}) => {
        send({ type: "control_request", request_id: id, request: { subtype, ...extra } });
        return wait((frame) => frame.type === "control_response" && frame.response.request_id === id);
      };
      const bodies: any[] = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (url: any, init: any) => {
        expect(String(url)).toBe("https://api.openai.com/v1/responses");
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer " + (oauth ? token : "sk-offline-fixture"));
        bodies.push(JSON.parse(init.body));
        return sse();
      }) as typeof fetch;
      const nativeId = randomUUID();
      const running = runConnector(
        [
          ...flags,
          "--model",
          "openai/gpt-5.3-codex",
          "--session-id",
          nativeId,
          "--settings",
          '{"fastMode":true,"alwaysThinkingEnabled":true,"showThinkingSummaries":true}',
        ],
        undefined,
        {
          cwd: dir,
          home: dir,
          input,
          output,
          stderr,
          signals: new EventEmitter(),
          env: {
            ...process.env,
            BRUV_CLAUDE_COMPAT_HOME: agentDir,
            BRUV_CLAUDE_COMPAT_BRUV_PATH: process.execPath,
            CLAUDE_CONFIG_DIR: join(dir, "native-history"),
          },
        },
      );
      try {
        expect((await control("init", "initialize")).response.subtype, errors).toBe("success");
        let turn = 0;
        const request = async () => {
          const before = frames.filter((frame) => frame.type === "result").length;
          send({
            type: "user",
            uuid: randomUUID(),
            session_id: nativeId,
            parent_tool_use_id: null,
            message: { role: "user", content: "offline tier test " + ++turn },
          });
          await wait(
            (frame) => frame.type === "result" && frames.filter((f) => f.type === "result").indexOf(frame) === before,
          );
        };
        await request();
        expect(bodies.at(-1).service_tier).toBe("priority");
        expect((await control("bad", "apply_flag_settings", { settings: { fastMode: "true" } })).response.subtype).toBe(
          "error",
        );
        await request();
        expect(bodies.at(-1).service_tier).toBe("priority");
        expect((await control("off", "apply_flag_settings", { settings: { fastMode: false } })).response.subtype).toBe(
          "success",
        );
        await request();
        expect(bodies.at(-1).service_tier).toBe("default");
        expect((await control("on", "apply_flag_settings", { settings: { fastMode: true } })).response.subtype).toBe(
          "success",
        );
        await request();
        expect(bodies.at(-1).service_tier).toBe("priority");
        input.end();
        expect(await running, errors).toBe(0);
        const binding = JSON.parse(await readFile(join(agentDir, "native-sessions", nativeId + ".json"), "utf8"));
        const manager = SessionManager.open(binding.file);
        const settings = manager
          .getBranch()
          .filter((entry) => entry.type === "custom" && entry.customType === NATIVE_FAST_ENTRY);
        expect(settings.map((entry: any) => entry.data.enabled)).toEqual([true, false, true]);
        expect((settings.at(-1) as any).data).toMatchObject({
          oauth,
          sessionId: manager.getSessionId(),
          provider: "openai",
          model: "gpt-5.3-codex",
          enabled: true,
          costAcknowledged: true,
        });
      } finally {
        input.end();
        await running;
        globalThis.fetch = originalFetch;
        await rm(dir, { recursive: true, force: true });
      }
    }, 30000);

  test("unsupported provider selection cannot create premium authorization", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-fast-unsupported-"));
    const models = await ModelRuntime.create({
      credentials: AuthStorage.inMemory({
        anthropic: { type: "api_key", key: "offline-fixture" },
      }),
      modelsPath: null,
      allowModelNetwork: false,
    });
    const manager = SessionManager.inMemory(dir);
    const options = {
      cwd: dir,
      agentDir: dir,
      modelRuntime: models,
      model: "anthropic/claude-sonnet-4-5",
      sessionManager: manager,
      settingsManager: SettingsManager.inMemory({ cacheWarming: "off" }),
      emit() {},
    };
    try {
      await expect(createClaudeCompatRuntime({ ...options, fastMode: true })).rejects.toThrow(
        "Anthropic native fast mode is deferred",
      );
      expect(
        manager.getBranch().filter((entry) => entry.type === "custom" && entry.customType === NATIVE_FAST_ENTRY),
      ).toEqual([]);
      const runtime = await createClaudeCompatRuntime({ ...options, fastMode: false });
      try {
        await expect(
          runtime.controls.apply_flag_settings!(
            {
              type: "control_request",
              request_id: "unsupported",
              request: {
                subtype: "apply_flag_settings",
                settings: { fastMode: true },
              },
            },
            signal,
          ),
        ).rejects.toThrow("Anthropic native fast mode is deferred");
        expect(nativeFastEnabled(runtime.session.extensionRunner.createContext())).toBe(false);
      } finally {
        await runtime.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("real JobService launch inherits effective authorization, not composer labels or worker type", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-fast-inherit-"));
    const models = await ModelRuntime.create({
      credentials: AuthStorage.inMemory({ openai: credential(true) }),
      modelsPath: null,
      allowModelNetwork: false,
    });
    const parent = await createClaudeCompatRuntime({
      cwd: dir,
      agentDir: dir,
      modelRuntime: models,
      model: "openai/gpt-5.3-codex",
      fastMode: true,
      sessionManager: SessionManager.inMemory(dir),
      settingsManager: SettingsManager.inMemory({ cacheWarming: "off" }),
      emit() {},
    });
    const manager = new TaskManager(() => {}),
      launches: TaskLaunch[] = [];
    const spawn = spyOn(manager, "spawn").mockImplementation((launch) => {
      launches.push(launch);
      return {
        id: "offline-child",
        kind: "agent",
        command: "test",
        cwd: dir,
        status: "running",
        startedAt: new Date().toISOString(),
        baseOffset: 0,
        outputEnd: 0,
        timedOut: false,
      };
    });
    const foreground = spyOn(manager, "foreground").mockResolvedValue({
      id: "offline-child",
      kind: "agent",
      command: "test",
      cwd: dir,
      status: "running",
      startedAt: new Date().toISOString(),
      baseOffset: 0,
      outputEnd: 0,
      timedOut: false,
      output: "",
      requestedOffset: 0,
      nextOffset: 0,
      outputLost: false,
      hasMore: false,
      background: true,
    });
    const profiles = join(dir, "profiles.json");
    await writeFile(profiles, JSON.stringify({ fast: { model: "openai/gpt-5.3-codex", thinking: "off" } }));
    const service = new JobService(
      manager,
      () => ({ depth: 0 }),
      () => {},
      profiles,
    );
    const savedFast = process.env[NATIVE_FAST_CHILD_ENV],
      savedDepth = process.env.BRUV_SUBAGENT_DEPTH;
    let child: Awaited<ReturnType<typeof createClaudeCompatRuntime>> | undefined;
    try {
      const ctx = parent.session.extensionRunner.createContext();
      expect(nativeFastEnabled(ctx)).toBe(true);
      await service.handle("subagent", { type: "fast", prompt: "offline child", waitSeconds: 0 }, ctx, signal);
      expect(launches.at(-1)!.env?.[NATIVE_FAST_CHILD_ENV]).toBe("1");
      process.env[NATIVE_FAST_CHILD_ENV] = launches.at(-1)!.env![NATIVE_FAST_CHILD_ENV];
      process.env.BRUV_SUBAGENT_DEPTH = launches.at(-1)!.env!.BRUV_SUBAGENT_DEPTH;
      child = await createClaudeCompatRuntime({
        cwd: dir,
        agentDir: dir,
        modelRuntime: models,
        model: "openai/gpt-5.3-codex",
        sessionManager: SessionManager.inMemory(dir),
        settingsManager: SettingsManager.inMemory({ cacheWarming: "off" }),
        emit() {},
      });
      const childCtx = child.session.extensionRunner.createContext();
      expect(nativeFastEnabled(childCtx)).toBe(true);
      expect(child.session.sessionId).not.toBe(parent.session.sessionId);
      let body: any;
      await models
        .streamSimple(
          child.session.model!,
          { systemPrompt: "sys", messages: [{ role: "user", content: "hi", timestamp: 1 }], tools: [] },
          {
            sessionId: child.session.sessionId,
            fetch: (async (_url: any, init: any) => {
              body = JSON.parse(init.body);
              return sse();
            }) as typeof fetch,
          },
        )
        .result();
      expect(body.service_tier).toBe("priority");
      await parent.controls.apply_flag_settings!(
        {
          type: "control_request",
          request_id: "off",
          request: {
            subtype: "apply_flag_settings",
            settings: { fastMode: false },
          },
        },
        signal,
      );
      expect(nativeFastEnabled(ctx)).toBe(false);
      await service.handle("subagent", { type: "fast", prompt: "standard child", waitSeconds: 0 }, ctx, signal);
      expect(launches.at(-1)!.env?.[NATIVE_FAST_CHILD_ENV]).toBe("0");
      // Existing child keeps its own branch/session-bound authorization.
      expect(nativeFastEnabled(childCtx)).toBe(true);
    } finally {
      spawn.mockRestore();
      foreground.mockRestore();
      await manager.shutdown();
      await child?.close();
      await parent.close();
      if (savedFast === undefined) delete process.env[NATIVE_FAST_CHILD_ENV];
      else process.env[NATIVE_FAST_CHILD_ENV] = savedFast;
      if (savedDepth === undefined) delete process.env.BRUV_SUBAGENT_DEPTH;
      else process.env.BRUV_SUBAGENT_DEPTH = savedDepth;
      await rm(dir, { recursive: true, force: true });
    }
  });
}
