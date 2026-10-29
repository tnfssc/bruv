import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import WebSocket from "ws";
import type { Engine, EngineEvent } from "../src/voice/call";
import { missing } from "../src/voice/models";
import type { WebContext } from "../src/web/part";
import { voicePart } from "../src/web/voice";

class FakeEngine implements Engine {
  heard: number[] = [];
  spoken: string[] = [];
  hushes = 0;
  talks: [boolean, boolean][] = [];
  closed = false;
  private listeners: ((event: EngineEvent) => void)[] = [];
  hear(pcm: Int16Array) {
    this.heard.push(...pcm);
  }
  speak(text: string, part: number) {
    this.spoken.push(text);
    this.emit({ type: "audio", pcm: new Int16Array([1, 2, 3]), rate: 24000, part });
  }
  hush() {
    this.hushes++;
  }
  talk(on: boolean, keep = false) {
    this.talks.push([on, keep]);
  }
  onEvent(listener: (event: EngineEvent) => void) {
    this.listeners.push(listener);
  }
  emit(event: EngineEvent) {
    for (const listener of this.listeners) listener(event);
  }
  async close() {
    this.closed = true;
  }
}

async function until(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The voice part on its own server, with the web version stood in for by what the test records. */
async function setUp(options: { models?: boolean; idle?: number } = {}) {
  const agentDir = join(process.env.PI_CODING_AGENT_DIR as string, `web-voice-${Date.now()}-${Math.random()}`);
  const models = join(agentDir, "bruv", "voice", "models");
  if (options.models !== false)
    for (const model of missing(models)) mkdirSync(join(models, model.name), { recursive: true });
  const http = createServer((_request, response) => response.writeHead(404).end());
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address() as AddressInfo;
  const engines: FakeEngine[] = [];
  const said: string[] = [];
  let stops = 0;
  const part = voicePart({
    engine: () => {
      const engine = new FakeEngine();
      engines.push(engine);
      return engine;
    },
    idle: options.idle ?? 60_000,
    stopWait: 50,
  });
  const context: WebContext = {
    http,
    route: () => () => {},
    key: "k",
    dir: join(agentDir, "bruv", "web"),
    agentDir,
    address: () => `http://127.0.0.1:${port}/?t=k`,
    setAddress: () => {},
    say: (text) => said.push(text),
    stop: () => stops++,
    watched: () => true,
    apiKey: async () => undefined,
    notify: () => {},
  };
  await part.start(context);
  /** A page with voice on: it says `mic` as it connects. */
  const page = async (key = "k") => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/voice?t=${key}`);
    const events: { type: string; [key: string]: unknown }[] = [];
    const audio: Buffer[] = [];
    ws.on("message", (data, binary) => {
      if (binary) audio.push(data as Buffer);
      else events.push(JSON.parse(data.toString()));
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.on("error", reject);
    });
    const send = (event: object) => ws.send(JSON.stringify(event));
    send({ type: "mic" });
    return { ws, events, audio, send };
  };
  const reply = (id: string, text: string) => {
    part.busy?.(true);
    part.reply?.({ type: "start", id });
    for (const word of text.match(/\S+\s*/g) ?? []) part.reply?.({ type: "delta", id, text: word });
    part.reply?.({ type: "end", id, text });
    part.busy?.(false);
  };
  return {
    part,
    engines,
    said,
    stops: () => stops,
    page,
    reply,
    close: async () => {
      await part.close();
      http.closeAllConnections();
      await new Promise((resolve) => http.close(resolve));
    },
  };
}

test("the engine starts only when a page turns voice on, and what the user says becomes their message", async () => {
  const voice = await setUp();
  try {
    voice.reply("r0", "Nobody is listening yet.");
    expect(voice.engines.length).toBe(0);
    const page = await voice.page();
    await until(() => voice.engines.length === 1);
    const engine = voice.engines[0] as FakeEngine;
    engine.emit({ type: "ready" });
    // Microphone audio reaches the engine, and holding the button is a turn.
    page.ws.send(new Int16Array([5, 6, 7]));
    page.send({ type: "talk", on: true });
    await until(() => engine.heard.length === 3 && engine.talks.length === 1);
    expect(engine.heard).toEqual([5, 6, 7]);
    expect(voice.part.talking?.()).toBe(true);
    page.send({ type: "talk", on: false });
    await until(() => engine.talks.length === 2);
    engine.emit({ type: "heard", text: "what needs me today", held: true });
    expect(voice.said).toEqual(["what needs me today"]);
    expect(voice.part.talking?.()).toBe(false);
    expect(voice.stops()).toBe(0);
    page.ws.close();
  } finally {
    await voice.close();
  }
});

test("replies are spoken only while a page has voice on", async () => {
  const voice = await setUp();
  try {
    const page = await voice.page();
    await until(() => voice.engines.length === 1);
    const engine = voice.engines[0] as FakeEngine;
    engine.emit({ type: "ready" });
    voice.reply("r1", "Two threads are done. One needs you.");
    expect(engine.spoken.length).toBe(2);
    await until(() => page.audio.length === 2);
    expect(page.events.some((event) => event.type === "rate")).toBe(true);
    page.ws.close();
    await until(() => engine.hushes > 0);
    voice.reply("r2", "Nobody hears this one.");
    expect(engine.spoken.length).toBe(2);
  } finally {
    await voice.close();
  }
});

test("hush stops the speech, and talking over a reply being written stops that run before the words go", async () => {
  const voice = await setUp();
  try {
    const page = await voice.page();
    await until(() => voice.engines.length === 1);
    const engine = voice.engines[0] as FakeEngine;
    engine.emit({ type: "ready" });
    voice.part.busy?.(true);
    voice.part.reply?.({ type: "start", id: "r1" });
    voice.part.reply?.({ type: "delta", id: "r1", text: "Here is a long story. It goes on. " });
    page.send({ type: "hush" });
    await until(() => engine.hushes === 1);
    await until(() => page.events.some((event) => event.type === "flush"));
    // The stop button hushes speech only; the assistant keeps working.
    expect(voice.stops()).toBe(0);

    voice.part.reply?.({ type: "start", id: "r2" });
    voice.part.reply?.({ type: "delta", id: "r2", text: "Another answer starts. " });
    engine.emit({ type: "speech" });
    expect(voice.part.talking?.()).toBe(true);
    engine.emit({ type: "heard", text: "stop and check the payments thread" });
    expect(voice.stops()).toBe(1);
    // The words wait for the stopped run to settle, so they start a new one.
    expect(voice.said).toEqual([]);
    voice.part.reply?.({ type: "end", id: "r2", text: "Another answer starts." });
    voice.part.busy?.(false);
    expect(voice.said).toEqual(["stop and check the payments thread"]);

    // Talking while a step runs (no reply being written) never stops the work.
    voice.part.busy?.(true);
    engine.emit({ type: "speech" });
    engine.emit({ type: "heard", text: "and the docs too" });
    expect(voice.stops()).toBe(1);
    expect(voice.said.at(-1)).toBe("and the docs too");
    page.ws.close();
  } finally {
    await voice.close();
  }
});

test("the engine idles out after the last page turns voice off, and starts again when one comes back", async () => {
  const voice = await setUp({ idle: 30 });
  try {
    const first = await voice.page();
    await until(() => voice.engines.length === 1);
    first.ws.close();
    await until(() => voice.engines[0]?.closed === true);
    const second = await voice.page();
    await until(() => voice.engines.length === 2);
    second.ws.close();
  } finally {
    await voice.close();
  }
});

test("a page is told when the models are missing, and a wrong key gets no socket", async () => {
  const voice = await setUp({ models: false });
  try {
    const page = await voice.page();
    await until(() => page.events.length > 0);
    expect(page.events[0]).toMatchObject({ type: "models" });
    expect(Number(page.events[0]?.mb)).toBeGreaterThan(0);
    expect(voice.engines.length).toBe(0);
    page.ws.close();
    await expect(voice.page("wrong")).rejects.toThrow();
  } finally {
    await voice.close();
  }
});
