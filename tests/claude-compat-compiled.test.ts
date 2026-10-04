import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, access, readFile, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const binary = process.env.BRUV_CLAUDE_COMPAT_TEST_BINARY;
const normalBinary = process.env.BRUV_CLAUDE_COMPAT_TEST_BRUV;
const compiledTest = binary && normalBinary ? test : test.skip;

compiledTest(
  "compiled connector: local readiness, stream, schema auxiliary, truthful flag failures",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "bruv-compat-compiled-"));
    const home = join(root, "home"),
      state = join(home, ".bruv", "claude-compat");
    await mkdir(state, { recursive: true });
    let calls = 0;
    const provider = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/chat/completions")
          return new Response("not found", { status: 404 });
        calls++;
        const body = (await request.json()) as { messages: Array<{ role: string; content: string }> };
        const auxiliary = body.messages.some((m) => JSON.stringify(m.content).includes("Return only JSON matching"));
        const longTurn = body.messages.some((m) => JSON.stringify(m.content).includes("hold until EOF"));
        if (longTurn) await Bun.sleep(300);
        const event = (delta: object, finish_reason: string | null) => ({
          id: "loopback-only",
          object: "chat.completion.chunk",
          created: 1,
          model: "fixture-model",
          choices: [{ index: 0, delta, finish_reason }],
        });
        return new Response(
          [
            event({ role: "assistant", content: auxiliary ? '{"title":"Loopback title"}' : "Loopback answer" }, null),
            event({}, "stop"),
          ]
            .map((e) => "data: " + JSON.stringify(e) + "\n\n")
            .join("") + "data: [DONE]\n\n",
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    const children: ReturnType<typeof spawn>[] = [];
    const environment = {
      HOME: home,
      CLAUDE_CONFIG_DIR: join(root, "sdk-home"),
      PATH: process.env.PATH,
      BRUV_CLAUDE_COMPAT_HOME: state,
      BRUV_CLAUDE_COMPAT_BRUV_PATH: normalBinary!,
      GIT_CONFIG_GLOBAL: "/dev/null",
    };
    await writeFile(
      join(state, "models.json"),
      JSON.stringify({
        providers: {
          fixture: {
            baseUrl: "http://127.0.0.1:" + provider.port + "/v1",
            api: "openai-completions",
            apiKey: "fixture-only-not-real-auth",
            models: [{ id: "fixture-model", name: "Local test model", contextWindow: 32000, maxTokens: 1024 }],
          },
        },
      }),
    );
    await writeFile(join(state, "settings.json"), JSON.stringify({ cacheWarming: "off" }));
    const launch = (args: string[], env = environment) => {
      const child = spawn(binary!, args, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
      children.push(child);
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const exit = new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
      return {
        child,
        exit,
        stdout: () => stdout,
        stderr: () => stderr,
        frames: () =>
          stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line)),
      };
    };
    const until = async (predicate: () => boolean, diagnostic: () => string) => {
      for (let i = 0; i < 1000; i++) {
        if (predicate()) return;
        await Bun.sleep(5);
      }
      throw new Error("Compiled probe timed out: " + diagnostic());
    };
    try {
      const version = launch(["--version"]);
      expect(await version.exit).toBe(0);
      expect(version.stdout()).toMatch(/^bruv-claude-compat \d+\.\d+\.\d+\n$/);
      const stream = launch([
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        "fixture/fixture-model",
        "--permission-mode",
        "bypassPermissions",
        "--allow-dangerously-skip-permissions",
        "--no-session-persistence",
        "--include-partial-messages",
      ]);
      stream.child.stdin.write('{"type":"control_request","request_id":"init","request":{"subtype":"initialize"}}\n');
      await until(() => stream.frames().some((f) => f.type === "control_response"), stream.stderr);
      const initialized = stream.frames().find((f) => f.type === "control_response");
      expect(initialized.response.subtype).toBe("success");
      expect(initialized.response.response.account).toEqual({});
      expect(initialized.response.response.bruv.readiness).toMatchObject({
        provider: "fixture",
        model: "fixture-model",
        access_verified: false,
      });
      expect(calls).toBe(0);
      stream.child.stdin.write(
        '{"type":"user","uuid":"compiled-input-id","parent_tool_use_id":null,"message":{"role":"user","content":"Say hello"}}\n',
      );
      await until(() => stream.frames().some((f) => f.type === "result"), stream.stderr);
      expect(stream.frames().find((f) => f.type === "result")).toMatchObject({
        subtype: "success",
        is_error: false,
        result: "Loopback answer",
      });
      expect(stream.frames().some((f) => f.type === "stream_event")).toBe(true);
      expect(stream.frames().find((f) => f.type === "assistant").message.model).toBe("fixture/fixture-model");
      expect(calls).toBe(1);
      stream.child.kill("SIGTERM");
      expect(await stream.exit).toBe(143);
      const auxiliary = launch(
        [
          "-p",
          "--output-format",
          "json",
          "--json-schema",
          '{"type":"object","required":["title"],"properties":{"title":{"type":"string"}},"additionalProperties":false}',
          "--model",
          "fixture/fixture-model",
          "--tools",
          "",
          "--disable-slash-commands",
          "--strict-mcp-config",
          "--permission-mode",
          "dontAsk",
        ],
        { ...environment, CLAUDE_CONFIG_DIR: undefined as any },
      );
      auxiliary.child.stdin.end("Write a title");
      expect(await auxiliary.exit).toBe(0);
      expect(auxiliary.frames()).toHaveLength(1);
      expect(auxiliary.frames()[0].structured_output).toEqual({ title: "Loopback title" });
      expect(calls).toBe(2);
      const eofOwner = launch([
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--model",
        "fixture/fixture-model",
        "--permission-mode",
        "bypassPermissions",
        "--allow-dangerously-skip-permissions",
        "--no-session-persistence",
      ]);
      eofOwner.child.stdin.write(
        '{"type":"control_request","request_id":"eof-init","request":{"subtype":"initialize"}}\n',
      );
      await until(() => eofOwner.frames().some((f) => f.type === "control_response"), eofOwner.stderr);
      eofOwner.child.stdin.write(
        '{"type":"user","parent_tool_use_id":null,"message":{"role":"user","content":"hold until EOF"}}\n',
      );
      await until(() => calls === 3, eofOwner.stderr);
      eofOwner.child.stdin.end();
      expect(await eofOwner.exit).toBe(0);
      expect(eofOwner.frames().some((f) => f.type === "result" && f.subtype === "success")).toBe(false);
      const unaligned = launch(
        ["--input-format", "stream-json", "--output-format", "stream-json", "--model", "fixture/fixture-model"],
        { ...environment, CLAUDE_CONFIG_DIR: undefined as any },
      );
      expect(await unaligned.exit).toBe(1);
      expect(unaligned.stderr()).toContain("explicit absolute CLAUDE_CONFIG_DIR");
      expect(unaligned.stdout()).toBe("");
      expect(calls).toBe(3);
      const failure = launch([
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--resume=unbound",
        "--model",
        "fixture/fixture-model",
      ]);
      expect(await failure.exit).toBe(1);
      expect(failure.stdout()).toBe("");
      expect(failure.stderr()).toContain("must be a UUID");
      const unknown = launch(["--unsupported-behavior"]);
      expect(await unknown.exit).toBe(1);
      expect(unknown.stdout()).toBe("");
      await expect(access(join(home, ".claude"))).rejects.toThrow();
      await expect(access(join(home, ".bruv", "agent"))).rejects.toThrow();
    } finally {
      for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
      provider.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  15000,
);

compiledTest(
  "compiled native execute dispatches a real normal child through the paired Bruv binary and explicit profile",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "bruv-compat-real-child-"));
    const state = join(root, "agent"),
      home = join(root, "home");
    await mkdir(state, { recursive: true });
    await mkdir(home);
    const seen: Array<{ model: string; childTool: boolean }> = [];
    const provider = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as any;
        const toolResults = body.messages
          .filter((m: any) => m.role === "tool")
          .map((m: any) => JSON.stringify(m.content))
          .join("\n");
        const child = body.model === "child-model";
        seen.push({ model: body.model, childTool: child && toolResults.includes("ACTUAL_CHILD_TOOL_RESULT") });
        let delta: any;
        const tool = (id: string, code: string) => ({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id,
              type: "function",
              function: { name: "execute", arguments: JSON.stringify({ label: "Paired binary real execution", code }) },
            },
          ],
        });
        if (child && !toolResults.includes("ACTUAL_CHILD_TOOL_RESULT"))
          delta = tool(
            "child-actual-tool",
            'console.log(JSON.stringify({proof:"ACTUAL_CHILD_TOOL_RESULT",type:process.env.BRUV_SUBAGENT_TYPE,depth:process.env.BRUV_SUBAGENT_DEPTH,controls:Object.keys(process.env).filter(k=>k.startsWith("T3_")||k.startsWith("BRUV_ROOT_"))}));',
          );
        else if (child) delta = { role: "assistant", content: "ACTUAL_NORMAL_CHILD_DONE" };
        else if (toolResults && !toolResults.includes("ACTUAL_NORMAL_CHILD_DONE"))
          delta = { role: "assistant", content: "ACTUAL_CHILD_FAILURE: " + toolResults };
        else if (!toolResults.includes("ACTUAL_NORMAL_CHILD_DONE"))
          delta = tool(
            "parent-actual-subagent",
            'const r=await subagent({type:"normal",prompt:"Run CHILD_RUN_TOOL_PROOF using your actual execute tool",waitSeconds:10}); console.log(JSON.stringify(r));',
          );
        else delta = { role: "assistant", content: "ACTUAL_PARENT_CHILD_CONFIRMED" };
        const event = (d: any, finish: string | null) => ({
          id: "paired-binary-fixture",
          object: "chat.completion.chunk",
          created: 1,
          model: body.model,
          choices: [{ index: 0, delta: d, finish_reason: finish }],
        });
        return new Response(
          [event(delta, null), event({}, delta.tool_calls ? "tool_calls" : "stop")]
            .map((e) => "data: " + JSON.stringify(e) + "\n\n")
            .join("") + "data: [DONE]\n\n",
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    await writeFile(
      join(state, "models.json"),
      JSON.stringify({
        providers: {
          fixture: {
            baseUrl: "http://127.0.0.1:" + provider.port + "/v1",
            api: "openai-completions",
            apiKey: "local-fixture-only",
            models: ["fixture-model", "child-model"].map((id) => ({
              id,
              name: id,
              reasoning: false,
              input: ["text"],
              contextWindow: 32000,
              maxTokens: 1024,
            })),
          },
        },
      }),
    );
    await writeFile(join(state, "settings.json"), JSON.stringify({ cacheWarming: "off" }));
    await mkdir(join(home, ".bruv"), { recursive: true });
    await writeFile(
      join(home, ".bruv", "subagents.json"),
      JSON.stringify({ normal: { model: "fixture/child-model", thinking: "off" } }),
    );
    const child = spawn(
      binary!,
      [
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--model",
        "fixture/fixture-model",
        "--permission-mode",
        "bypassPermissions",
        "--allow-dangerously-skip-permissions",
        "--no-session-persistence",
      ],
      {
        cwd: root,
        env: {
          HOME: home,
          CLAUDE_CONFIG_DIR: join(root, "sdk-home"),
          PATH: process.env.PATH,
          BRUV_CLAUDE_COMPAT_HOME: state,
          BRUV_CLAUDE_COMPAT_BRUV_PATH: normalBinary!,
          T3_COMPOSITION_SCOPE: "must-scrub-before-extensions",
          BRUV_ROOT_COMPOSITION: "must-not-reach-child",
          SHELL: "/bin/bash",
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => {
      stdout += b;
    });
    child.stderr.on("data", (b) => {
      stderr += b;
    });
    const frames = () =>
      stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 3000; i++) {
        if (check()) return;
        if (child.exitCode !== null) throw Error("Connector exited: " + stderr);
        await Bun.sleep(10);
      }
      throw Error("Real child probe timed out: " + stderr);
    };
    const exit = new Promise<number | null>((resolve) => child.once("close", resolve));
    try {
      child.stdin.write(
        JSON.stringify({ type: "control_request", request_id: "init", request: { subtype: "initialize" } }) + "\n",
      );
      await until(() => frames().some((f) => f.type === "control_response"));
      expect(seen).toHaveLength(0);
      child.stdin.write(
        JSON.stringify({
          type: "user",
          parent_tool_use_id: null,
          message: { role: "user", content: "Run a genuine normal subagent" },
        }) + "\n",
      );
      await until(() => frames().some((f) => f.type === "result"));
      expect(frames().find((f) => f.type === "result").result).toBe("ACTUAL_PARENT_CHILD_CONFIRMED");
      expect(seen.some((r) => r.model === "child-model" && r.childTool)).toBe(true);
      const toolFrame = frames().find(
        (f) => f.type === "user" && JSON.stringify(f).includes("ACTUAL_NORMAL_CHILD_DONE"),
      );
      expect(toolFrame).toBeDefined();
      const childSessionRoot = join(state, "sessions");
      const { readdir } = await import("node:fs/promises");
      const directories = await readdir(childSessionRoot);
      let childTranscript = "";
      for (const directory of directories) {
        const files = await readdir(join(childSessionRoot, directory));
        for (const file of files.filter((f) => f.endsWith(".jsonl")))
          childTranscript += await import("node:fs/promises").then((fs) =>
            fs.readFile(join(childSessionRoot, directory, file), "utf8"),
          );
      }
      expect(childTranscript).toContain("ACTUAL_CHILD_TOOL_RESULT");
      expect(childTranscript).toContain('\"type\":\"normal\"');
      expect(childTranscript).toContain('\"depth\":1');
      expect(childTranscript).toContain('\\\"controls\\\":[]');
      child.stdin.end();
      expect(await exit).toBe(0);
    } finally {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await exit;
      }
      provider.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  40000,
);

compiledTest(
  "compiled native preflight refuses invalid setup without history, MCP, tools or ordinary Claude writes",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "bruv-compat-preflight-"));
    const home = join(root, "home"),
      state = join(root, "selected-bruv-home"),
      sdkHome = join(root, "native-home");
    const ordinary = join(home, ".claude");
    await mkdir(ordinary, { recursive: true });
    await mkdir(state);
    const sentinel = '{"ordinary":"untouched"}\n';
    await writeFile(join(ordinary, "settings.json"), sentinel);
    await writeFile(join(root, "not-a-directory"), "file");
    await symlink(ordinary, join(root, "claude-link"));
    let requests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        requests++;
        return new Response("must not be used", { status: 500 });
      },
    });
    await writeFile(
      join(state, "models.json"),
      JSON.stringify({
        providers: {
          fixture: {
            baseUrl: "http://127.0.0.1:" + server.port + "/v1",
            api: "openai-completions",
            apiKey: "fixture-not-a-secret",
            models: [{ id: "exact-model", name: "Fixture", contextWindow: 32000, maxTokens: 1024 }],
          },
        },
      }),
    );
    const env = {
      HOME: home,
      PATH: process.env.PATH,
      BRUV_CLAUDE_COMPAT_HOME: state,
      BRUV_CLAUDE_COMPAT_BRUV_PATH: normalBinary!,
      CLAUDE_CONFIG_DIR: sdkHome,
      GIT_CONFIG_GLOBAL: "/dev/null",
    };
    const flags = [
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--mcp-config",
      JSON.stringify({
        mcpServers: {
          fixture: { type: "http", url: "http://127.0.0.1:" + server.port + "/mcp" },
        },
      }),
    ];
    try {
      const cases = [
        {
          home: undefined,
          model: "fixture/exact-model",
          extra: ["--no-session-persistence"],
          error: "explicit absolute CLAUDE_CONFIG_DIR",
        },
        { home: "relative-home", model: "fixture/exact-model", error: "explicit absolute CLAUDE_CONFIG_DIR" },
        { home: join(root, "not-a-directory"), model: "fixture/exact-model", error: "not a directory" },
        { home: ordinary, model: "fixture/exact-model", error: "default Claude home" },
        { home: join(root, "claude-link", "nested"), model: "fixture/exact-model", error: "default Claude home" },
        { home: sdkHome, model: undefined, error: "No selected Bruv model" },
        { home: sdkHome, model: "fixture/missing-model", error: "Unknown configured Bruv model" },
        { home: sdkHome, model: "", error: "exact provider/id" },
        { home: sdkHome, model: "anthropic/claude-sonnet-4-5", error: "No configured authentication" },
      ];
      for (const item of cases) {
        const child = Bun.spawn(
          [binary!, ...flags, ...(item.model === undefined ? [] : ["--model", item.model]), ...(item.extra ?? [])],
          {
            cwd: root,
            env: { ...env, CLAUDE_CONFIG_DIR: item.home },
            stdout: "pipe",
            stderr: "pipe",
            stdin: new Blob(['{"type":"control_request","request_id":"init","request":{"subtype":"initialize"}}\n']),
          },
        );
        const [out, err, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        expect(code, err).toBe(1);
        expect(err).toContain(item.error);
        expect(out).toBe("");
        expect(requests).toBe(0);
        for (const path of [
          sdkHome,
          join(state, "native-sessions"),
          join(state, "sessions"),
          join(state, "native-history"),
          join(home, ".bruv", "agent"),
        ])
          await expect(access(path)).rejects.toThrow();
        expect(await readFile(join(ordinary, "settings.json"), "utf8")).toBe(sentinel);
        expect(await readdir(ordinary)).toEqual(["settings.json"]);
      }
    } finally {
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  15000,
);
