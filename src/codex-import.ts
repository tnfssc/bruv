import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { type ExtensionAPI, getAgentDir, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { parse } from "smol-toml";
import { readConfig, readJson, saveConfig } from "./config";

type Settings = ReturnType<ExtensionAPI["getSettings"]>;
type Server = Parameters<ExtensionAPI["registerMcpServer"]>[1];
type Mcp = { mcpServers?: Record<string, Server> };
type CodexServer = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  http_headers?: Record<string, string>;
  enabled?: boolean;
};
type Codex = {
  model?: string;
  model_reasoning_effort?: string;
  service_tier?: string;
  mcp_servers?: Record<string, CodexServer>;
  projects?: Record<string, { trust_level?: string }>;
};
const codexHome = () => resolve(process.env.CODEX_HOME ?? join(homedir(), ".codex"));
const save = (path: string, data: unknown) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
const serverKey = (name: string) => name.replaceAll("-", "_");

export function registerCodexImport(pi: ExtensionAPI, agentDir = getAgentDir()) {
  pi.on("session_start", (_event, ctx) => {
    if (process.env.BRUV_DEPTH || !ctx.hasUI || !existsSync(join(codexHome(), "config.toml"))) return;
    if (readConfig(agentDir).codexImportOffered) return;
    ctx.ui.notify(
      "Found Codex settings. Run /import-codex to bring your model, MCP servers, skills and prompts.",
      "info",
    );
    saveConfig({ codexImportOffered: true }, agentDir);
  });
  pi.registerCommand("import-codex", {
    description: "Preview and import your Codex settings into Pi.",
    async handler(_args, ctx) {
      const home = codexHome();
      const path = join(home, "config.toml");
      if (!existsSync(path)) {
        ctx.ui.notify(`No Codex settings at ${path}.`, "info");
        return;
      }
      const config = parse(readFileSync(path, "utf8")) as Codex;
      const settingsPath = join(agentDir, "settings.json");
      const mcpPath = join(agentDir, "mcp.json");
      const settings = readJson<Settings>(settingsPath, {});
      const mcp = readJson<Mcp>(mcpPath, {});
      const project = ctx.isProjectTrusted() ? readJson<Mcp>(join(ctx.cwd, ".pi/mcp.json"), {}) : {};
      const names = new Set(
        [...Object.keys(mcp.mcpServers ?? {}), ...Object.keys(project.mcpServers ?? {})].map(serverKey),
      );
      const changes: Partial<Settings> = {};
      const servers: Record<string, Server> = {};
      const preview: string[] = [];
      if (config.model) {
        if (ctx.modelRegistry.find("openai-codex", config.model)) {
          changes.defaultProvider = "openai-codex";
          changes.defaultModel = config.model;
          preview.push(`Model: openai-codex/${config.model}`);
        } else preview.push(`Skip model ${config.model}: Pi does not know it.`);
      }
      const levels = ["minimal", "low", "medium", "high", "xhigh"] as const;
      const level = levels.find((value) => value === config.model_reasoning_effort);
      if (level) {
        changes.defaultThinkingLevel = level;
        preview.push(`Thinking: ${level}`);
      } else if (config.model_reasoning_effort)
        preview.push(`Skip thinking level ${config.model_reasoning_effort}: Pi has no matching level.`);
      const fast = config.service_tier === "fast" || config.service_tier === "priority";
      if (fast) preview.push("Fast mode: on (uses more ChatGPT quota, including agents)");
      for (const [name, server] of Object.entries(config.mcp_servers ?? {})) {
        if (names.has(serverKey(name))) {
          preview.push(`Skip MCP server ${name}: already exists.`);
          continue;
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(name) || (!server.command && !server.url)) {
          preview.push(`Skip MCP server ${name}: Pi needs a valid name and a command or URL.`);
          continue;
        }
        servers[name] = server.command
          ? { command: server.command, args: server.args, env: server.env, cwd: server.cwd, enabled: server.enabled }
          : { url: server.url as string, headers: server.headers ?? server.http_headers, enabled: server.enabled };
        names.add(serverKey(name));
        preview.push(`MCP server: ${name}`);
      }
      const skills = join(home, "skills");
      const addSkills = existsSync(skills) && !settings.skills?.includes(skills);
      if (addSkills) preview.push(`Skills: ${skills}`);
      const prompts = join(home, "prompts");
      const copies = existsSync(prompts)
        ? readdirSync(prompts, { withFileTypes: true })
            .filter((file) => file.isFile() && file.name.endsWith(".md"))
            .map((file) => file.name)
            .sort()
            .filter((name) => {
              if (!existsSync(join(agentDir, "prompts", name))) return true;
              preview.push(`Skip prompt ${name}: already exists.`);
              return false;
            })
        : [];
      for (const name of copies) preview.push(`Prompt: ${name}`);
      const trusted = Object.entries(config.projects ?? {})
        .filter(([, value]) => value.trust_level === "trusted")
        .map(([path]) => ({ path, decision: true }));
      for (const { path } of trusted) preview.push(`Trust project: ${path}`);
      if (!preview.length) {
        ctx.ui.notify("No settings to import.", "info");
        return;
      }
      if (!(await ctx.ui.confirm("Import Codex settings?", preview.join("\n")))) return;
      mkdirSync(agentDir, { recursive: true });
      // Read again after the dialog so changes made while it was open survive.
      const current = readJson<Settings>(settingsPath, {});
      if (addSkills) changes.skills = [...new Set([...(current.skills ?? []), skills])];
      if (Object.keys(changes).length) save(settingsPath, { ...current, ...changes });
      if (fast) saveConfig({ fast: true, fastConfirmed: true }, agentDir);
      if (Object.keys(servers).length) {
        const current = readJson<Mcp>(mcpPath, {});
        const existing = new Set(Object.keys(current.mcpServers ?? {}).map(serverKey));
        const added = Object.fromEntries(Object.entries(servers).filter(([name]) => !existing.has(serverKey(name))));
        save(mcpPath, { ...current, mcpServers: { ...current.mcpServers, ...added } });
      }
      if (copies.length) mkdirSync(join(agentDir, "prompts"), { recursive: true });
      for (const name of copies) {
        const destination = join(agentDir, "prompts", name);
        if (!existsSync(destination)) copyFileSync(join(prompts, name), destination, constants.COPYFILE_EXCL);
      }
      if (trusted.length) new ProjectTrustStore(agentDir).setMany(trusted);
      ctx.ui.notify("Codex settings imported. Sign in to Pi with /login if needed.", "info");
      if (ctx.reload) await ctx.reload();
      else ctx.ui.notify("Run /reload to use the imported settings.", "info");
    },
  });
}
