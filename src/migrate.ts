import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { enableCodemode } from "./codemode";
import { type Config, readConfig, readJson, saveConfig } from "./config";

type Settings = ReturnType<ExtensionAPI["getSettings"]>;
const SETTINGS = ["defaultProvider", "defaultModel", "defaultThinkingLevel", "theme", "hideThinkingBlock"] as const;
const save = (path: string, data: unknown) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
const oldHome = () => process.env.BRUV_OLD_HOME ?? join(homedir(), ".bruv");

function firstLine(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf8").split("\n", 1)[0]) as { cwd?: unknown };
  } catch {
    return undefined;
  }
}

/** What bruv 0.x left behind that Pi does not have yet. */
export function plan(sessionDir: string, agentDir = getAgentDir(), home = oldHome()) {
  const old = join(home, "agent");
  const auth = readJson<Record<string, unknown>>(join(old, "auth.json"), {});
  const piAuth = readJson<Record<string, unknown>>(join(agentDir, "auth.json"), {});
  const signIns = Object.keys(auth).filter((provider) => !(provider in piAuth));
  const settings = readJson<Settings>(join(old, "settings.json"), {});
  const piSettings = readJson<Settings>(join(agentDir, "settings.json"), {});
  const changes = Object.fromEntries(
    SETTINGS.filter((key) => settings[key] !== undefined && piSettings[key] === undefined).map((key) => [
      key,
      settings[key],
    ]),
  ) as Partial<Settings>;
  const agents = readJson<Record<string, { model?: unknown }>>(join(home, "subagents.json"), {});
  const profiles: Config["profiles"] = {};
  for (const name of ["fast", "normal"] as const) {
    const model = agents[name]?.model;
    if (typeof model === "string" && !readConfig(agentDir).profiles?.[name]) profiles[name] = { model };
  }
  // Only sessions for folders that still exist; old runs left thousands for deleted worktrees.
  const sessions: { from: string; to: string }[] = [];
  const oldSessions = join(old, "sessions");
  // Pi keeps one folder per project under agent/sessions; a custom session folder is flat.
  const nested = dirname(sessionDir) === join(agentDir, "sessions");
  for (const folder of existsSync(oldSessions) ? readdirSync(oldSessions) : []) {
    const dir = join(oldSessions, folder);
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".jsonl"))) {
      const cwd = firstLine(join(dir, file))?.cwd;
      const to = nested ? join(dirname(sessionDir), folder, file) : join(sessionDir, file);
      if (typeof cwd === "string" && existsSync(cwd) && !existsSync(to)) sessions.push({ from: join(dir, file), to });
    }
  }
  return { auth, signIns, changes, profiles, sessions };
}

export async function migrate(ctx: ExtensionContext, agentDir = getAgentDir(), home = oldHome()) {
  if (!existsSync(join(home, "agent"))) {
    ctx.ui.notify("No bruv 0.x data found.", "info");
    return undefined;
  }
  const found = plan(ctx.sessionManager.getSessionDir(), agentDir, home);
  const piSettings = readJson<Settings>(join(agentDir, "settings.json"), {});
  const setup = piSettings.codemode?.mode !== "only" || piSettings.quietStartup === undefined;
  const preview = [
    ...found.signIns.map((provider) => `Sign-in: ${provider}`),
    ...Object.entries(found.changes).map(([key, value]) => `Setting: ${key} = ${String(value)}`),
    ...Object.entries(found.profiles ?? {}).map(([name, profile]) => `Agent model (${name}): ${profile.model}`),
    ...(found.sessions.length ? [`Sessions: ${found.sessions.length}, for folders that still exist`] : []),
    ...(setup ? ["Codemode only and a quiet start (same as /bruv-setup)"] : []),
  ];
  if (!preview.length) {
    ctx.ui.notify("Everything from bruv 0.x is already here.", "info");
    return undefined;
  }
  const note = found.signIns.length
    ? "\n\nOld bruv shares this sign-in; if you keep using it, it may ask you to sign in again."
    : "";
  if (!(await ctx.ui.confirm("Bring over bruv 0.x?", `${preview.join("\n")}${note}`))) return undefined;
  mkdirSync(agentDir, { recursive: true });
  // Read again after the dialog, and never replace anything that appeared meanwhile.
  const authPath = join(agentDir, "auth.json");
  const piAuth = readJson<Record<string, unknown>>(authPath, {});
  const added = Object.fromEntries(found.signIns.filter((p) => !(p in piAuth)).map((p) => [p, found.auth[p]]));
  if (Object.keys(added).length) {
    writeFileSync(authPath, `${JSON.stringify({ ...piAuth, ...added }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(authPath, 0o600);
  }
  const settingsPath = join(agentDir, "settings.json");
  const current = readJson<Settings>(settingsPath, {});
  const fresh = Object.fromEntries(Object.entries(found.changes).filter(([key]) => !(key in current)));
  if (Object.keys(fresh).length) save(settingsPath, { ...current, ...fresh });
  if (setup) enableCodemode(agentDir);
  if (Object.keys(found.profiles ?? {}).length)
    saveConfig({ profiles: { ...found.profiles, ...readConfig(agentDir).profiles } }, agentDir);
  let copied = 0;
  for (const { from, to } of found.sessions) {
    mkdirSync(dirname(to), { recursive: true });
    try {
      copyFileSync(from, to, constants.COPYFILE_EXCL);
      copied++;
    } catch {
      // Already there.
    }
  }
  saveConfig({ migrateOffered: true }, agentDir);
  return {
    message: `bruv 0.x brought over${copied ? `, including ${copied} session${copied === 1 ? "" : "s"} (open with /resume)` : ""}. Old files stay in ${home}.`,
    model: "defaultModel" in fresh,
  };
}

export function registerMigrate(pi: ExtensionAPI, agentDir = getAgentDir()) {
  pi.on("session_start", async (_event, ctx) => {
    const config = readConfig(agentDir);
    if (config.migrated) {
      // The reload after /bruv-migrate lands here with a fresh context.
      saveConfig({ migrated: undefined }, agentDir);
      const settings = readJson<Settings>(join(agentDir, "settings.json"), {});
      // Pi read sign-ins at startup; pick up the ones just copied.
      if (config.migrated.model) await ctx.modelRegistry.refresh().catch(() => undefined);
      const model =
        config.migrated.model && settings.defaultProvider && settings.defaultModel
          ? ctx.modelRegistry.find(settings.defaultProvider, settings.defaultModel)
          : undefined;
      // Pi chose its model before the sign-in arrived; switch to the one bruv 0.x used.
      if (model && (await pi.setModel(model)) && settings.defaultThinkingLevel)
        pi.setThinkingLevel(settings.defaultThinkingLevel);
      const { message } = config.migrated;
      // Pi shows its own "Reloaded" line after this handler; show ours after it.
      if (ctx.hasUI) setTimeout(() => ctx.ui.notify(message, "info"), 200).unref();
      return;
    }
    if (process.env.BRUV_DEPTH || !ctx.hasUI || !existsSync(join(oldHome(), "agent"))) return;
    if (config.migrateOffered) return;
    ctx.ui.notify(
      "Found bruv 0.x. Run /bruv-migrate to bring your sign-in, settings, agent models and sessions.",
      "info",
    );
    saveConfig({ migrateOffered: true }, agentDir);
  });
  pi.registerCommand("bruv-migrate", {
    description: "Bring sign-in, settings, agent models and sessions over from bruv 0.x",
    async handler(_args, ctx) {
      const done = await migrate(ctx, agentDir);
      if (!done) return;
      saveConfig({ migrated: done }, agentDir);
      await ctx.reload();
    },
  });
}
