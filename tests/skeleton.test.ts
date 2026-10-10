import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import bruv from "../extensions/bruv";
import { enableCodemode } from "../src/codemode";
import { type Config, readConfig } from "../src/config";
import { sdk } from "./sdk";

mkdirSync(".tmp", { recursive: true });
const dir = mkdtempSync(resolve(".tmp/tests-"));
const previousDir = process.env.PI_CODING_AGENT_DIR;
const previousCodex = process.env.CODEX_HOME;
process.env.CODEX_HOME = join(dir, "codex");
process.env.PI_CODING_AGENT_DIR = dir;
const app = await sdk([bruv], undefined, dir, "rpc", [
  { path: join(dir, "AGENTS.md"), content: "fixture-context-781" },
]);
const { session, faux, resourceLoader } = app;
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
  if (previousCodex === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousCodex;
  if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousDir;
});

test("setup confirms, merges settings, and preserves other keys", async () => {
  expect(resourceLoader.getExtensions().errors).toEqual([]);
  const path = join(dir, "settings.json");
  const original = { theme: "dark", custom: { value: 4 }, codemode: { inlineBudget: 1200 } };
  writeFileSync(path, JSON.stringify(original));
  let confirmed = false;
  await session.bindExtensions({
    uiContext: {
      ...session.extensionRunner.createContext().ui,
      confirm: async () => confirmed,
    },
    mode: "rpc",
  });
  await session.prompt("/bruv-setup");
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(original);
  confirmed = true;
  await session.prompt("/bruv-setup");
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
    ...original,
    defaultTools: ["+codemode"],
    codemode: { inlineBudget: 1200, mode: "only" },
  });
});

test("guidance extends the prompt while preserving Pi context files", async () => {
  const size = session.systemPrompt.length;
  faux.setResponses([
    (context) => {
      const system = context.messages.find((message) => message.role === "system");
      expect(system?.sections?.bruv?.length).toBeGreaterThan(0);
      expect(JSON.stringify(system)).toContain("fixture-context-781");
      expect(session.systemPrompt.length).toBeGreaterThan(size);
      return fauxAssistantMessage("781");
    },
  ]);
  await session.prompt("go");
  expect(session.getLastAssistantText()).toBe("781");
});

test("profiles use the Pi agent directory and accept missing fields", () => {
  expect(readConfig()).toEqual({});
  const config: Config = { profiles: { fast: { model: "faux/faux-1" }, normal: { thinking: "high" } } };
  writeFileSync(join(dir, "bruv.json"), JSON.stringify(config));
  expect(readConfig()).toEqual(config);
});

test("setup preserves explicit and relative tool lists", () => {
  for (const [before, after] of [
    [
      ["read", "bash"],
      ["read", "bash", "codemode"],
    ],
    [
      ["+read", "-bash"],
      ["+read", "-bash", "+codemode"],
    ],
    [["+codemode"], ["+codemode"]],
    [
      ["codemode", "read"],
      ["codemode", "read"],
    ],
  ]) {
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ defaultTools: before }));
    enableCodemode(dir);
    expect(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).defaultTools).toEqual(after);
  }
});
