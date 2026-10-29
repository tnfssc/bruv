import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startListening, transcribe, wav } from "../src/voice/listen";
import { missing, modelPaths } from "../src/voice/models";
import { modelsNeeded } from "../src/web/voice/engine";

const listen = { model: "meta/muse-voice-transcribe-1.0", key: async () => "k" };

test("a turn is sent as 16 kHz WAV and its words come back", async () => {
  const pcm = new Int16Array([1, -2, 3]);
  let sent: { url: string; auth: string; body: { model: string; input_audio: { data: string; format: string } } };
  const fetch = (async (url: string, init: RequestInit) => {
    sent = {
      url,
      auth: new Headers(init.headers).get("authorization") ?? "",
      body: JSON.parse(String(init.body)),
    };
    return Response.json({ text: " hello there " });
  }) as unknown as typeof globalThis.fetch;
  expect(await transcribe(listen, pcm, fetch)).toBe("hello there");
  // biome-ignore lint/style/noNonNullAssertion: set by the fake fetch above
  const { url, auth, body } = sent!;
  expect(url).toEndWith("/audio/transcriptions");
  expect(auth).toBe("Bearer k");
  expect(body.model).toBe(listen.model);
  expect(body.input_audio.format).toBe("wav");
  const file = new Uint8Array(Buffer.from(body.input_audio.data, "base64"));
  expect(file).toEqual(wav(pcm));
  const view = new DataView(file.buffer);
  expect(view.getUint32(24, true)).toBe(16000);
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint32(40, true)).toBe(pcm.byteLength);
  expect([...new Int16Array(file.buffer.slice(44))]).toEqual([1, -2, 3]);
});

test("a refused turn fails with its status", async () => {
  const fetch = (async () =>
    Response.json({ error: { message: "no such model" } }, { status: 400 })) as unknown as typeof globalThis.fetch;
  await expect(transcribe(listen, new Int16Array(4), fetch)).rejects.toThrow("400");
  await expect(transcribe({ ...listen, key: async () => undefined }, new Int16Array(4), fetch)).rejects.toThrow();
});

test("words come back in the order the turns were said, and a failed turn gives none", async () => {
  const releases: (() => void)[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    const { input_audio } = JSON.parse(String(init.body));
    const first = Buffer.from(input_audio.data, "base64")[44] === 1;
    if (!first) return Response.json({ text: "second" });
    await new Promise<void>((resolve) => releases.push(resolve));
    return new Response("", { status: 503 });
  }) as unknown as typeof globalThis.fetch;
  const heard: [string, boolean][] = [];
  const failed: string[] = [];
  const turn = startListening(
    listen,
    (text, held) => heard.push([text, held]),
    (m) => failed.push(m),
    fetch,
  );
  turn(new Int16Array([1]), false);
  turn(new Int16Array([2]), true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(heard).toEqual([]);
  for (const release of releases) release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(heard).toEqual([
    ["", false],
    ["second", true],
  ]);
  expect(failed).toHaveLength(1);
});

test("hearing in the cloud needs no recogniser on this machine", () => {
  const dir = join(process.env.PI_CODING_AGENT_DIR as string, `listen-${Date.now()}-${Math.random()}`);
  expect(modelPaths(dir, undefined, false).asr).toBeUndefined();
  expect(modelPaths(dir).asr).toBeDefined();
  expect(missing(dir, false).length).toBe(missing(dir).length - 1);
});

test("the web page asks for the recogniser only when it hears on this machine", () => {
  const agentDir = join(process.env.PI_CODING_AGENT_DIR as string, `listen-web-${Date.now()}-${Math.random()}`);
  mkdirSync(agentDir, { recursive: true });
  const all = modelsNeeded(agentDir);
  writeFileSync(join(agentDir, "bruv.json"), JSON.stringify({ voice: { listen: listen.model } }));
  const key = { has: true, get: async () => "k" };
  const cloud = modelsNeeded(agentDir, key);
  expect(cloud).toBeLessThan(all);
  // Without a key the cloud can't hear, so Nemotron is needed after all.
  expect(modelsNeeded(agentDir, { has: false, get: async () => undefined })).toBe(all);
  expect(modelsNeeded(agentDir)).toBe(all);
});
