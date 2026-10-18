import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { Call, type DeviceEvent, type Engine, type EngineEvent } from "../src/voice/call";
import { Fillers, fillerLines, trim } from "../src/voice/fillers";

const dir = mkdtempSync(resolve(".tmp/fillers-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** An engine with one filler, which records what it was asked. */
function engine() {
  const listeners: ((event: EngineEvent) => void)[] = [];
  const asked = { spoken: [] as string[], fillers: [] as number[] };
  const fake: Engine & { emit(event: EngineEvent): void } = {
    hear() {},
    speak: (text) => asked.spoken.push(text),
    talk() {},
    hush() {},
    filler: (part) => {
      asked.fillers.push(part);
      return "Hmm.";
    },
    onEvent: (listener) => listeners.push(listener),
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
    close: async () => {},
  };
  return { fake, asked };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a filler plays when the answer is slow to start, and not when it is quick", async () => {
  const { fake, asked } = engine();
  const events: DeviceEvent[] = [];
  const call = new Call(fake, { tell: () => {} }, 30);
  call.attach({ send: (event) => events.push(event), play: () => {} });
  fake.emit({ type: "ready" });
  fake.emit({ type: "heard", text: "what's the capital of australia" });
  await wait(60);
  expect(asked.fillers).toEqual([1]);
  // It isn't shown, and the answer comes after it.
  expect(events.some((event) => event.type === "assistant")).toBe(false);
  call.replyStart();
  call.reply("Canberra. ");
  expect(events.filter((event) => event.type === "assistant")).toMatchObject([{ part: 2 }]);

  call.replyEnd();
  fake.emit({ type: "heard", text: "and the biggest city" });
  call.replyStart();
  call.reply("Sydney. ");
  await wait(60);
  expect(asked.fillers).toEqual([1]);
});

test("no filler while the user is still talking", async () => {
  const { fake, asked } = engine();
  const call = new Call(fake, { tell: () => {} }, 30);
  fake.emit({ type: "ready" });
  fake.emit({ type: "heard", text: "first part" });
  fake.emit({ type: "speech" });
  await wait(60);
  expect(asked.fillers).toEqual([]);
  await call.close();
});

test("trimming keeps the sound and a breath around it", () => {
  const rate = 1000;
  const pcm = new Int16Array(1000);
  for (let i = 400; i < 600; i++) pcm[i] = 5000;
  const out = trim(pcm, rate);
  expect(out.length).toBeGreaterThanOrEqual(200);
  expect(out.length).toBeLessThan(400);
});

test("fillers are made once, kept, and never the same twice in a row", async () => {
  let made = 0;
  const fetch = (async () => {
    made++;
    const pcm = new Int16Array(44_100).map((_, i) => (i > 10_000 && i < 30_000 ? 3000 : 0));
    return new Response(pcm.buffer, { headers: { "content-type": "audio/pcm;rate=44100;channels=1" } });
  }) as unknown as typeof globalThis.fetch;
  const first = new Fillers(dir, "fish-audio/drama-3", async () => "k", fetch);
  await first.ready;
  expect(made).toBe(fillerLines.length);
  expect(readdirSync(dir)).toHaveLength(fillerLines.length);
  const again = new Fillers(dir, "fish-audio/drama-3", async () => "k", fetch);
  await again.ready;
  expect(made).toBe(fillerLines.length);
  let last: string | undefined;
  for (let i = 0; i < 20; i++) {
    const sound = again.pick();
    expect(sound?.text).not.toBe(last);
    last = sound?.text;
  }
});
