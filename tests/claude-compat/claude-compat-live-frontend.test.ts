import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { type ClaudeCompatLiveOptions, createClaudeCompatLiveFrontend } from "../../src/claude-compat/live-frontend";
import { createClaudeCompatRuntime } from "../../src/claude-compat/runtime";
import { ClaudeCompatTransport } from "../../src/claude-compat/transport";
import liveExtension from "../../src/live/extension";
import { currentMainOwner } from "../../src/live/main-owner";
import { defaultLiveConfig } from "../../src/live/providers";
import { liveLocalOnly } from "../../src/live/status";

// Connector startup installs disk history before shake accounting. SDK prototypes
// are process-global; do not inherit (or leak) another test suite's wrappers.
if (process.env.BRUV_TEST_COMPAT_RUNTIME_CHILD !== import.meta.path) {
  test("connector regressions in an isolated SDK process", async () => {
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
  }, 120000);
} else {
  const originalDepth = process.env.BRUV_SUBAGENT_DEPTH;
  beforeAll(() => {
    process.env.BRUV_SUBAGENT_DEPTH = "0";
  });
  afterAll(() => {
    if (originalDepth === undefined) delete process.env.BRUV_SUBAGENT_DEPTH;
    else process.env.BRUV_SUBAGENT_DEPTH = originalDepth;
  });

  // Device/provider doubles own capture callbacks and teardown controls. No session
  // owner is installed here: the real-root test must exercise acquireMainOwner.
  function fakeLiveResources() {
    const calls: string[] = [];
    let config = { ...defaultLiveConfig(), inputMode: "continuous" as "continuous" | "push-to-talk" };
    let audioCallbacks: any;
    let voiceCallbacks: any;
    let releaseAudio: (() => void) | undefined;
    let audioCloseError = false;
    const dependencies: any = {
      config: {
        load: async () => config,
        save: async (value: any) => {
          calls.push("config.save");
          config = value;
        },
      },
      key: async () => {
        calls.push("key");
        return "FAKE-KEY-NEVER-PRESENTED";
      },
      credentials: async () => ({
        status: async () => ({ state: "stored_api_key", canImport: false }),
        loadKey: async () => "FAKE-KEY-NEVER-PRESENTED",
        importLiveEnv: async () => {
          throw new Error("must not import");
        },
      }),
      voice: (callbacks: any) => {
        calls.push("provider");
        voiceCallbacks = callbacks;
        return {
          state: "ready",
          generation: 0,
          connect: async () => {
            calls.push("provider.connect");
          },
          sendAudio: () => calls.push("provider.audio"),
          sendContext: () => {},
          close: async () => {
            calls.push("provider.close");
          },
        };
      },
      audio: async (callbacks: any) => {
        calls.push("audio");
        audioCallbacks = callbacks;
        return {
          diagnostics: {},
          start: async () => {
            calls.push("audio.start");
          },
          play: async () => {},
          flush: async () => {},
          stop: async () => {
            calls.push("audio.stop");
          },
          close: async () => {
            calls.push("audio.close");
            if (releaseAudio)
              await new Promise<void>((resolve) => {
                releaseAudio = resolve;
              });
            if (audioCloseError) throw new Error("PRIVATE-ERROR");
          },
        };
      },
      speakerCheck: async ({ signal }: any) => {
        signal.throwIfAborted();
        calls.push("speaker.check");
        return "Fake device check";
      },
    };
    return {
      dependencies,
      calls,
      capture: () => audioCallbacks?.capture(Buffer.alloc(640)),
      interrupt: () => voiceCallbacks?.onInterrupted(1),
      providerError: () => voiceCallbacks?.onError({ code: "fixture_error" }),
      waitClose: () => {
        releaseAudio = () => {};
      },
      release: () => releaseAudio?.(),
      failClose: () => {
        audioCloseError = true;
      },
    };
  }

  function harness(overrides: Partial<ClaudeCompatLiveOptions> = {}) {
    const events = new Map<string, (value: unknown) => void>();
    const lifecycle = new Map<string, ((...args: any[]) => any)[]>();
    const resources = fakeLiveResources();
    const { calls } = resources;
    const notices: string[] = [];
    const requests: any[] = [];
    let command: any;
    let answer: (request: any) => Promise<any> = async (request) => {
      const question = request.input.questions[0];
      return {
        behavior: "allow",
        toolUseID: request.tool_use_id,
        updatedInput: { answers: { [question.question]: question.options[0].label } },
      };
    };
    const manager = {
      getSessionId: () => "canonical-root",
      getSessionFile: () => "/fake/canonical.jsonl",
      getLeafId: () => "leaf-1",
    };
    const ctx = {
      sessionManager: manager,
      mode: "rpc",
      hasUI: false,
      isIdle: () => true,
      ui: { notify: (text: string) => notices.push(text), setStatus: () => {}, setWidget: () => {} },
    } as unknown as ExtensionContext;
    const api = {
      events: {
        on: (name: string, fn: any) => {
          events.set(name, fn);
          return () => events.delete(name);
        },
        emit: (name: string, value: unknown) => events.get(name)?.(value),
      },
      registerMessageRenderer() {},
      registerCommand: (_name: string, value: any) => {
        command = value;
      },
      on: (name: string, fn: any) => {
        lifecycle.set(name, [...(lifecycle.get(name) ?? []), fn]);
      },
      appendEntry: () => {},
    } as any;
    const dependencies: any = {
      ...resources.dependencies,
      owner: async (_pi: any, context: any, callbacks: any) => {
        calls.push("owner");
        expect(context.sessionManager).toBe(manager);
        expect(context.hasUI).toBe(false);
        expect(context.mode).toBe("rpc");
        return {
          orchestration: { instructions: "Canonical root", tools: [], execute: async () => ({ ok: true }) },
          typedInput: callbacks.onInput,
          sendContext: callbacks.onContext,
          close: () => calls.push("owner.close"),
          stopForeground: () => calls.push("owner.stopForeground"),
          released: Promise.resolve(),
          interrupt: () => calls.push("owner.interrupt"),
          turnComplete: () => {},
          inputTranscript: () => {},
          outputTranscript: () => {},
        };
      },
    };
    const frontend = createClaudeCompatLiveFrontend({
      localAudio: { host: hostname() },
      humanChoices: true,
      request: async (request: any) => {
        requests.push(request);
        calls.push("human");
        return answer(request);
      },
      notify: (text) => notices.push(text),
      dependencies,
      ...overrides,
    });
    frontend.factory(api);
    return {
      ...resources,
      frontend,
      api,
      ctx,
      manager,
      notices,
      requests,
      dependencies,
      run: (args: string, context = ctx) => command.handler(args, context),
      lifecycle: async (name: string) => {
        for (const listener of lifecycle.get(name) ?? []) await listener({}, ctx);
      },
      answer: (value: typeof answer) => {
        answer = value;
      },
      changeLeaf: () => {
        manager.getLeafId = () => "leaf-2";
      },
    };
  }

  describe("native connector-host Live", () => {
    test.each(["", "status", "capabilities", "stop", "start browser"])(
      "%s command replies use the supplied UI without publishing a lifetime notice",
      async (action) => {
        const h = harness({ localAudio: undefined });
        const replies: string[] = [];
        await h.run(action, { ...h.ctx, ui: { ...h.ctx.ui, notify: (text) => replies.push(text) } });
        expect(replies.length).toBeGreaterThan(0);
        expect(h.notices).toEqual([]);
        expect(h.calls).toEqual([]);
      },
    );

    test("nested native picker warnings and failures belong to their command reply", async () => {
      for (const available of [false, true]) {
        const h = harness({ humanChoices: available });
        const replies: string[] = [];
        h.answer(async () => {
          throw new Error("PRIVATE-NATIVE-CHOICE-ERROR");
        });
        await h.run("model", { ...h.ctx, ui: { ...h.ctx.ui, notify: (text) => replies.push(text) } });
        expect(replies.join()).toContain(available ? "command failed" : "choices are unavailable");
        expect(replies.join()).not.toContain("PRIVATE-NATIVE-CHOICE-ERROR");
        expect(h.notices).toEqual([]);
        expect(h.calls).not.toContain("audio");
      }
    });

    test("retained Live callbacks use lifetime notices after the start command finishes", async () => {
      const h = harness();
      const replies: string[] = [];
      await h.run("start", { ...h.ctx, ui: { ...h.ctx.ui, notify: (text) => replies.push(text) } });
      expect(replies.join()).toContain("Live listening");
      expect(h.notices).toEqual([]);
      const completed = [...replies];
      h.providerError();
      await h.frontend.stop(h.ctx);
      expect(h.notices.join()).toContain("Live stop requested");
      expect(replies).toEqual(completed);
    });

    test("stop teardown warnings remain within the stop command's UI", async () => {
      const h = harness();
      await h.run("start");
      h.notices.length = 0;
      h.failClose();
      const replies: string[] = [];
      await h.run("stop", { ...h.ctx, ui: { ...h.ctx.ui, notify: (text) => replies.push(text) } });
      expect(replies.join()).toContain("Audio close failed");
      expect(h.notices).toEqual([]);
    });

    test("push-to-talk is refused before device consent; continuous must be chosen explicitly", async () => {
      const h = harness();
      await h.run("input push-to-talk");
      h.calls.length = 0;
      await h.run("start");
      expect(h.calls).not.toContain("human");
      expect(h.calls).not.toContain("audio");
      expect(h.notices.at(-1)).toContain("no hold/release controls");
      expect(h.frontend.capabilities().pushToTalk).toBe(false);
      await h.run("input continuous");
      await h.run("start");
      expect(h.calls).toContain("audio.start");
      await h.run("stop");
    });
    test("default is truthful status with no audio or provider acquisition", async () => {
      const h = harness({ localAudio: undefined });
      await h.run("");
      await h.run("capabilities");
      await h.run("start");
      expect(h.frontend.capabilities().localHostAudio).toBe(false);
      expect(h.calls).toEqual([]);
      expect(h.notices.join(" ")).toContain(hostname());
      expect(h.notices.join(" ")).not.toContain("FAKE-KEY");
    });

    test("operator opt-in cannot replace human callback or select another device host", async () => {
      for (const options of [
        { humanChoices: false },
        { request: undefined },
        { localAudio: { host: "some-other-host" } },
      ]) {
        const h = harness(options);
        await h.run("start");
        expect(h.calls).toEqual([]);
        expect(h.frontend.capabilities().localHostAudio).toBe(false);
      }
    });

    test("denial, allow-without-answer, mismatched ID and invented text acquire no resources", async () => {
      for (const mode of ["deny", "empty", "wrong-id", "paraphrase"]) {
        const h = harness();
        h.answer(async (request) => {
          const q = request.input.questions[0];
          return mode === "deny"
            ? { behavior: "deny" }
            : mode === "empty"
              ? { behavior: "allow" }
              : {
                  behavior: "allow",
                  toolUseID: mode === "wrong-id" ? "wrong-id" : request.tool_use_id,
                  updatedInput: { answers: { [q.question]: mode === "paraphrase" ? "yes" : q.options[0].label } },
                };
        });
        await h.run("start");
        expect(h.calls).toEqual(["human"]);
      }
    });

    test("explicit human host/provider-cost consent precedes key, owner, helper and provider", async () => {
      const h = harness();
      await h.run("start");
      expect(h.calls.slice(0, 6)).toEqual(["human", "key", "owner", "audio", "provider", "provider.connect"]);
      expect(h.calls).toContain("audio.start");
      const question = h.requests[0].input.questions[0].question;
      expect(question).toContain(hostname());
      expect(question).toContain("incurs charges");
      expect(question).toContain("Google Gemini / " + defaultLiveConfig().model);
      expect(question).toContain("NOT this browser");
      expect(question).toContain("same Bruv session");
      expect(h.ctx.hasUI).toBe(false);
      h.capture();
      expect(h.calls).toContain("provider.audio");
      h.interrupt();
      expect(h.calls).toContain("owner.interrupt");
      const result = await h.frontend.stop(h.ctx);
      expect(result).toEqual({ stopped: true, errors: [], jobsUnchanged: true });
      expect(h.calls).toContain("owner.close");
      expect(h.calls).toContain("audio.close");
      expect(h.calls).toContain("provider.close");
      expect(h.calls).not.toContain("owner.stopForeground");
      h.capture();
      expect(h.calls.filter((x) => x === "provider.audio")).toHaveLength(1);
    });

    test("Stop and lifecycle cancellation fence late human consent", async () => {
      for (const cancel of ["stop", "session_start", "session_shutdown", "session_before_switch"]) {
        const h = harness();
        let reply: ((value: any) => void) | undefined;
        h.answer(
          () =>
            new Promise((resolve) => {
              reply = resolve;
            }),
        );
        const starting = h.run("start");
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancel === "stop") await h.frontend.stop(h.ctx);
        else await h.lifecycle(cancel);
        const request = h.requests[0];
        const q = request.input.questions[0];
        reply!({ behavior: "allow", updatedInput: { answers: { [q.question]: q.options[0].label } } });
        await starting;
        expect(h.calls).toEqual(["human"]);
      }
    });

    test("changed branch cannot use pending consent", async () => {
      const h = harness();
      h.answer(async (request) => {
        h.changeLeaf();
        const q = request.input.questions[0];
        return { behavior: "allow", updatedInput: { answers: { [q.question]: q.options[0].label } } };
      });
      await h.run("start");
      expect(h.calls).toEqual(["human"]);
    });

    test("wrong session manager cannot route Stop or acquire a second owner", async () => {
      const h = harness();
      await h.run("start");
      const other = { ...h.ctx, sessionManager: { ...h.manager } } as ExtensionContext;
      const result = await h.frontend.stop(other);
      expect(result.stopped).toBe(false);
      expect(result.errors.join()).toContain("another session");
      expect(h.calls).not.toContain("audio.stop");
      await h.run("start", other);
      expect(h.calls.filter((x) => x === "owner")).toHaveLength(1);
      await h.frontend.close(h.ctx);
    });

    test("teardown awaits resources and reports failures without secrets", async () => {
      const h = harness();
      await h.run("start");
      h.waitClose();
      h.failClose();
      let done = false;
      const stopping = h.frontend.close(h.ctx).then((result) => {
        done = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(done).toBe(false);
      h.release();
      const result = await stopping;
      expect(result.stopped).toBe(false);
      expect(result.errors).toEqual(["Audio close failed"]);
      expect(JSON.stringify(result)).not.toContain("PRIVATE-ERROR");
      expect(h.notices).not.toContain("Live off.");
      expect(h.frontend.capabilities().localHostAudio).toBe(false);
    });

    test("browser/remote requests explicitly denied, not silently connector-local", async () => {
      const h = harness();
      for (const arg of ["start browser", "start remote", "mic-check browser", "device remote"]) await h.run(arg);
      expect(h.calls).toEqual([]);
      expect(h.notices.every((x) => x.includes("not supplied by Claude protocol"))).toBe(true);
      expect(h.frontend.capabilities().browserAudio).toBe(false);
    });

    test("native model picker paginates and uses existing persisted selection", async () => {
      const h = harness();
      let count = 0;
      h.answer(async (request) => {
        const q = request.input.questions[0];
        expect(q.options.length).toBeGreaterThanOrEqual(2);
        expect(q.options.length).toBeLessThanOrEqual(4);
        const label = count++ === 0 ? "More choices" : q.options[0].label;
        return { behavior: "allow", updatedInput: { answers: { [q.question]: label } } };
      });
      await h.run("model");
      expect(h.calls).toEqual(["human", "human", "config.save"]);
      expect(h.notices.join()).toContain("OpenAI");
      expect(h.calls).not.toContain("key");
    });

    test("speaker check names connector host and preserves the extension's second bounded check consent", async () => {
      const h = harness();
      await h.run("speaker-check");
      expect(h.calls).toEqual(["human", "human", "speaker.check"]);
      expect(h.requests[1].input.questions[0].question).toContain(hostname());
      expect(h.calls).not.toContain("provider");
    });

    test("missing credentials use existing secure setup, never an input/key transcript", async () => {
      const base = fakeLiveResources();
      const h = harness({
        dependencies: {
          ...base.dependencies,
          key: async () => {
            throw new Error("PRIVATE-KEY-ERROR");
          },
          credentials: async () => ({
            status: async () => ({ state: "missing", canImport: false }),
            loadKey: async () => {
              throw new Error("must not load");
            },
            importLiveEnv: async () => {
              throw new Error("must not import");
            },
          }),
        },
      });
      let count = 0;
      h.answer(async (request) => {
        const q = request.input.questions[0];
        const label = count++ === 0 ? q.options[0].label : "Cancel";
        return { behavior: "allow", updatedInput: { answers: { [q.question]: label } } };
      });
      await h.run("start");
      expect(h.requests).toHaveLength(2);
      expect(h.requests[1].input.questions[0].question).toBe("Google API key required");
      expect(h.notices.join()).toContain("Never paste keys into chat");
      expect(h.notices.join()).not.toContain("PRIVATE-KEY-ERROR");
      expect(base.calls).toEqual([]);
    });

    test("mic-check refusal prevents audio acquisition after named host consent", async () => {
      const h = harness();
      let count = 0;
      h.answer(async (request) => {
        const q = request.input.questions[0];
        const label = count++ === 0 ? q.options[0].label : "No";
        return { behavior: "allow", updatedInput: { answers: { [q.question]: label } } };
      });
      await h.run("mic-check");
      expect(h.calls).toEqual(["human", "human"]);
    });

    test("non-native mode and worker scope cannot acquire connector devices", async () => {
      const h = harness();
      await h.run("start", { ...h.ctx, mode: "tui" });
      process.env.BRUV_SUBAGENT_DEPTH = "1";
      try {
        await h.run("start");
      } finally {
        process.env.BRUV_SUBAGENT_DEPTH = "0";
      }
      expect(h.calls).toEqual([]);
    });

    test("actual NDJSON control callback gates acquisition on the exact host answer", async () => {
      const input = new PassThrough(),
        output = new PassThrough();
      const transport = new ClaudeCompatTransport({ input, output, onUser() {}, controls: {} });
      const frames: any[] = [];
      output.on("data", (chunk) => {
        for (const line of chunk.toString().trim().split("\n")) {
          const frame = JSON.parse(line);
          frames.push(frame);
          if (frame.type !== "control_request") continue;
          const q = frame.request.input.questions[0];
          input.write(
            JSON.stringify({
              type: "control_response",
              response: {
                subtype: "success",
                request_id: frame.request_id,
                response: {
                  behavior: "allow",
                  toolUseID: frame.request.tool_use_id,
                  updatedInput: { answers: { [q.question]: q.options[0].label } },
                },
              },
            }) + "\n",
          );
        }
      });
      const running = transport.run();
      const h = harness({ request: transport.request.bind(transport) });
      try {
        await h.run("start");
        expect(frames).toHaveLength(1);
        expect(frames[0].request.tool_name).toBe("AskUserQuestion");
        expect(frames[0].request.input.questions[0].question).toContain(hostname());
        expect(h.calls[0]).toBe("key");
        expect(await h.frontend.stop(h.ctx)).toEqual({ stopped: true, errors: [], jobsUnchanged: true });
      } finally {
        input.end();
        await running;
      }
    });

    test("real connector Pi root is the Live owner: no companion agent and no configured model call", async () => {
      const dir = await mkdtemp(join(tmpdir(), "bruv-native-live-"));
      let runtime: Awaited<ReturnType<typeof createClaudeCompatRuntime>> | undefined;
      const resources = fakeLiveResources();
      const notices: string[] = [];
      // Leave owner unspecified so the native frontend acquires the actual Pi root.
      const live = createClaudeCompatLiveFrontend({
        localAudio: { host: hostname() },
        humanChoices: true,
        request: async (request: any) => {
          const q = request.input.questions[0];
          return {
            behavior: "allow",
            toolUseID: request.tool_use_id,
            updatedInput: { answers: { [q.question]: q.options[0].label } },
          };
        },
        notify: (text) => notices.push(text),
        dependencies: resources.dependencies,
      });
      try {
        await writeFile(
          join(dir, "auth.json"),
          JSON.stringify({ anthropic: { type: "api_key", key: "offline-fixture-not-provider-auth" } }),
          { mode: 0o600 },
        );
        const models = await ModelRuntime.create({
          authPath: join(dir, "auth.json"),
          modelsPath: null,
          refreshOnCreate: false,
          allowModelNetwork: false,
        });
        let modelCalls = 0;
        models.stream = () => {
          modelCalls++;
          throw new Error("No model activation permitted");
        };
        runtime = await createClaudeCompatRuntime({
          cwd: dir,
          agentDir: dir,
          modelRuntime: models,
          model: "anthropic/claude-sonnet-4-5",
          sessionManager: SessionManager.inMemory(dir),
          settingsManager: SettingsManager.inMemory({ cacheWarming: "off" }, { projectTrusted: false }),
          extensionFactories: [{ name: "native-live", factory: live.factory }],
          emit: () => {},
          // This duplicate test registration is invoked directly through Pi,
          // whose headless command UI reports notifications as diagnostics.
          diagnostic: (event) => {
            if (event && typeof event === "object" && "message" in event && typeof event.message === "string")
              notices.push(event.message);
          },
        });
        await runtime.controls.initialize!(
          { type: "control_request", request_id: "initialize", request: { subtype: "initialize" } },
          new AbortController().signal,
        );
        // Runtime registers native Live too; select the final test registration
        // so these device/provider doubles run against its actual canonical session.
        const inheritedHasUI = runtime.session.extensionRunner.createContext().hasUI;
        const command = runtime.session.extensionRunner
          .getRegisteredCommands()
          .filter((c) => c.name === "live")
          .at(-1)!;
        await runtime.onUser(
          {
            type: "user",
            parent_tool_use_id: null,
            message: { role: "user", content: "/" + command.invocationName + " start" },
          },
          new AbortController().signal,
        );
        const manager = runtime.session.sessionManager;
        expect(notices.join()).toContain("Live listening");
        expect(currentMainOwner(manager)).toBeDefined();
        expect(resources.calls).toContain("audio.start");
        expect(runtime.session.extensionRunner.createContext().hasUI).toBe(inheritedHasUI);
        expect(runtime.session.extensionRunner.createContext().mode).toBe("rpc");
        expect(modelCalls).toBe(0);
        await runtime.onUser(
          {
            type: "user",
            parent_tool_use_id: null,
            message: { role: "user", content: "/" + command.invocationName + " stop" },
          },
          new AbortController().signal,
        );
        expect(notices).toContain("Live off. Agent jobs unchanged.");
        expect(resources.calls).toContain("audio.close");
        expect(resources.calls).toContain("provider.close");
        expect(currentMainOwner(manager)).toBeUndefined();
      } finally {
        await runtime?.close();
        await rm(dir, { recursive: true, force: true });
      }
    });

    test("ordinary Live local TTY defaults are untouched", async () => {
      expect(liveLocalOnly("rpc", {}, true)).toBe(false);
      expect(liveLocalOnly("tui", {}, false)).toBe(false);
      expect(liveLocalOnly("tui", { SSH_CONNECTION: "host" }, true)).toBe(false);
      expect(liveLocalOnly("tui", {}, true)).toBe(true);
      const h = harness();
      let original: any;
      liveExtension(
        {
          ...h.api,
          registerCommand: (_name: string, cmd: any) => {
            original = cmd;
          },
        },
        h.dependencies,
      );
      await original.handler("start", h.ctx);
      expect(h.calls).toEqual([]);
      // Original diagnostics are intentionally not routed through our native adapter.
    });
  });
}
