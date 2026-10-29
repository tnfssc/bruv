import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readConfig } from "../config";
import { toolRules } from "../prompt";
import { setStatus } from "../status";
import { pageAssets } from "./assets";
import { registerWebCommands } from "./commands";
import { fileRoute } from "./files";
import { conversationHistory } from "./history";
import { type Message, showEntry, showTool, threadEntry, toImage, toLine, wakeMark } from "./lines";
import { launched, type Mine, mine } from "./mine";
import { overview } from "./overview";
import type { WebContext, WebPart } from "./part";
import { webParts } from "./parts";
import { type Decision, going, type Line, type PageEvent, type ServerEvent, type Thread } from "./protocol";
import { type Assets, serveWeb, type WebServer } from "./server";
import { step } from "./steps";
import { connectT3, type T3Link } from "./t3";
import { registerWebTools } from "./tools";
import { Waker } from "./wake";

const guidance = readFileSync(new URL("../../prompts/assistant.md", import.meta.url), "utf8").trim();

/**
 * Pi's tools the assistant keeps: its workspace files and scripts. It doesn't run commands or code; T3's
 * threads do the work. T3's own tools (`mcp__t3__*`) and `overview` are added to these.
 */
const ownTools = new Set(["codemode", "tool_search", "read", "write", "edit", "overview", "approve", showTool]);

/** T3 tools the model sees directly; the other ~80 stay behind codemode. */
const directTools = ["t3_thread_list", "t3_thread_read", "t3_thread_launch", "t3_thread_send"];

type Options = {
  agentDir?: string;
  /** For tests: turn it on without the flag, which Pi sets only from the command line. */
  on?: boolean;
  /** For tests: a stand-in for T3 and for the page's files. */
  t3?: (dir: string) => T3Link;
  assets?: (server: import("node:http").Server) => Promise<Assets>;
  /** For tests: the parts to start instead of the real ones (voice, push, tunnel). */
  parts?: () => WebPart[];
  /** For tests: threads taken as the assistant's own from the start. */
  ours?: string[];
  /** For tests: how long wake-ups gather events. */
  gather?: number;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The page's key. It stays the same across runs, so a bookmarked link keeps working. */
function key(dir: string) {
  const file = join(dir, "key");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const fresh = randomBytes(18).toString("base64url");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, fresh, { mode: 0o600 });
  return fresh;
}

/**
 * The web version: `pi --web` makes this Pi session the user's assistant for their work in T3 Code, talked
 * to from a page in the browser. The folder Pi starts in is the assistant's workspace for its notes.
 */
export function registerWeb(pi: ExtensionAPI, options: Options = {}) {
  let live:
    | {
        server: WebServer;
        t3: T3Link;
        key: string;
        /** The threads the assistant started. */
        mine: Mine;
        /** Follows the assistant's threads that are at work now. */
        refollow: () => void;
        parts: WebPart[];
        waker: Waker;
        /** The tunnel's address once it is up; else the local one. */
        address?: string;
        /** Bytes the session file may grow to before moving to a fresh session. */
        sessionLimit: number;
        stop: () => void;
      }
    | undefined;
  /**
   * T3's overview as the assistant last saw it. A message from the user or a wake-up carries the new one
   * when it changed, so "what's going on?" needs no extra model round trip, and an unchanged picture costs
   * nothing (the prompt stays cached).
   */
  let shownOverview = "";
  /** Registers T3's MCP server again when its key or origin changed (after pairing with another T3). */
  let registerMcp: (() => Promise<void>) | undefined;
  /** The assistant's threads and what descends from them, as T3 shows them now. */
  const ours = (threads: Thread[]) => {
    const current = live;
    return current ? threads.filter((thread) => current.mine.has(thread, current.t3.thread)) : [];
  };
  const withOverview = () => {
    if (live?.t3.state().state !== "connected") return;
    const now = overview(ours(live.t3.threads()), live.t3.projects());
    if (now === shownOverview) return;
    shownOverview = now;
    pi.sendMessage(
      {
        customType: "bruv-web-t3",
        content: `T3 right now (from bruv, not the user):\n${now}`,
        display: false,
      },
      { deliverAs: "nextTurn" },
    );
  };
  /** The run going on was started by a wake-up; its last written words are news for the user. */
  let waking = false;
  let news = "";
  let ctx: ExtensionContext | undefined;
  let busy = false;
  let count = 0;
  /**
   * The reply being written. Text comes as Pi's deltas and goes to pages as `append`s a few times a
   * second, so a long reply costs its length once, not once per update.
   */
  let writing: { line: Line; unsent: string; blocks: number; timer?: ReturnType<typeof setTimeout> } | undefined;
  /**
   * Ids pages gave the lines they sent, with the words, for Pi's echo of each user message. Matched by the
   * words rather than by order: a line that never reaches Pi (sent during compaction) or a message from
   * elsewhere would otherwise shift every later echo onto the wrong line.
   */
  const pageIds: { id: string; text: string; at: number }[] = [];
  /** Line ids of messages waiting for Pi to save them, by message. */
  const unsaved = new WeakMap<object, string>();
  const link = (id: string, index: number) => `/image/${encodeURIComponent(id)}/${index}?t=${live?.key ?? ""}`;
  const past = conversationHistory({ session: () => ctx?.sessionManager, link });

  const send = (event: ServerEvent) => live?.server.send(event);
  const flush = () => {
    if (!writing) return;
    clearTimeout(writing.timer);
    writing.timer = undefined;
    if (!writing.unsent) return;
    send({ type: "append", id: writing.line.id, text: writing.unsent });
    writing.unsent = "";
  };

  const hello = (): ServerEvent => {
    const shown = past.page();
    return {
      type: "hello",
      lines: writing?.line.text ? [...shown.lines, writing.line] : shown.lines,
      more: shown.more,
      busy,
      t3: live?.t3.state() ?? { state: "connecting" },
      projects: live?.t3.projects() ?? [],
      threads: ours(live?.t3.threads() ?? []),
    };
  };

  /**
   * Answers the permission request a thread waits on. Questions (user_input) go through T3's MCP tools
   * instead, since they need answers, not a yes or no.
   */
  const answer = async (threadId: string, decision: Decision) => {
    const thread = live?.t3.thread(threadId);
    if (!live || !thread?.requestId) throw new Error("That thread isn't waiting on a permission request.");
    if (thread.requestKind === "user_input")
      throw new Error("That thread asks a question; answer it with t3_pending_request_respond.");
    await live.t3.respond(thread.id, thread.requestId, decision);
    return thread;
  };

  const onPage = (event: PageEvent, reply: (event: ServerEvent) => void) => {
    if (event.type === "respond") {
      answer(event.threadId, event.decision).catch((error) =>
        live?.server.send({ type: "step", text: `Couldn't answer: ${message(error)}` }),
      );
      return;
    }
    if (event.type === "stop") {
      ctx?.abort();
      return;
    }
    if (event.type === "more") {
      reply({ type: "older", ...past.page(event.before) });
      return;
    }
    if (event.type !== "say") return;
    // The page shows the line at once under its own id; the echo of it uses that id.
    if (event.id && /^[\w-]{1,64}$/.test(event.id)) {
      // Ones Pi never echoed are given up after a while.
      while (pageIds.length && (pageIds.length > 20 || Date.now() - (pageIds[0]?.at ?? 0) > 120_000)) pageIds.shift();
      pageIds.push({ id: event.id, text: event.text.trim(), at: Date.now() });
    }
    say(event.text, event.images);
  };

  /** Words for the assistant. While it works, they join the run after its current step instead of waiting. */
  const say = (words: string, urls: string[] = []) => {
    const images = urls.flatMap((url) => {
      const picture = toImage(url);
      return picture ? [picture] : [];
    });
    const text = words.trim();
    if (!text && !images.length) return;
    const content = images.length ? [{ type: "text" as const, text }, ...images] : text;
    if (ctx?.isIdle() ?? true) {
      withOverview();
      pi.sendUserMessage(content);
    } else pi.sendUserMessage(content, { deliverAs: "steer" });
  };

  const start = async (context: ExtensionContext) => {
    const agentDir = options.agentDir ?? getAgentDir();
    const dir = join(agentDir, "bruv", "web");
    const config = readConfig(agentDir).web ?? {};
    const t3 = (options.t3 ?? ((folder) => connectT3({ dir: folder })))(dir);
    const dev = pi.getFlag("web-dev") === true;
    const secret = key(dir);
    let server: WebServer;
    try {
      server = await serveWeb({
        host: config.host ?? "127.0.0.1",
        port: config.port ?? 7808,
        key: secret,
        assets: options.assets ?? ((http) => pageAssets({ dev, server: http })),
        hello,
        onPage,
        image: past.image,
      });
    } catch (error) {
      t3.close();
      throw error;
    }
    const workspace = context.cwd;
    server.route(fileRoute({ secret: () => secret, workspace: () => workspace, t3: () => t3 }));
    const parts = (options.parts ?? webParts)();
    const free = () => !busy && (ctx?.isIdle() ?? true) && !parts.some((part) => part.talking?.());
    const waker = new Waker({
      everyMinutes: config.lookMinutes ?? 60,
      gather: options.gather,
      lookup: (id) => t3.thread(id),
      free,
      wake: ({ text, said }) => {
        waking = true;
        news = "";
        withOverview();
        // What the threads said goes to the assistant only; the page shows the short line.
        if (said)
          pi.sendMessage(
            {
              customType: "bruv-web-said",
              content: `What your threads said (from bruv, not the user):\n\n${said}`,
              display: false,
            },
            { deliverAs: "nextTurn" },
          );
        pi.sendUserMessage(`${wakeMark}${text}`);
      },
    });
    const mineList = mine(join(dir, "threads.json"), context.cwd);
    for (const id of options.ours ?? []) mineList.add(id);
    const isMine = (thread: Thread) => mineList.has(thread, t3.thread);
    /**
     * What the assistant's threads say reaches it as they say it. Only the ones at work (and those that
     * just stopped, whose last words may still be on the way) are followed, so old threads cost nothing.
     */
    const followAtWork = () => {
      const soon = Date.now() - 10 * 60_000;
      t3.follow(
        mineList.ids().filter((id) => {
          const thread = t3.thread(id);
          return (
            thread &&
            !thread.away &&
            (going.has(thread.status) || thread.holding || thread.needsUser || Date.parse(thread.updatedAt) > soon)
          );
        }),
      );
    };
    waker.follow(mineList.ids());
    followAtWork();
    const unsubscribe = t3.onChange((change) => {
      if (change.t3) send({ type: "t3", t3: change.t3 });
      if (change.projects) send({ type: "projects", projects: change.projects });
      if (change.threads) {
        waker.threads(change.threads);
        const changed = change.threads.filter(isMine);
        if (changed.length) {
          send({ type: "threads", threads: changed });
          followAtWork();
        }
      }
      if (change.message) waker.message(change.message.threadId, change.message.text);
    });
    // Stopped threads drop out of following after a while, with nothing from T3 to say so.
    const refollow = setInterval(followAtWork, 5 * 60_000);
    refollow.unref?.();
    const current = {
      server,
      t3,
      key: secret,
      mine: mineList,
      refollow: followAtWork,
      parts,
      waker,
      address: undefined as string | undefined,
      sessionLimit: (config.sessionMB ?? 20) * 1024 * 1024,
      stop: () => {
        unsubscribe();
        clearInterval(refollow);
        waker.close();
        t3.close();
      },
    };
    live = current;
    const web: WebContext = {
      http: server.http,
      route: server.route,
      key: secret,
      dir,
      agentDir,
      address: () => current.address ?? server.url,
      setAddress: (url) => {
        current.address = url;
      },
      say: (text) => say(text),
      stop: () => ctx?.abort(),
      watched: () => server.watched(),
      apiKey: async (provider) => ctx?.modelRegistry.getApiKeyForProvider(provider).catch(() => undefined),
      notify: (text, kind = "info") => context.ui.notify(text, kind),
    };
    for (const part of parts) {
      try {
        await part.start(web);
      } catch (error) {
        context.ui.notify(`The web version's ${part.name} failed: ${message(error)}`, "error");
      }
    }
    // T3's tools for the model. The key comes from bruv's own sign-in, so Pi's MCP client needs no browser.
    // T3's keys last 30 days, so it is checked now and then (one small request) and registered again when
    // a new sign-in replaced it.
    let registered = "";
    const register = async () => {
      const mcp = await t3.mcp().catch(() => undefined);
      if (!mcp || live !== current) return;
      const signature = JSON.stringify(mcp);
      if (signature === registered) return;
      registered = signature;
      pi.registerMcpServer("t3", {
        url: mcp.url,
        headers: mcp.headers,
        exposure: "codemode",
        toolExposure: Object.fromEntries(directTools.map((name) => [name, "direct"])),
        description: "T3 Code: the user's coding-agent threads and projects.",
      });
    };
    registerMcp = register;
    void register();
    const recheck = setInterval(() => void register(), 6 * 60 * 60 * 1000);
    recheck.unref?.();
    const stopCurrent = current.stop;
    current.stop = () => {
      clearInterval(recheck);
      stopCurrent();
    };
    setStatus(context, "web", "● web");
    context.ui.notify(`The web version is on: ${server.url}`, "info");
  };

  const stop = async () => {
    const current = live;
    live = undefined;
    if (!current) return;
    current.stop();
    for (const part of current.parts) await Promise.resolve(part.close()).catch(() => {});
    await current.server.close();
  };
  /**
   * Pi keeps a session's whole file in memory and reads it all at start, so a session that grows big moves
   * to a fresh one while the assistant is idle. Its notes are in its workspace files, and the page scrolls
   * back into the old session. A stat once per run is the whole cost.
   */
  const freshen = () => {
    const file = ctx?.sessionManager.getSessionFile();
    if (!live || !file || live.parts.some((part) => part.talking?.())) return;
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {
      return;
    }
    if (size > live.sessionLimit) pi.sendUserMessage("/web-fresh", { expandPromptTemplates: true });
  };
  const each = (call: (part: WebPart) => void) => {
    for (const part of live?.parts ?? []) {
      try {
        call(part);
      } catch {}
    }
  };

  // The assistant's tools exist only in the web version: a coding session would carry them on every request
  // for nothing. Pi sets flag values only after extensions load, so this reads the command line.
  if (options.on ?? process.argv.includes("--web"))
    registerWebTools(pi, {
      live: () => live,
      answer,
      ours,
      shown: (file) => {
        // Saved as a line of its own, and on the page now, while the run goes on.
        pi.appendEntry(showEntry, file);
        const id = `live-${++count}`;
        past.savedAs(id);
        send({ type: "line", line: { id, role: "assistant", text: "", files: [file], at: new Date().toISOString() } });
      },
    });

  pi.registerFlag("web", { description: "Run as the web version: your assistant for T3 Code work", type: "boolean" });
  pi.registerFlag("web-dev", {
    description: "With --web, serve the page from its source with live reload",
    type: "boolean",
  });
  registerWebCommands(pi, {
    agentDir: options.agentDir,
    live: () => live && { t3: live.t3, address: live.address ?? live.server.url },
    registerMcp: () => registerMcp?.(),
  });

  pi.on("session_start", async (_event, context) => {
    ctx = context;
    past.reset();
    if (!(options.on ?? pi.getFlag("web") === true) || live) return;
    try {
      await start(context);
    } catch (error) {
      context.ui.notify(`The web version failed: ${message(error)}`, "error");
    }
  });
  pi.on("before_agent_start", (event, context) => {
    ctx = context;
    if (!live) return;
    // Only what the assistant needs is declared, which also keeps every request small.
    const active = pi.getActiveTools();
    const kept = active.filter((name) => ownTools.has(name) || name.startsWith("mcp__"));
    if (!kept.includes("overview")) kept.push("overview");
    if (kept.length !== active.length || kept.some((name, index) => name !== active[index])) pi.setActiveTools(kept);
    const options = event.systemPromptOptions;
    options.skills = [];
    options.selectedTools = kept;
    const rules = toolRules(options);
    if (rules) options.sections.tool_rules = rules;
    options.customPrompt = `${guidance}\n\nYour working folder is ${context.cwd}.`;
  });
  pi.on("agent_start", (_event, context) => {
    ctx = context;
    busy = true;
    send({ type: "busy", busy });
    each((part) => part.busy?.(true));
  });
  pi.on("agent_settled", () => {
    busy = false;
    send({ type: "busy", busy });
    each((part) => part.busy?.(false));
    // A wake-up that found something worth saying is news for a user who isn't looking.
    const said = waking ? news.trim() : "";
    waking = false;
    news = "";
    if (said) each((part) => part.news?.(said));
    live?.waker.free();
    freshen();
  });
  // A step a person can follow: codemode scripts start with a comment saying what they do.
  // A thread the assistant starts, directly or from a script, becomes one of its own: listed on the page,
  // followed, and shown as a card in the conversation.
  pi.on("tool_execution_end", (event) => {
    if (!live || event.isError || !/(^|__)t3_thread_launch$/.test(event.toolName)) return;
    const id = launched(event.result);
    if (!id || !live.mine.add(id)) return;
    live.waker.follow(live.mine.ids());
    // T3's record of it comes moments later; following starts when it does.
    live.refollow();
    pi.appendEntry(threadEntry, { id });
    const line = `live-${++count}`;
    past.savedAs(line);
    send({ type: "line", line: { id: line, role: "assistant", text: "", thread: id, at: new Date().toISOString() } });
    const thread = live.t3.thread(id);
    if (thread) send({ type: "threads", threads: [thread] });
  });
  pi.on("tool_execution_start", (event) => {
    if (!live || event.parentToolCallId) return;
    const text = step(event.toolName, event.args);
    if (text) send({ type: "step", text });
  });
  pi.on("message_start", (event) => {
    if (!live || event.message.role === "assistant") return;
    const message = event.message as Message;
    const fresh = `live-${++count}`;
    const first = toLine(message, fresh, (index) => link(fresh, index));
    // Wake-ups are user messages too, but no page sent them.
    const index = first?.role === "user" ? pageIds.findIndex((each) => each.text === first.text.trim()) : -1;
    const id = index >= 0 ? (pageIds.splice(index, 1)[0]?.id ?? fresh) : fresh;
    const line = id === fresh ? first : toLine(message, id, (index) => link(id, index));
    if (!line) return;
    if (line.images) past.remember(id, message);
    unsaved.set(event.message, id);
    send({ type: "line", line });
  });
  pi.on("message_update", (event) => {
    if (!live || event.message.role !== "assistant") return;
    const update = event.assistantMessageEvent;
    if (update.type !== "text_start" && update.type !== "text_delta") return;
    if (!writing) {
      const at = new Date().toISOString();
      writing = {
        line: { id: `live-${++count}`, role: "assistant", text: "", at, partial: true },
        unsent: "",
        blocks: 0,
      };
    }
    // Text blocks are joined by a blank line, as in the finished line.
    const added = update.type === "text_start" ? (writing.blocks++ ? "\n\n" : "") : update.delta;
    if (!added) return;
    const first = !writing.line.text;
    writing.line.text += added;
    const id = writing.line.id;
    if (first) each((part) => part.reply?.({ type: "start", id }));
    each((part) => part.reply?.({ type: "delta", id, text: added }));
    if (first) {
      send({ type: "line", line: writing.line });
      return;
    }
    writing.unsent += added;
    writing.timer ??= setTimeout(flush, 100);
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") {
      const id = unsaved.get(event.message);
      if (id) past.whenSaved(event.message, id);
      return;
    }
    const current = writing;
    writing = undefined;
    clearTimeout(current?.timer);
    if (!live) return;
    const id = current?.line.id ?? `live-${++count}`;
    past.whenSaved(event.message, id);
    const line = toLine(event.message as Message, id, (index) => link(id, index));
    if (line) send({ type: "line", line });
    else if (current?.line.text) send({ type: "line", line: { ...current.line, partial: false } });
    const text = line?.text ?? current?.line.text ?? "";
    if (current) each((part) => part.reply?.({ type: "end", id, text }));
    if (text) news = text;
  });
  pi.on("session_shutdown", async () => {
    await stop();
  });
}
