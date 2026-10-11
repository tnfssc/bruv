import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readConfig } from "../src/config";
import { registerMigrate } from "../src/migrate";
import { sdk } from "./sdk";

const write = (path: string, data: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data));
};

test("migration brings over only what Pi lacks, after confirmation, once", async () => {
  let answer = false;
  const notes: string[] = [];
  mkdirSync(".tmp", { recursive: true });
  const base = mkdtempSync(resolve(".tmp/migrate-"));
  const agentDir = join(base, "agent");
  const home = join(base, "old");
  const app = await sdk([(pi) => registerMigrate(pi, agentDir)], {
    confirm: async () => answer,
    notify: (message) => notes.push(message),
  });
  const previous = process.env.BRUV_OLD_HOME;
  process.env.BRUV_OLD_HOME = home;
  try {
    write(join(home, "agent/auth.json"), { "openai-codex": { type: "oauth", refresh: "r1" }, other: { key: "k" } });
    write(join(agentDir, "auth.json"), { other: { key: "keep" } });
    write(join(home, "agent/settings.json"), { defaultModel: "gpt-6-astra", theme: "dark", lastChangelogVersion: "0" });
    write(join(agentDir, "settings.json"), { theme: "light" });
    write(join(home, "subagents.json"), { fast: { model: "p/fast" }, orchestrator: { model: "p/x" } });
    const live = join(home, "agent/sessions/--live--/a.jsonl");
    write(live, `${JSON.stringify({ type: "session", cwd: base })}\n`);
    write(
      join(home, "agent/sessions/--gone--/b.jsonl"),
      `${JSON.stringify({ type: "session", cwd: join(home, "gone") })}\n`,
    );
    const sessions = app.session.sessionManager.getSessionDir();

    await app.session.prompt("/bruv-migrate");
    expect(JSON.parse(readFileSync(join(agentDir, "auth.json"), "utf8"))).toEqual({ other: { key: "keep" } });

    answer = true;
    await app.session.prompt("/bruv-migrate");
    const auth = join(agentDir, "auth.json");
    expect(JSON.parse(readFileSync(auth, "utf8"))).toEqual({
      other: { key: "keep" },
      "openai-codex": { type: "oauth", refresh: "r1" },
    });
    expect(statSync(auth).mode & 0o777).toBe(0o600);
    const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
    expect(settings.theme).toBe("light");
    expect(settings.defaultModel).toBe("gpt-6-astra");
    expect(settings.lastChangelogVersion).toBeUndefined();
    expect(settings.codemode.mode).toBe("only");
    expect(readConfig(agentDir).profiles).toEqual({ fast: { model: "p/fast" } });
    expect(readFileSync(join(sessions, "a.jsonl"), "utf8")).toBe(readFileSync(live, "utf8"));
    expect(existsSync(join(sessions, "b.jsonl"))).toBe(false);
    expect(readConfig(agentDir).migrateOffered).toBe(true);

    const count = notes.length;
    await app.session.prompt("/bruv-migrate");
    expect(notes.length).toBe(count + 1);
    expect(readdirSync(sessions).filter((name) => name.endsWith(".jsonl"))).toEqual(["a.jsonl"]);
  } finally {
    if (previous === undefined) delete process.env.BRUV_OLD_HOME;
    else process.env.BRUV_OLD_HOME = previous;
    await app.close();
    rmSync(base, { recursive: true, force: true });
  }
});
