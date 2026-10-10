import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import * as Pi from "@earendil-works/pi-coding-agent";
import bruv from "../extensions/bruv";
import { type Config, readConfig } from "../src/config";

mkdirSync(".tmp", { recursive: true });
const dir = mkdtempSync(resolve(".tmp/tests-"));
const previousDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = dir;
const paths = { cwd: dir, agentDir: dir };
const faux = fauxProvider();
const modelRuntime = await Pi.ModelRuntime.create({
  credentials: new InMemoryCredentialStore(),
  modelsPath: null,
  refreshOnCreate: false,
  modelsStorePath: join(dir, "models.json"),
});
modelRuntime.registerNativeProvider(faux.provider);
const settingsManager = Pi.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
const resourceLoader = new Pi.DefaultResourceLoader({
  ...paths,
  settingsManager,
  extensionFactories: [bruv],
  noExtensions: true,
  noSkills: true,
  noThemes: true,
  noPromptTemplates: true,
  noContextFiles: true,
  agentsFilesOverride: () => ({ agentsFiles: [{ path: join(dir, "AGENTS.md"), content: "fixture-context-781" }] }),
});
await resourceLoader.reload();
const { session } = await Pi.createAgentSession({
  ...paths,
  modelRuntime,
  model: faux.getModel(),
  resourceLoader,
  settingsManager,
  sessionManager: Pi.SessionManager.inMemory(dir),
});
afterAll(() => {
  session.dispose();
  rmSync(dir, { recursive: true, force: true });
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
