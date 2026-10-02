import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { networkNoneFixture, assertFixtureOutputExternal } from "../scripts/network-none-fixture";
import { fixtureRpc, loopbackParent } from "../scripts/loopback-parent-fixture";

const roots: string[] = [];
const temp = () => {
  const root = mkdtempSync(join(tmpdir(), "tooling-fixture-"));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("network-none fixture isolates secrets/config and owns only its scratch root", () => {
  const root = temp(),
    external = temp();
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
  expect(JSON.parse(fixture.run(process.execPath, ["-e", "console.log(JSON.stringify(process.env))"])).HOME).toBe(
    fixture.env.HOME,
  );
  expect(() => fixture.run(process.execPath, ["-e", "console.error('intentional failure');process.exit(7)"])).toThrow(
    "intentional failure",
  );
  expect(fixture.containerStarted).toBe(false);
  fixture.cleanup();
  expect(existsSync(root)).toBe(false);
  expect(readFileSync(join(external, "evidence"), "utf8")).toBe("retained");
});

test("loopback fake parent writes matching model endpoint and counts accepted calls only", async () => {
  const root = temp();
  let calls = 0;
  const provider = loopbackParent(root, () => calls++);
  try {
    const model = JSON.parse(readFileSync(join(root, "models.json"), "utf8")).providers.fixture;
    expect(model.apiKey).toBe("fixture-only");
    expect(model.baseUrl).toBe("http://127.0.0.1:" + provider.port + "/v1");
    expect((await fetch(model.baseUrl + "/chat/completions")).status).toBe(404);
    expect((await fetch(model.baseUrl + "/wrong", { method: "POST", body: "{}" })).status).toBe(404);
    expect(calls).toBe(0);
    const response = await fetch(model.baseUrl + "/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    });
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const events = (await response.text()).split("\n\n").filter(Boolean);
    expect(events).toHaveLength(3);
    expect(events[2]).toBe("data: [DONE]");
    expect(JSON.parse(events[0].slice(6)).choices[0].delta).toHaveProperty("content");
    expect(calls).toBe(1);
  } finally {
    provider.stop(true);
  }
});

test("fixture RPC buffers lines, denies trust, sends prompts and retains timeout diagnostics", async () => {
  const root = temp(),
    binary = join(root, "rpc");
  const fixture = [
    "#!" + process.execPath,
    "console.error('fixture stderr');",
    'process.stdout.write(\'{"type":"extension_ui_request",\');',
    'setTimeout(() => process.stdout.write(\'"method":"confirm","id":"trust"}\\n\'), 10);',
    "process.stdin.on('data', bytes => {for (const line of String(bytes).trim().split('\\n')) console.log(JSON.stringify({type:'received',value:JSON.parse(line)}));});",
  ].join("\n");
  writeFileSync(binary, fixture, { mode: 0o755 });
  const children: ReturnType<typeof import("node:child_process").spawn>[] = [];
  const rpc = fixtureRpc({
    bruv: binary,
    cwd: root,
    home: root,
    agentDir: root,
    children,
    noSession: true,
    timeoutDetail: (events) => "; fixture pane; events=" + JSON.stringify(events),
  });
  try {
    expect(children).toEqual([rpc.child]);
    await rpc.wait(() => rpc.events.some((event) => event.value?.id === "trust"), "trust response");
    expect(rpc.events[1].value).toEqual({ type: "extension_ui_response", id: "trust", confirmed: false });
    rpc.send("fixture prompt");
    await rpc.wait(() => rpc.events.some((event) => event.value?.type === "prompt"), "prompt");
    expect(rpc.events.at(-1).value.message).toBe("fixture prompt");
    await expect(rpc.wait(() => false, "intentional timeout", 10)).rejects.toThrow("fixture pane; events=");
    expect(rpc.stderr()).toContain("fixture stderr");
  } finally {
    rpc.child.kill();
    await new Promise<void>((resolve) => rpc.child.once("close", resolve));
  }
});

test("fixture output checks canonical ancestors, including not-yet-created paths", () => {
  const source = temp(),
    outside = temp();
  mkdirSync(join(source, "nested"));
  symlinkSync(join(source, "nested"), join(outside, "repo-link"));
  expect(() => assertFixtureOutputExternal(source, source)).toThrow("outside the repository");
  expect(() => assertFixtureOutputExternal(source, join(outside, "repo-link", "future"))).toThrow(
    "outside the repository",
  );
  expect(() => assertFixtureOutputExternal(source, join(outside, "future"))).not.toThrow();
});

test("fixture RPC rejects malformed JSON rather than silently discarding it", async () => {
  const root = temp(),
    binary = join(root, "rpc"),
    driver = join(root, "driver.ts");
  writeFileSync(binary, "#!" + process.execPath + "\nconsole.log('{bad JSON');\n", { mode: 0o755 });
  writeFileSync(
    driver,
    "import { fixtureRpc } from " +
      JSON.stringify(new URL("../scripts/loopback-parent-fixture.ts", import.meta.url).pathname) +
      ";fixtureRpc({..." +
      JSON.stringify({ bruv: binary, cwd: root, home: root, agentDir: root }) +
      ',children:[],timeoutDetail:()=>""});',
  );
  const proc = Bun.spawn([process.execPath, driver], { stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  expect(code).not.toBe(0);
  expect(stderr).toContain("Invalid RPC JSON: {bad JSON");
});
