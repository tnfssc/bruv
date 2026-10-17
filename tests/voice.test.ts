import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import WebSocket from "ws";
import { saveConfig } from "../src/config";
import { registerVoice } from "../src/voice";
import { Call, type DeviceEvent, type Engine, type EngineEvent } from "../src/voice/call";
import { release } from "../src/voice/cloudflared";
import { readKey, saveKey } from "../src/voice/keys";
import { missing } from "../src/voice/models";
import { qrLines, qrSvg } from "../src/voice/qr";
import { serve } from "../src/voice/server";
import { forPage, resolveShown, Shelf, type ShowArgs } from "../src/voice/show";
import { forTerminal } from "../src/voice/terminal";
import { isEcho, Sentences, speakable } from "../src/voice/text";
import { cleanHost, prepare } from "../src/voice/tunnel";
import { sdk } from "./sdk";

const shown = (args: ShowArgs, cwd: string, shelf: Shelf) => forPage(resolveShown(args, cwd), shelf);

class FakeEngine implements Engine {
  heard: Int16Array[] = [];
  spoken: string[] = [];
  hushes = 0;
  talks: [boolean, boolean][] = [];
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
  talk(on: boolean, keep = false) {
    this.talks.push([on, keep]);
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
  engine.emit({ type: "audio", pcm: new Int16Array(4), rate: 24000, part: 1 });
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

test("words said while holding the button are the user's, even when they match the reply", () => {
  const engine = new FakeEngine();
  const told: string[] = [];
  const call = new Call(engine, { tell: (text) => told.push(text) });
  const speaker = device();
  call.attach(speaker);
  call.replyStart();
  call.reply("The tests pass now. ");
  call.talk(true);
  engine.emit({ type: "speech" });
  call.talk(false);
  engine.emit({ type: "heard", text: "the tests pass", held: true });
  expect(engine.talks).toEqual([
    [true, false],
    [false, false],
  ]);
  expect(told).toEqual(["the tests pass"]);
  expect(types(speaker.events)).toContain("flush");
});

test("each spoken sentence has its own number, on its text and its audio", () => {
  const engine = new FakeEngine();
  const call = new Call(engine, { tell: () => {} });
  const speaker = device();
  const parts: number[] = [];
  call.attach({ ...speaker, play: (_pcm, _rate, part) => parts.push(part) });
  call.replyStart();
  call.reply("One. Two. ");
  const numbers = speaker.events.flatMap((event) => (event.type === "assistant" ? [event.part] : []));
  expect(new Set(numbers).size).toBe(2);
  engine.emit({ type: "audio", pcm: new Int16Array(2), rate: 24000, part: numbers[1] });
  expect(parts).toEqual([numbers[1]]);
});

test("one microphone at a time: a page that starts takes it, and the terminal gets it back", () => {
  const engine = new FakeEngine();
  const call = new Call(engine, { tell: () => {} });
  const terminal = device();
  const page = device();
  call.attach(terminal);
  call.attach(page);
  call.hear(new Int16Array([1]), terminal);
  call.claim(page);
  call.hear(new Int16Array([2]), terminal);
  call.hear(new Int16Array([3]), page);
  call.detach(page);
  call.hear(new Int16Array([4]), terminal);
  expect(engine.heard.map((pcm) => pcm[0])).toEqual([1, 3, 4]);
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

    engine.emit({ type: "audio", pcm: new Int16Array([4, 5]), rate: 24000, part: 3 });
    await until(() => messages.some((message) => Buffer.isBuffer(message)));
    const told = messages.filter((message) => typeof message === "string").map((message) => JSON.parse(message));
    expect(told.some((event) => event.rate === 24000)).toBe(true);
    // The page learns which sentence the audio belongs to before the audio comes.
    expect(told.some((event) => event.part === 3)).toBe(true);

    ws.send(JSON.stringify({ type: "talk", on: true }));
    ws.send(JSON.stringify({ type: "talk", on: false }));
    // A tap hands the turn to silence detection instead of ending it.
    ws.send(JSON.stringify({ type: "talk", on: true }));
    ws.send(JSON.stringify({ type: "talk", on: false, keep: true }));
    await until(() => engine.talks.length === 4);
    expect(engine.talks).toEqual([
      [true, false],
      [false, false],
      [true, false],
      [false, true],
    ]);

    // A page that only opened doesn't take the microphone; the page started last listens.
    const second = new WebSocket(`ws://${url.host}/socket?t=secret`);
    await new Promise((resolve) => second.on("open", resolve));
    ws.send(new Int16Array([8]));
    await until(() => engine.heard.length === 2);
    second.send(JSON.stringify({ type: "mic" }));
    ws.send(new Int16Array([9]));
    second.send(new Int16Array([7]));
    await until(() => engine.heard.length === 3);
    expect(engine.heard.map((pcm) => [...pcm])).toEqual([[1, 2, 3], [8], [7]]);
    ws.close();
    second.close();
  } finally {
    await served.close();
  }
});

test("/voice talks in the terminal, /voice web adds the page, and /voice again stops", async () => {
  const engine = new FakeEngine();
  let opened = "";
  let here = 0;
  const agentDir = join(process.env.PI_CODING_AGENT_DIR as string, `voice-${Date.now()}`);
  const app = await sdk([
    (pi) =>
      registerVoice(pi, {
        engine: () => engine,
        open: (url) => {
          opened = url;
        },
        local: () => {
          here++;
          return { stop: () => here-- };
        },
        agentDir,
      }),
  ]);
  try {
    saveConfig({ voice: { port: 0 } }, agentDir);
    const models = join(agentDir, "bruv", "voice", "models");
    for (const model of missing(models)) mkdirSync(join(models, model.name), { recursive: true });
    const sections: (Record<string, string | null> | undefined)[] = [];
    const reply = (context: { messages: { role: string; sections?: Record<string, string | null> }[] }) => {
      sections.push(context.messages.filter((message) => message.role === "system").at(-1)?.sections);
      return fauxAssistantMessage("Hello there. All good.");
    };
    app.faux.setResponses([reply, reply]);
    expect(app.session.getActiveToolNames()).not.toContain("show");
    await app.session.prompt("/voice");
    // The terminal's microphone and speaker, and no page server until it is asked for.
    expect(here).toBe(1);
    expect(opened).toBe("");
    // The model can show things only while voice is on.
    expect(app.session.getActiveToolNames()).toContain("show");
    engine.emit({ type: "ready" });
    engine.emit({ type: "speech" });
    engine.emit({ type: "heard", text: "how are things" });
    await until(() => engine.spoken.length === 2);
    expect(sections[0]?.voice).toBeDefined();
    expect(app.session.messages.some((message) => message.role === "user")).toBe(true);
    await app.session.prompt("/voice web");
    expect(opened).toContain("?t=");
    expect(here).toBe(1);
    // The model is told where voice is now.
    engine.emit({ type: "speech" });
    engine.emit({ type: "heard", text: "and now" });
    await until(() => engine.spoken.length === 4);
    expect(sections[1]?.voice).toBeTruthy();
    expect(sections[1]?.voice).not.toBe(sections[0]?.voice);

    const saved = join(agentDir, "bruv", "voice", "shown");
    mkdirSync(saved, { recursive: true });
    writeFileSync(join(saved, "page.html"), "<p>hi</p>");
    await app.session.prompt("/voice");
    expect(here).toBe(0);
    // Pages saved for terminal links go when voice stops.
    expect(existsSync(saved)).toBe(false);
    expect(app.session.getActiveToolNames()).not.toContain("show");
    app.faux.setResponses([
      (context) => {
        sections.push(context.messages.filter((message) => message.role === "system").at(-1)?.sections);
        return fauxAssistantMessage("Typed reply.");
      },
    ]);
    await app.session.prompt("typed");
    // Pi sends changed sections only; a removed section comes as null.
    expect(sections[2]?.voice).toBeFalsy();
    expect(engine.spoken.length).toBe(4);
  } finally {
    await app.close();
  }
});

/** A fake Cloudflare API: zones, tunnels and DNS records in memory. */
function fakeCloudflare(records: { name: string; content: string }[] = []) {
  const tunnels: { id: string; name: string }[] = [];
  const configs: Record<string, unknown> = {};
  const calls: string[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const { pathname, searchParams } = new URL(url);
    const path = pathname.replace("/client/v4", "");
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push(`${init.method} ${path}`);
    const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result }));
    if (path === "/zones")
      return ok(
        searchParams.get("name") === "example.com" ? [{ id: "z", name: "example.com", account: { id: "a" } }] : [],
      );
    if (path === "/accounts/a/cfd_tunnel" && init.method === "GET")
      return ok(tunnels.filter((tunnel) => tunnel.name === searchParams.get("name")));
    if (path === "/accounts/a/cfd_tunnel") {
      tunnels.push({ id: `t${tunnels.length}`, name: body.name });
      return ok(tunnels.at(-1));
    }
    const config = path.match(/^\/accounts\/a\/cfd_tunnel\/(\w+)\/configurations$/);
    if (config) {
      configs[config[1]] = body.config;
      return ok({});
    }
    if (path === "/zones/z/dns_records" && init.method === "GET")
      return ok(records.filter((record) => record.name === searchParams.get("name")));
    if (path === "/zones/z/dns_records") {
      records.push(body);
      return ok(body);
    }
    const token = path.match(/^\/accounts\/a\/cfd_tunnel\/(\w+)\/token$/);
    if (token) return ok(`token-${token[1]}`);
    return new Response(JSON.stringify({ success: false, errors: [{ message: "not found" }] }), { status: 404 });
  };
  return { fetch, tunnels, configs, records, calls };
}

test("a Cloudflare API token and a host are enough to set the tunnel up, again and again", async () => {
  const cloudflare = fakeCloudflare();
  const origin = "http://127.0.0.1:7807";
  expect(await prepare("api", "voice.example.com", origin, cloudflare.fetch)).toBe("token-t0");
  expect(cloudflare.tunnels.length).toBe(1);
  expect(JSON.stringify(cloudflare.configs.t0)).toContain(origin);
  expect(cloudflare.records).toEqual([
    expect.objectContaining({ name: "voice.example.com", content: "t0.cfargotunnel.com", proxied: true }),
  ]);

  // Again, on another port: the same tunnel and record, pointed at the new port.
  expect(await prepare("api", "voice.example.com", "http://127.0.0.1:9000", cloudflare.fetch)).toBe("token-t0");
  expect(cloudflare.tunnels.length).toBe(1);
  expect(cloudflare.records.length).toBe(1);
  expect(JSON.stringify(cloudflare.configs.t0)).toContain("9000");
});

test("the tunnel never takes over a DNS record it did not make", async () => {
  const cloudflare = fakeCloudflare([{ name: "www.example.com", content: "my-site.pages.dev" }]);
  await expect(prepare("api", "www.example.com", "http://127.0.0.1:1", cloudflare.fetch)).rejects.toThrow();
  expect(cloudflare.records.length).toBe(1);
  await expect(prepare("api", "voice.other.org", "http://127.0.0.1:1", cloudflare.fetch)).rejects.toThrow();
});

test("a tunnel token from the dashboard is used as it is", async () => {
  const cloudflare = fakeCloudflare();
  const key = Buffer.from(JSON.stringify({ a: "account", t: "tunnel", s: "secret" })).toString("base64");
  expect(await prepare(key, "voice.example.com", "http://127.0.0.1:1", cloudflare.fetch)).toBe(key);
  expect(cloudflare.calls).toEqual([]);
});

test("host names are cleaned up, and nonsense is refused", () => {
  expect(cleanHost(" https://Voice.Example.com/ ")).toBe("voice.example.com");
  expect(cleanHost("not a host")).toBeUndefined();
});

test("the Cloudflare key is kept in auth.json next to the other keys", async () => {
  const agentDir = join(process.env.PI_CODING_AGENT_DIR as string, `keys-${Date.now()}`);
  mkdirSync(agentDir, { recursive: true });
  const file = join(agentDir, "auth.json");
  writeFileSync(file, JSON.stringify({ openai: { type: "api_key", key: "sk" } }));
  await saveKey("cf", agentDir);
  expect(readKey(agentDir)).toBe("cf");
  expect(JSON.parse(readFileSync(file, "utf8")).openai.key).toBe("sk");
  expect(statSync(file).mode & 0o777).toBe(0o600);
});

test("cloudflared is downloaded for Linux and macOS only", () => {
  expect(release("linux", "x64")?.name).toContain("linux-amd64");
  expect(release("darwin", "arm64")?.packed).toBe(true);
  expect(release("win32", "x64")).toBeUndefined();
});

test("the agent can show a page, a picture from disk or a video link", () => {
  const dir = join(process.env.PI_CODING_AGENT_DIR as string, `show-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plot.png"), "png");
  writeFileSync(join(dir, "page.html"), "<p>hi</p>");
  const shelf = new Shelf();
  expect(shown({ html: "<p>hi</p>", title: "Hi" }, dir, shelf)).toEqual({
    kind: "html",
    title: "Hi",
    html: "<p>hi</p>",
  });
  expect(shown({ file: "page.html" }, dir, shelf)).toMatchObject({ kind: "html", html: "<p>hi</p>" });
  const picture = shown({ file: "plot.png" }, dir, shelf);
  expect(picture.kind).toBe("image");
  expect(picture.src).toMatch(/^\/shown\/[\w-]{20,}$/);
  expect(shown({ url: "https://example.com/clip.webm" }, dir, shelf)).toMatchObject({ kind: "video" });
  expect(shown({ url: "https://example.com/v/123", kind: "video" }, dir, shelf)).toMatchObject({
    kind: "video",
  });
  for (const args of [
    {},
    { html: "a", url: "https://example.com/a.png" },
    { file: "missing.png" },
    { file: "notes.txt" },
    { url: "file:///etc/passwd" },
    { url: "https://example.com/what" },
  ]) {
    expect(() => shown(args, dir, shelf)).toThrow();
  }
});

test("shown things reach every open page, and files stream in byte ranges", async () => {
  const engine = new FakeEngine();
  const call = new Call(engine, { tell: () => {} });
  const served = await serve(call, { host: "127.0.0.1", port: 0, token: "secret" });
  try {
    const host = new URL(served.url).host;
    const dir = join(process.env.PI_CODING_AGENT_DIR as string, `shown-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "clip.mp4"), "0123456789");
    const ws = new WebSocket(`ws://${host}/socket?t=secret`);
    const events: DeviceEvent[] = [];
    ws.on("message", (data, binary) => {
      if (!binary) events.push(JSON.parse(data.toString()));
    });
    await new Promise((resolve) => ws.on("open", resolve));
    const clip = shown({ file: "clip.mp4", title: "Clip" }, dir, served.shelf);
    expect(call.show(clip)).toBe(1);
    await until(() => events.some((event) => event.type === "show"));
    expect(events.find((event) => event.type === "show")).toMatchObject({ kind: "video", src: clip.src });

    const whole = await fetch(`http://${host}${clip.src}`);
    expect(whole.status).toBe(200);
    expect(await whole.text()).toBe("0123456789");
    const part = await fetch(`http://${host}${clip.src}`, { headers: { range: "bytes=2-4" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(await part.text()).toBe("234");
    expect((await fetch(`http://${host}/shown/guess`)).status).toBe(404);
    // Pages written for terminal links run their scripts only in a sandbox, apart from the voice page.
    const page = await fetch(`http://${host}${served.shelf.add(Buffer.from("<p>hi</p>"), "text/html")}`);
    expect(await page.text()).toBe("<p>hi</p>");
    expect(page.headers.get("content-security-policy")).toContain("allow-scripts");
    expect(whole.headers.get("content-security-policy")).toBe("sandbox");
    ws.close();
  } finally {
    await served.close();
  }
});

test("the terminal draws pictures, gives videos a link and saves pages to open", async () => {
  const dir = join(process.env.PI_CODING_AGENT_DIR as string, `terminal-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plot.png"), "png");
  writeFileSync(join(dir, "logo.svg"), "<svg/>");
  writeFileSync(join(dir, "clip.mp4"), "not really a video");
  const picture = await forTerminal(resolveShown({ file: "plot.png", title: "Plot" }, dir), dir);
  expect(picture.picture?.mime).toBe("image/png");
  // Terminals can't draw SVG, so it is a link.
  expect((await forTerminal(resolveShown({ file: "logo.svg" }, dir), dir)).link?.url).toStartWith("file://");
  const video = await forTerminal(resolveShown({ file: "clip.mp4" }, dir), dir);
  expect(video.link?.url).toStartWith("file://");
  const page = await forTerminal(resolveShown({ html: "<p>hi</p>" }, dir), join(dir, "shown"));
  expect(readFileSync(new URL(page.link?.url as string), "utf8")).toBe("<p>hi</p>");
  // With the page server running, links go through it and nothing is saved.
  const served = await forTerminal(resolveShown({ html: "<p>yo</p>" }, dir), join(dir, "unused"), {
    href: "http://127.0.0.1:7807/shown/abc",
  });
  expect(served.link?.url).toBe("http://127.0.0.1:7807/shown/abc");
  expect(existsSync(join(dir, "unused"))).toBe(false);
  // A link that isn't a picture terminals draw stays a link.
  const fake = (async () =>
    new Response("<html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
  expect(
    (await forTerminal(resolveShown({ url: "https://example.com/a.png" }, dir), dir, { fetch: fake })).link?.url,
  ).toBe("https://example.com/a.png");
});

test("pages learn the address a phone can use, with its QR code, and say when they start", async () => {
  const engine = new FakeEngine();
  const call = new Call(engine, { tell: () => {} });
  let started = 0;
  const served = await serve(call, { host: "127.0.0.1", port: 0, token: "secret", onStart: () => started++ });
  try {
    const ws = new WebSocket(`ws://${new URL(served.url).host}/socket?t=secret`);
    const remotes: { url: string | null; qr?: string | null }[] = [];
    ws.on("message", (data, binary) => {
      const event = binary ? undefined : JSON.parse(data.toString());
      if (event?.type === "remote") remotes.push(event);
    });
    await new Promise((resolve) => ws.on("open", resolve));
    await until(() => remotes.length === 1);
    expect(remotes[0].url).toBeNull();
    served.setRemote("https://voice.example.com/?t=secret");
    await until(() => remotes.length === 2);
    expect(remotes[1].url).toBe("https://voice.example.com/?t=secret");
    expect(remotes[1].qr).toContain("<svg");
    ws.send(JSON.stringify({ type: "mic" }));
    await until(() => started === 1);
    ws.close();
  } finally {
    await served.close();
  }
});

test("the terminal QR code is a block of equal rows", () => {
  const lines = qrLines("https://voice.example.com/?t=secret");
  expect(lines.length).toBeGreaterThan(10);
  expect(new Set(lines.map((line) => [...line].length)).size).toBe(1);
  expect(qrSvg("https://voice.example.com/")).toContain("<svg");
});
