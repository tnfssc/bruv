import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { networkNoneFixture, assertFixtureOutputExternal } from "../scripts/network-none-fixture";
import { fixtureRpc, loopbackParent } from "../scripts/loopback-parent-fixture";

import { ownedFixtureEnv } from "./helpers";

// Retain mkdtemp roots; the cleanup assertion below targets only an owned scratch child.
const temp = () => mkdtempSync(join(tmpdir(), "tooling-fixture-"));

test("network-none fixture isolates secrets/config and owns only its scratch root", () => {
  const retainedRoot = temp();
  const root = join(retainedRoot, "scratch");
  const env = ownedFixtureEnv(retainedRoot);
  const external = temp();
  writeFileSync(join(external, "evidence"), "retained");
  const fixture = networkNoneFixture({
    root,
    name: "not-started",
    alias: "fixture",
    bun: process.execPath,
    base: "unused",
    buildArg: "FIXTURE_BASE",
    files: {},
  });
  expect(fixture.env.HOME).toBe(join(root, "home"));
  expect(fixture.env.BRUV_CODING_AGENT_DIR).toBe(join(root, "home", "agent"));
  expect(fixture.env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
  for (const forbidden of [
    "OPENAI_API_KEY",
    "SSH_AUTH_SOCK",
    "BRUV_SUBAGENT_TYPE",
    "BRUV_SUBAGENT_DEPTH",
    "BRUV_NATIVE_TASK_ID",
  ])
    expect(fixture.env).not.toHaveProperty(forbidden);
  expect(
    JSON.parse(fixture.run(process.execPath, ["-e", "console.log(JSON.stringify(process.env))"], { env })).HOME,
  ).toBe(fixture.env.HOME);
  expect(() =>
    fixture.run(process.execPath, ["-e", "console.error('intentional failure');process.exit(7)"], { env }),
  ).toThrow("intentional failure");
  expect(fixture.containerStarted).toBe(false);
  fixture.cleanup();
  expect(existsSync(root)).toBe(false);
  expect(existsSync(env.HOME)).toBe(true);
  expect(readFileSync(join(external, "evidence"), "utf8")).toBe("retained");
});

test("loopback fake parent writes its model endpoint and streams text and tool replies", async () => {
  const root = temp();
  let calls = 0;
  const provider = loopbackParent(root, () => calls++);
  try {
    const model = JSON.parse(readFileSync(join(root, "models.json"), "utf8")).providers.fixture;
    expect(model.apiKey).toBe("fixture-only");
    expect(model.api).toBe("openai-completions");
    expect(model.models[0].id).toBe("fixture-model");
    expect(model.baseUrl).toBe("http://127.0.0.1:" + provider.port + "/v1");

    expect((await fetch(model.baseUrl + "/chat/completions")).status).toBe(404);
    expect((await fetch(model.baseUrl + "/wrong", { method: "POST", body: "{}" })).status).toBe(404);
    expect(calls).toBe(0);

    for (const [prompt, finishReason] of [
      ["hello", "stop"],
      ["REMOTE_FIXTURE_CANCEL", "tool_calls"],
    ]) {
      const response = await fetch(model.baseUrl + "/chat/completions", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
      });
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const frames = (await response.text()).split("\n\n").filter(Boolean);
      expect(frames).toHaveLength(3);
      expect(frames[2]).toBe("data: [DONE]");
      expect(frames[0]).toStartWith("data: ");
      expect(frames[1]).toStartWith("data: ");
      const reply = JSON.parse(frames[0].slice(6));
      const finish = JSON.parse(frames[1].slice(6));
      expect(reply.model).toBe(model.models[0].id);
      expect(reply.choices[0].finish_reason).toBeNull();
      expect(finish.choices[0]).toEqual({ index: 0, delta: {}, finish_reason: finishReason });
      if (finishReason === "stop") {
        expect(reply.choices[0].delta).toEqual({ role: "assistant", content: "LOCAL_FIXTURE_ACK" });
      } else {
        const tool = reply.choices[0].delta.tool_calls[0];
        expect(tool.id).toBe("fixture-placement-REMOTE_FIXTURE_CANCEL");
        expect(tool.type).toBe("function");
        expect(tool.function.name).toBe("execute");
        expect(JSON.parse(tool.function.arguments).code).toContain("await subagent(");
      }
    }
    expect(calls).toBe(2);
  } finally {
    provider.stop(true);
  }
});

test("fixture RPC buffers lines, denies trust, sends prompts and retains timeout diagnostics", async () => {
  const root = temp();
  const binary = join(root, "rpc");
  writeFileSync(
    binary,
    `#!${process.execPath}
import { createInterface } from "node:readline";

console.error("fixture stderr");
process.stdout.write('{"type":"extension_ui_request",');
createInterface({ input: process.stdin }).on("line", (line) => {
  if (line === "complete-trust-request") {
    process.stdout.write('"method":"confirm","id":"trust"}\\n');
  } else {
    console.log(JSON.stringify({ type: "received", value: JSON.parse(line) }));
  }
});
`,
    { mode: 0o755 },
  );
  const children: ReturnType<typeof import("node:child_process").spawn>[] = [];
  const rpc = fixtureRpc({
    bruv: binary,
    cwd: root,
    env: ownedFixtureEnv(root),
    children,
    noSession: true,
    timeoutDetail: (events) => "; fixture pane; events=" + JSON.stringify(events),
  });
  try {
    expect(children).toEqual([rpc.child]);
    // The child withholds the newline until this test has observed the partial request.
    let partialLineSeen = false;
    rpc.child.stdout.once("data", () => {
      partialLineSeen = true;
    });
    await rpc.wait(() => partialLineSeen, "partial trust request");
    expect(rpc.events).toEqual([]);
    rpc.child.stdin.write("complete-trust-request\n");

    await rpc.wait(() => rpc.events.some((event) => event.value?.id === "trust"), "trust response");
    expect(rpc.events).toContainEqual({ type: "extension_ui_request", method: "confirm", id: "trust" });
    const trustResponse = rpc.events.find((event) => event.value?.id === "trust");
    expect(trustResponse.value).toEqual({ type: "extension_ui_response", id: "trust", confirmed: false });

    rpc.send("fixture prompt");
    await rpc.wait(() => rpc.events.some((event) => event.value?.type === "prompt"), "prompt");
    const prompt = rpc.events.find((event) => event.value?.type === "prompt");
    expect(prompt.value).toEqual({ type: "prompt", message: "fixture prompt" });

    await expect(rpc.wait(() => false, "intentional timeout", 10)).rejects.toThrow(
      "RPC timeout intentional timeout; stderr=fixture stderr\n; fixture pane; events=" + JSON.stringify(rpc.events),
    );
    expect(rpc.stderr()).toContain("fixture stderr");
  } finally {
    const closed = new Promise<void>((resolve) => rpc.child.once("close", resolve));
    rpc.child.kill();
    await closed;
  }
});

test("fixture output checks canonical ancestors, including not-yet-created paths", () => {
  const source = temp();
  const outside = temp();
  mkdirSync(join(source, "nested"));
  symlinkSync(join(source, "nested"), join(outside, "repo-link"));
  expect(() => assertFixtureOutputExternal(source, source)).toThrow("outside the repository");
  expect(() => assertFixtureOutputExternal(source, join(outside, "repo-link", "future"))).toThrow(
    "outside the repository",
  );
  expect(() => assertFixtureOutputExternal(source, join(outside, "future"))).not.toThrow();
});

test("fixture RPC rejects malformed JSON rather than silently discarding it", async () => {
  const root = temp();
  const binary = join(root, "rpc");
  const driver = join(root, "driver.ts");
  writeFileSync(
    binary,
    `#!${process.execPath}
console.log("{bad JSON");
`,
    { mode: 0o755 },
  );
  const fixtureModule = new URL("../scripts/loopback-parent-fixture.ts", import.meta.url).pathname;
  const env = ownedFixtureEnv(root);
  const options = { bruv: binary, cwd: root, env };
  writeFileSync(
    driver,
    `
import { fixtureRpc } from ${JSON.stringify(fixtureModule)};
fixtureRpc({
  ...${JSON.stringify(options)},
  children: [],
  timeoutDetail: () => "",
});
`,
  );
  const proc = Bun.spawn([process.execPath, driver], { cwd: root, env, stdout: "ignore", stderr: "pipe" });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  expect(code).not.toBe(0);
  expect(stderr).toContain("Invalid RPC JSON: {bad JSON");
});
