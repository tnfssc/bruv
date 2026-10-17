import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import WebSocket from "ws";
import { saveConfig } from "../src/config";
import { registerVoice } from "../src/voice";
import { Call, type DeviceEvent, type Engine, type EngineEvent } from "../src/voice/call";
import { missing } from "../src/voice/models";
import { serve } from "../src/voice/server";
import { isEcho, Sentences, speakable } from "../src/voice/text";
import { sdk } from "./sdk";

class FakeEngine implements Engine {
  heard: Int16Array[] = [];
  spoken: string[] = [];
  hushes = 0;
  private listeners: ((event: EngineEvent) => void)[] = [];
  hear(pcm: Int16Array) {
    this.heard.push(pcm);
  }
  speak(text: string) {
    this.spoken.push(text);
  }
  hush() {
    this.hushes++;
  }
  onEvent(listener: (event: EngineEvent) => void) {
    this.listeners.push(listener);
  }
  emit(event: EngineEvent) {
    for (const listener of this.listeners) listener(event);
  }
  async close() {}
}

function device() {
  const events: DeviceEvent[] = [];
  const played: Int16Array[] = [];
  return {
    events,
    played,
    send: (event: DeviceEvent) => events.push(event),
    play: (pcm: Int16Array) => played.push(pcm),
  };
}

const types = (events: DeviceEvent[]) => events.map((event) => event.type).filter((type) => type !== "state");

async function until(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("streamed text is spoken a sentence at a time, without Markdown or code", () => {
  const sentences = new Sentences();
  const said = [
    ..."Done. The **fix** is in `parse.ts`, e.g. the loop.\n```ts\nconst x = 1;\n```\n- One more"
      .split("")
      .flatMap((c) => sentences.push(c)),
    ...sentences.flush(),
  ];
  expect(said.length).toBe(3);
  expect(said.join(" ")).not.toMatch(/[*`]|const x/);
  expect(said[1]).toContain("e.g. the loop");
  expect(speakable("[docs](https://example.com) and https://example.com")).not.toContain("example.com");
});

test("the speaker's own words coming back are told apart from the user's", () => {
  expect(isEcho("the tests pass", "I fixed it, and the tests pass now.")).toBe(true);
  expect(isEcho("stop that", "I fixed it, and the tests pass now.")).toBe(false);
  expect(isEcho("", "anything")).toBe(false);
});

test("talking over a reply pauses it, then drops it and tells the brain", () => {
  const engine = new FakeEngine();
  const told: string[] = [];
  const call = new Call(engine, { tell: (text) => told.push(text) });
  const speaker = device();
  call.attach(speaker);
  call.replyStart();
  call.reply("First sentence. Second ");
  engine.emit({ type: "audio", pcm: new Int16Array(4), rate: 24000 });
  expect(speaker.played.length).toBe(1);

  engine.emit({ type: "speech" });
  expect(types(speaker.events).at(-1)).toBe("pause");
  engine.emit({ type: "heard", text: "wait, do something else" });
  expect(types(speaker.events)).toContain("flush");
  expect(engine.hushes).toBe(1);
  expect(told).toEqual(["wait, do something else"]);

  // The rest of the interrupted reply is not spoken; the next reply is.
  const before = engine.spoken.length;
  call.reply("sentence. More text.");
  call.replyEnd();
  expect(engine.spoken.length).toBe(before);
  call.replyStart();
  call.reply("New answer. ");
  expect(engine.spoken.length).toBe(before + 1);
});

test("a noise or an echo resumes the reply instead of stopping it", () => {
  const engine = new FakeEngine();
  const told: string[] = [];
  const call = new Call(engine, { tell: (text) => told.push(text) });
  const speaker = device();
  call.attach(speaker);
  call.replyStart();
  call.reply("The tests pass now. ");
  for (const text of ["", "the tests pass"]) {
    engine.emit({ type: "speech" });
    engine.emit({ type: "heard", text });
    expect(types(speaker.events).slice(-2)).toEqual(["pause", "resume"]);
  }
  expect(told).toEqual([]);
  expect(engine.hushes).toBe(0);
});

test("talking while nothing plays still ends the pause", () => {
  const engine = new FakeEngine();
  const told: string[] = [];
  const call = new Call(engine, { tell: (text) => told.push(text) });
  const speaker = device();
  call.attach(speaker);
  engine.emit({ type: "speech" });
  engine.emit({ type: "heard", text: "hello" });
  expect(types(speaker.events)).toEqual(["pause", "resume", "user"]);
  expect(told).toEqual(["hello"]);
});

test("the page and its socket need the key; audio goes both ways", async () => {
  const engine = new FakeEngine();
  const call = new Call(engine, { tell: () => {} });
  const served = await serve(call, { host: "127.0.0.1", port: 0, token: "secret" });
  try {
    const url = new URL(served.url);
    expect((await fetch(url)).status).toBe(200);
    expect((await fetch(`http://${url.host}/?t=wrong`)).status).toBe(404);
    const refused = new WebSocket(`ws://${url.host}/socket?t=wrong`);
    await new Promise((resolve) => refused.on("error", resolve));

    const ws = new WebSocket(`ws://${url.host}/socket?t=secret`);
    const messages: (string | Buffer)[] = [];
    ws.on("message", (data, binary) => messages.push(binary ? (data as Buffer) : data.toString()));
    await new Promise((resolve) => ws.on("open", resolve));
    ws.send(new Int16Array([1, 2, 3]));
    await until(() => engine.heard.length === 1);
    expect([...engine.heard[0]]).toEqual([1, 2, 3]);

    engine.emit({ type: "audio", pcm: new Int16Array([4, 5]), rate: 24000 });
    await until(() => messages.some((message) => Buffer.isBuffer(message)));
    expect(messages.some((message) => typeof message === "string" && JSON.parse(message).rate === 24000)).toBe(true);

    // The page opened last is the one that listens.
    const second = new WebSocket(`ws://${url.host}/socket?t=secret`);
    await new Promise((resolve) => second.on("open", resolve));
    ws.send(new Int16Array([9]));
    second.send(new Int16Array([7]));
    await until(() => engine.heard.length === 2);
    expect([...engine.heard[1]]).toEqual([7]);
    ws.close();
    second.close();
  } finally {
    await served.close();
  }
});

test("/voice sends what was heard to the session and speaks the reply", async () => {
  const engine = new FakeEngine();
  let opened = "";
  const agentDir = join(process.env.PI_CODING_AGENT_DIR as string, `voice-${Date.now()}`);
  const app = await sdk([
    (pi) =>
      registerVoice(pi, {
        engine: () => engine,
        open: (url) => {
          opened = url;
        },
        agentDir,
      }),
  ]);
  try {
    saveConfig({ voice: { port: 0 } }, agentDir);
    const models = join(agentDir, "bruv", "voice", "models");
    for (const model of missing(models)) mkdirSync(join(models, model.name), { recursive: true });
    const sections: (Record<string, string | null> | undefined)[] = [];
    app.faux.setResponses([
      (context) => {
        sections.push(context.messages.filter((message) => message.role === "system").at(-1)?.sections);
        return fauxAssistantMessage("Hello there. All good.");
      },
    ]);
    await app.session.prompt("/voice");
    expect(opened).toContain("?t=");
    engine.emit({ type: "ready" });
    engine.emit({ type: "speech" });
    engine.emit({ type: "heard", text: "how are things" });
    await until(() => engine.spoken.length === 2);
    expect(sections[0]?.voice).toBeDefined();
    expect(app.session.messages.some((message) => message.role === "user")).toBe(true);

    await app.session.prompt("/voice off");
    app.faux.setResponses([
      (context) => {
        sections.push(context.messages.filter((message) => message.role === "system").at(-1)?.sections);
        return fauxAssistantMessage("Typed reply.");
      },
    ]);
    await app.session.prompt("typed");
    // Pi sends changed sections only; a removed section comes as null.
    expect(sections[1]?.voice).toBeFalsy();
    expect(engine.spoken.length).toBe(2);
  } finally {
    await app.close();
  }
});
