import { expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { saveConfig } from "../src/config";
import { registerVoice } from "../src/voice";
import type { Engine } from "../src/voice/call";
import { readKey, saveKey } from "../src/voice/keys";
import { missing } from "../src/voice/models";
import { sdk } from "./sdk";

const engine = (): Engine => ({
  hear() {},
  speak() {},
  hush() {},
  talk() {},
  onEvent() {},
  close: async () => {},
});

/** bruv with voice, fake models, engine and terminal audio, and the UI answers given. */
async function voice(ui: Partial<ExtensionUIContext> = {}, withModels = true) {
  const agentDir = join(process.env.PI_CODING_AGENT_DIR as string, `voice-commands-${Date.now()}-${Math.random()}`);
  const seen = { engines: 0, here: 0, opened: "", notes: [] as string[] };
  if (withModels) {
    const models = join(agentDir, "bruv", "voice", "models");
    for (const model of missing(models)) mkdirSync(join(models, model.name), { recursive: true });
  }
  const app = await sdk(
    [
      (pi) =>
        registerVoice(pi, {
          engine: () => {
            seen.engines++;
            return engine();
          },
          local: () => {
            seen.here++;
            return { stop: () => seen.here-- };
          },
          open: (url) => {
            seen.opened = url;
          },
          fetch: (async () =>
            new Response(JSON.stringify({ success: false, errors: [] }), { status: 403 })) as unknown as typeof fetch,
          agentDir,
        }),
    ],
    { notify: (text) => seen.notes.push(text), ...ui },
  );
  const tools = () => app.session.getActiveToolNames();
  return { app, agentDir, seen, tools };
}

test("/voice adds and removes only the terminal while the page is on", async () => {
  const { app, agentDir, seen, tools } = await voice();
  try {
    saveConfig({ voice: { port: 0 } }, agentDir);
    await app.session.prompt("/voice web");
    expect(seen.opened).toContain("?t=");
    await app.session.prompt("/voice");
    expect(seen.here).toBe(1);
    await app.session.prompt("/voice");
    expect(seen.here).toBe(0);
    // The page and the show tool are still there.
    expect((await fetch(seen.opened)).status).toBe(200);
    expect(tools()).toContain("show");
    await app.session.prompt("/voice off");
    expect(tools()).not.toContain("show");
    await expect(fetch(seen.opened)).rejects.toThrow();
    // Terminal alone: /voice again turns voice off.
    await app.session.prompt("/voice");
    expect(seen.here).toBe(1);
    await app.session.prompt("/voice");
    expect(seen.here).toBe(0);
    expect(tools()).not.toContain("show");
  } finally {
    await app.close();
  }
});

test("cancelling /voice tunnel starts nothing, and a saved key isn't used on Escape", async () => {
  const answers: (string | undefined)[] = [];
  const { app, agentDir, seen, tools } = await voice({ input: async () => answers.shift() });
  try {
    answers.push(undefined);
    await app.session.prompt("/voice tunnel");
    expect(seen.engines).toBe(0);
    await saveKey("saved-key", agentDir);
    answers.push("voice.example.com", undefined);
    await app.session.prompt("/voice tunnel");
    expect(seen.engines).toBe(0);
    expect(tools()).not.toContain("show");
    expect(readKey(agentDir)).toBe("saved-key");
  } finally {
    await app.close();
  }
});

test("a tunnel that fails stops the voice it started", async () => {
  const answers: (string | undefined)[] = [];
  const { app, agentDir, seen, tools } = await voice({
    input: async () => answers.shift(),
    confirm: async () => false,
  });
  try {
    saveConfig({ voice: { port: 0 } }, agentDir);
    answers.push("voice.example.com", "api-token");
    await app.session.prompt("/voice tunnel");
    expect(seen.engines).toBe(1);
    expect(tools()).not.toContain("show");
    // With the terminal already on, a failed tunnel leaves it on.
    await app.session.prompt("/voice");
    answers.push("voice.example.com", "api-token");
    await app.session.prompt("/voice tunnel");
    expect(seen.here).toBe(1);
    expect(tools()).toContain("show");
  } finally {
    await app.close();
  }
});

test("/voice tunnel off with nothing set up writes nothing", async () => {
  const { app, agentDir } = await voice();
  try {
    await app.session.prompt("/voice tunnel off");
    expect(existsSync(join(agentDir, "bruv.json"))).toBe(false);
  } finally {
    await app.close();
  }
});

test("declining the model download says voice stays off", async () => {
  const { app, seen, tools } = await voice({ confirm: async () => false }, false);
  try {
    await app.session.prompt("/voice");
    expect(seen.engines).toBe(0);
    expect(seen.notes).toHaveLength(1);
    expect(tools()).not.toContain("show");
  } finally {
    await app.close();
  }
});
