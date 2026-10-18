import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { readConfig, saveConfig } from "../src/config";
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
async function voice(
  ui: Partial<ExtensionUIContext> = {},
  withModels = true,
  agentDir = join(process.env.PI_CODING_AGENT_DIR as string, `voice-commands-${Date.now()}-${Math.random()}`),
) {
  const seen = { engines: 0, here: 0, notes: [] as string[], speeds: [] as number[] };
  /** The first link to the page in what bruv said, starting with `start`. */
  const link = (start = "http") =>
    seen.notes.flatMap((note) => note.match(/https?:\/\/\S+\?t=\S+/g) ?? []).find((url) => url.startsWith(start)) ?? "";
  if (withModels) {
    const models = join(agentDir, "bruv", "voice", "models");
    for (const model of missing(models)) mkdirSync(join(models, model.name), { recursive: true });
  }
  const app = await sdk(
    [
      (pi) =>
        registerVoice(pi, {
          engine: (_paths, _threads, _cloud, speed) => {
            seen.engines++;
            seen.speeds.push(speed ?? 1);
            return { ...engine(), setSpeed: (value) => seen.speeds.push(value) };
          },
          local: () => {
            seen.here++;
            return { stop: () => seen.here-- };
          },
          fetch: (async () =>
            new Response(JSON.stringify({ success: false, errors: [] }), { status: 403 })) as unknown as typeof fetch,
          agentDir,
        }),
    ],
    { notify: (text) => seen.notes.push(text), ...ui },
  );
  const tools = () => app.session.getActiveToolNames();
  return { app, agentDir, seen, tools, link };
}

test("/voice adds and removes only the terminal while the page is on", async () => {
  const { app, agentDir, seen, tools, link } = await voice();
  try {
    saveConfig({ voice: { port: 0 } }, agentDir);
    await app.session.prompt("/voice web");
    const page = link();
    expect(page).toContain("?t=");
    await app.session.prompt("/voice");
    expect(seen.here).toBe(1);
    await app.session.prompt("/voice");
    expect(seen.here).toBe(0);
    // The page and the show tool are still there.
    expect((await fetch(page)).status).toBe(200);
    expect(tools()).toContain("show");
    await app.session.prompt("/voice off");
    expect(tools()).not.toContain("show");
    await expect(fetch(page)).rejects.toThrow();
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

test("after a restart, /voice web brings the saved tunnel back and gives its link", async () => {
  const answers: (string | undefined)[] = [];
  const first = await voice({ input: async () => answers.shift() });
  const { agentDir } = first;
  // A stand-in for cloudflared that connects at once.
  const bin = join(agentDir, "bruv", "voice", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "cloudflared"), "#!/bin/sh\necho 'Registered tunnel connection' >&2\nexec sleep 30\n");
  chmodSync(join(bin, "cloudflared"), 0o755);
  const tunnelToken = Buffer.from(JSON.stringify({ a: "account", t: "tunnel", s: "secret" })).toString("base64");
  saveConfig({ voice: { port: 0 } }, agentDir);
  try {
    answers.push("voice.example.com", tunnelToken);
    await first.app.session.prompt("/voice tunnel");
  } finally {
    await first.app.close();
  }
  const again = await voice({}, true, agentDir);
  try {
    await again.app.session.prompt("/voice web");
    const remote = () => again.link("https://voice.example.com/?t=");
    for (let i = 0; i < 100 && !remote(); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(remote()).toBeTruthy();
  } finally {
    await again.app.close();
  }
});

test("/voice speed is kept, applies to voice that is on, and refuses what isn't a speed", async () => {
  const { app, agentDir, seen } = await voice();
  try {
    await app.session.prompt("/voice speed 1.3x");
    expect(readConfig(agentDir).voice?.speed).toBe(1.3);
    await app.session.prompt("/voice");
    // Voice starts at the kept speed, and a change reaches it.
    await app.session.prompt("/voice speed 1.1");
    expect(seen.speeds).toEqual([1.3, 1.1]);
    for (const wrong of ["fast", "0", "5"]) await app.session.prompt(`/voice speed ${wrong}`);
    expect(readConfig(agentDir).voice?.speed).toBe(1.1);
    expect(seen.speeds).toEqual([1.3, 1.1]);
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

test("/voice suggests what can follow it", async () => {
  const { app } = await voice();
  try {
    const complete = app.session.extensionRunner.getCommand("voice")?.getArgumentCompletions;
    const values = async (prefix: string) => (await complete?.(prefix))?.map((item) => item.value);
    expect(await values("")).toEqual(["web", "tunnel", "tunnel off", "speed", "off"]);
    expect(await values("tu")).toEqual(["tunnel", "tunnel off"]);
    expect(await values("tunnel o")).toEqual(["tunnel off"]);
  } finally {
    await app.close();
  }
});
