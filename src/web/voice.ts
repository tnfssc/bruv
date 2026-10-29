import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { Call, type Device, type DeviceEvent } from "../voice/call";
import { pageDevice, pcmFrom } from "../voice/page-device";
import type { Reply, WebContext, WebPart } from "./part";
import { allowed } from "./server";
import { downloadModels, type Key, type MakeEngine, makeEngine, modelsNeeded } from "./voice/engine";

/**
 * What a page's voice listens for over `/voice`. The conversation itself (the user's words, the replies)
 * comes over the page's main socket, so the rest of what a call tells devices stays here.
 */
const forPage = new Set<DeviceEvent["type"]>(["state", "partial", "user", "pause", "resume", "flush", "error"]);

/**
 * What a page sends over `/voice`, besides microphone audio as binary 16 kHz PCM:
 * - `mic`: voice is on in this page (sent on every connect);
 * - `talk`: the talk button went down (`on`) or up; `keep` lets silence end the turn (a tap for hands-free);
 * - `played`: every sentence up to `part` has been heard;
 * - `hush`: stop speaking;
 * - `download`: the user agreed to download the speech models.
 * Turning voice off closes the socket.
 *
 * The server sends the call's events (`state`, `partial`, `user`, `pause`, `resume`, `flush`, `error`),
 * `rate` and `part` before audio of a new rate or sentence, binary 16-bit PCM, and, when the models are
 * missing, `models` with their size in MB and `progress` while they download.
 */
type PageMessage =
  | { type: "mic" }
  | { type: "talk"; on?: boolean; keep?: boolean }
  | { type: "played"; part?: number }
  | { type: "hush" }
  | { type: "download" };

type Page = { device: Device; wants: boolean; attached: boolean };

type Options = {
  /** For tests: a stand-in for the speech engine. */
  engine?: MakeEngine;
  /** How long the engine stays loaded after the last page turns voice off, in ms. */
  idle?: number;
  /** For tests: words heard over a reply wait this long for its run to stop before going anyway. */
  stopWait?: number;
};

/**
 * Voice in the web version's page: the page is a microphone and a speaker, the user's words go into the
 * conversation, and the assistant's written replies are spoken while some page has voice on. The speech
 * engine (about 800 MB of models in memory) starts only when a page turns voice on, and stops a few
 * minutes after the last one turns it off.
 */
export function voicePart(options: Options = {}): WebPart {
  const idleAfter = options.idle ?? 3 * 60_000;
  let web: WebContext | undefined;
  /** Pi's OpenRouter key, for speech that sounds like a person; Kokoro on this machine without it. */
  let openRouter: Key | undefined;
  let sockets: WebSocketServer | undefined;
  let call: Call | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let downloading: Promise<void> | undefined;
  const pages = new Map<WebSocket, Page>();
  let busy = false;
  /** The reply being written, and the one being spoken (a reply started before voice came on isn't). */
  let writing: string | undefined;
  let speaking: string | undefined;
  /** Words said over a reply being written, held until its run has stopped so they start a new one. */
  let held: { text: string; timer: ReturnType<typeof setTimeout> } | undefined;

  const listening = () => [...pages.values()].some((page) => page.attached);
  const toWaiting = (event: object) => {
    const text = JSON.stringify(event);
    for (const [ws, page] of pages) if (page.wants && !page.attached && ws.readyState === WebSocket.OPEN) ws.send(text);
  };

  const release = () => {
    if (!held) return;
    clearTimeout(held.timer);
    const { text } = held;
    held = undefined;
    web?.say(text);
  };

  /**
   * Talking over a reply being written stops that run, so the answer to the new words comes now; Pi only
   * takes new words between steps. Anything else (a step running, a reply only still playing) goes as
   * it is: T3 work isn't stopped for speech.
   */
  const tell = (text: string, interrupted: boolean) => {
    if (!web) return;
    if (!(interrupted && writing)) {
      web.say(text);
      return;
    }
    if (held) held.text = `${held.text} ${text}`;
    else held = { text, timer: setTimeout(release, options.stopWait ?? 5000) };
    web.stop();
  };

  const join = (ws: WebSocket, page: Page) => {
    if (!web || page.attached) return;
    const mb = modelsNeeded(web.agentDir, openRouter);
    if (mb) {
      ws.send(JSON.stringify({ type: "models", mb, downloading: downloading !== undefined }));
      return;
    }
    clearTimeout(idle);
    idle = undefined;
    if (!call) {
      const notify = web.notify;
      call = new Call(
        makeEngine(web.agentDir, (text) => notify(text), options.engine, openRouter),
        { tell },
      );
      if (busy) call.thinking();
    }
    call.attach(page.device);
    call.claim(page.device);
    page.attached = true;
  };

  /** No page has voice on: stop speaking, and free the engine if none comes back soon. */
  const quiet = () => {
    speaking = undefined;
    call?.hush();
    clearTimeout(idle);
    idle = setTimeout(() => {
      const current = call;
      call = undefined;
      void current?.close();
    }, idleAfter);
  };

  const fetchModels = () => {
    if (!web || downloading) return;
    const agentDir = web.agentDir;
    downloading = downloadModels(agentDir, (text) => toWaiting({ type: "progress", text }), undefined, openRouter)
      .then(
        () => {
          for (const [ws, page] of pages) if (page.wants) join(ws, page);
        },
        (error) =>
          toWaiting({
            type: "error",
            message: `Voice models failed to download: ${error instanceof Error ? error.message : String(error)}`,
          }),
      )
      .finally(() => {
        downloading = undefined;
      });
  };

  const onMessage = (ws: WebSocket, page: Page, data: RawData, binary: boolean) => {
    if (binary) {
      if (page.attached) call?.hear(pcmFrom(data as Buffer), page.device);
      return;
    }
    let event: PageMessage;
    try {
      event = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (event.type === "mic") {
      page.wants = true;
      join(ws, page);
    } else if (event.type === "download") fetchModels();
    else if (!call || !page.attached) return;
    else if (event.type === "talk") {
      call.claim(page.device);
      call.talk(event.on === true, event.keep === true);
    } else if (event.type === "played") call.played(Number(event.part) || 0, page.device);
    else if (event.type === "hush") call.hush();
  };

  const connect = (ws: WebSocket) => {
    const page: Page = { device: pageDevice(ws, (event) => forPage.has(event.type)), wants: false, attached: false };
    pages.set(ws, page);
    ws.on("message", (data, binary) => onMessage(ws, page, data, binary));
    ws.on("close", () => {
      pages.delete(ws);
      if (!page.attached) return;
      call?.detach(page.device);
      if (!listening()) quiet();
    });
  };

  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(request.url ?? "/", "http://x").pathname !== "/voice" || !web || !sockets) return;
    if (!allowed(request, web.key)) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, connect);
  };

  return {
    name: "voice",
    start(context) {
      web = context;
      // Whether Pi has an OpenRouter key decides how voice speaks; asked once, as the terminal does.
      void context.apiKey("openrouter").then((found) => {
        openRouter = { has: !!found, get: () => context.apiKey("openrouter") };
      });
      sockets = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
      context.http.on("upgrade", upgrade);
    },
    reply(event: Reply) {
      if (event.type === "start") {
        writing = event.id;
        if (!call || !listening()) return;
        speaking = event.id;
        call.replyStart();
        return;
      }
      if (event.type === "end" && writing === event.id) writing = undefined;
      if (!call || event.id !== speaking) return;
      if (event.type === "delta") call.reply(event.text);
      else {
        call.replyEnd();
        speaking = undefined;
      }
    },
    busy(on) {
      busy = on;
      if (on) call?.thinking();
      else {
        call?.idle();
        release();
      }
    },
    talking: () => call?.talking() ?? false,
    async close() {
      clearTimeout(idle);
      if (held) clearTimeout(held.timer);
      held = undefined;
      web?.http.off("upgrade", upgrade);
      for (const ws of sockets?.clients ?? []) ws.close(4000, "bye");
      sockets?.close();
      pages.clear();
      const current = call;
      call = undefined;
      await current?.close();
    },
  };
}
