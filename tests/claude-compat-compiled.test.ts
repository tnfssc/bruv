import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
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
    const launch = (args: string[]) => {
      const child = spawn(binary!, args, { cwd: root, env: environment, stdio: ["pipe", "pipe", "pipe"] });
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
      const auxiliary = launch([
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
      ]);
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
      const failure = launch(["--input-format", "stream-json", "--output-format", "stream-json", "--resume=unbound"]);
      expect(await failure.exit).toBe(1);
      expect(failure.stdout()).toBe("");
      expect(failure.stderr()).toContain("--resume is not yet bound");
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
