import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { registerCodexImport } from "../src/codex-import";
import { readConfig, readJson } from "../src/config";
import { sdk } from "./sdk";

async function fixture(config: (dir: string) => string) {
  fs.mkdirSync(".tmp", { recursive: true });
  const dir = fs.mkdtempSync(resolve(".tmp/import-"));
  const home = join(dir, "codex");
  const agent = join(dir, "pi");
  fs.mkdirSync(home);
  fs.mkdirSync(agent);
  fs.writeFileSync(join(home, "config.toml"), config(dir));
  fs.writeFileSync(join(home, "auth.json"), '{"secret":"never copy"}');
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  let confirm = false;
  let previews = 0;
  let reloads = 0;
  const notices: string[] = [];
  const app = await sdk(
    [
      (pi) => {
        const register = pi.registerCommand;
        pi.registerCommand = (name, command) =>
          register(name, {
            ...command,
            handler: (args, ctx) =>
              command.handler(args, {
                ...ctx,
                reload: async () => {
                  reloads++;
                },
              }),
          });
        registerCodexImport(pi, agent);
      },
    ],
    {
      confirm: async (_title, preview) => {
        expect(preview.length).toBeGreaterThan(0);
        previews++;
        return confirm;
      },
      notify: (message) => {
        notices.push(message);
      },
    },
    dir,
  );
  return {
    ...app,
    home,
    agent,
    notices,
    previews: () => previews,
    reloads: () => reloads,
    accept: () => {
      confirm = true;
    },
    async close() {
      await app.close();
      if (previous === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("Codex import previews, merges every supported field, and never reads sign-in tokens", async () => {
  const app = await fixture(
    (dir) => `
model = "gpt-6-astra"
model_reasoning_effort = "xhigh"
service_tier = "fast"
[mcp_servers.local]
command = "npx"
args = ["-y", "example"]
env = { KEY = "value" }
[mcp_servers.remote]
url = "https://example.invalid/mcp"
http_headers = { Authorization = "Bearer example" }
[mcp_servers.kept]
command = "replace-me"
[mcp_servers.off]
command = "never-start"
enabled = false
[projects.${JSON.stringify(join(dir, "trusted"))}]
trust_level = "trusted"
[projects.${JSON.stringify(join(dir, "untrusted"))}]
trust_level = "untrusted"
`,
  );
  const read = fs.readFileSync;
  const files: string[] = [];
  const reads = spyOn(fs, "readFileSync").mockImplementation(((
    path: Parameters<typeof read>[0],
    ...args: unknown[]
  ) => {
    files.push(String(path));
    if (String(path).endsWith("auth.json")) throw new Error("Read sign-in tokens");
    return Reflect.apply(read, fs, [path, ...args]);
  }) as typeof read);
  try {
    fs.mkdirSync(join(app.home, "skills"));
    fs.mkdirSync(join(app.home, "prompts"));
    fs.mkdirSync(join(app.agent, "prompts"));
    fs.writeFileSync(join(app.home, "prompts/new.md"), "fixture prompt");
    fs.writeFileSync(join(app.home, "prompts/kept.md"), "replacement");
    fs.writeFileSync(join(app.agent, "prompts/kept.md"), "existing");
    fs.symlinkSync(join(app.home, "auth.json"), join(app.home, "prompts/tokens.md"));
    const settings = { theme: "dark", skills: ["existing-skills"], custom: { value: 7 } };
    const mcp = { autoEnableCodemode: false, mcpServers: { kept: { command: "original" } } };
    const bruv = { ...readConfig(app.agent), profiles: { fast: { thinking: "low" as const } }, custom: 9 };
    for (const [name, value] of Object.entries({ "settings.json": settings, "mcp.json": mcp, "bruv.json": bruv }))
      fs.writeFileSync(join(app.agent, name), JSON.stringify(value));
    new ProjectTrustStore(app.agent).set(join(app.agent, "existing"), false);
    await app.session.prompt("/import-codex");
    expect(readJson(join(app.agent, "settings.json"), {})).toEqual(settings);
    expect(readJson(join(app.agent, "mcp.json"), {})).toEqual(mcp);
    expect(fs.existsSync(join(app.agent, "prompts/new.md"))).toBe(false);
    expect(app.reloads()).toBe(0);
    app.accept();
    await app.session.prompt("/import-codex");
    expect(readJson(join(app.agent, "settings.json"), {})).toEqual({
      ...settings,
      skills: ["existing-skills", join(app.home, "skills")],
      defaultProvider: "openai-codex",
      defaultModel: "gpt-6-astra",
      defaultThinkingLevel: "xhigh",
    });
    expect(readJson(join(app.agent, "mcp.json"), {})).toEqual({
      ...mcp,
      mcpServers: {
        ...mcp.mcpServers,
        local: { command: "npx", args: ["-y", "example"], env: { KEY: "value" } },
        remote: { url: "https://example.invalid/mcp", headers: { Authorization: "Bearer example" } },
        off: { command: "never-start", enabled: false },
      },
    });
    expect(readConfig(app.agent)).toEqual({ ...bruv, fast: true, fastConfirmed: true });
    expect(fs.readFileSync(join(app.agent, "prompts/new.md"), "utf8")).toBe("fixture prompt");
    expect(fs.readFileSync(join(app.agent, "prompts/kept.md"), "utf8")).toBe("existing");
    const trust = readJson<Record<string, boolean>>(join(app.agent, "trust.json"), {});
    expect(trust[resolve(app.home, "../trusted")]).toBe(true);
    expect(trust[resolve(app.home, "../untrusted")]).toBeUndefined();
    expect(trust[join(app.agent, "existing")]).toBe(false);
    expect(fs.existsSync(join(app.agent, "auth.json"))).toBe(false);
    expect(fs.existsSync(join(app.agent, "prompts/tokens.md"))).toBe(false);
    expect(files.some((path) => path.endsWith("auth.json"))).toBe(false);
    expect(app.previews()).toBe(2);
    expect(app.reloads()).toBe(1);
    await app.session.prompt("/import-codex");
    expect(readJson<{ skills: string[] }>(join(app.agent, "settings.json"), { skills: [] }).skills).toHaveLength(2);
    const count = app.notices.length;
    await app.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
    expect(app.notices).toHaveLength(count);
    expect(readConfig(app.agent).codexImportOffered).toBe(true);
  } finally {
    reads.mockRestore();
    await app.close();
  }
});

test.each(["minimal", "low", "medium", "high", "unknown"])(
  "imports thinking %s and skips unknown models",
  async (level) => {
    const app = await fixture(
      () => `model = "missing-model-781"\nmodel_reasoning_effort = "${level}"\nservice_tier = "priority"`,
    );
    try {
      const settings = { defaultProvider: "faux", defaultModel: "faux-1", defaultThinkingLevel: "low" };
      fs.writeFileSync(join(app.agent, "settings.json"), JSON.stringify(settings));
      app.accept();
      await app.session.prompt("/import-codex");
      expect(readJson(join(app.agent, "settings.json"), {})).toEqual({
        ...settings,
        defaultThinkingLevel: level === "unknown" ? "low" : level,
      });
      expect(readConfig(app.agent)).toMatchObject({ fast: true, fastConfirmed: true });
      expect(app.reloads()).toBe(1);
    } finally {
      await app.close();
    }
  },
);
