import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readConfig } from "../config";
import { toolResult } from "../jobs";
import { toolRules } from "../prompt";
import { setStatus } from "../status";
import { lineAt, parentOf, readBack } from "./archive";
import { pageAssets } from "./assets";
import { fileRoute, prepareShow } from "./files";
import {
  lines,
  type Message,
  page,
  pictures,
  showEntry,
  shownLine,
  showTool,
  toImage,
  toLine,
  wakeMark,
} from "./lines";
import { overview } from "./overview";
import type { WebContext, WebPart } from "./part";
import { webParts } from "./parts";
import type { Decision, Line, PageEvent, ServerEvent, Task, Thread } from "./protocol";
import { type Assets, serveWeb, type WebServer } from "./server";
import { connectT3, type T3Link } from "./t3";
import { open, watchTasks } from "./tasks";
import { setUpWebTunnel, stopWebTunnel } from "./tunnel";
import { Waker } from "./wake";

const guidance = readFileSync(new URL("../../prompts/assistant.md", import.meta.url), "utf8").trim();

/**
 * Threads the page shows: top-level ones. Children (the providers' own subagents, delegated tasks) are the
 * threads' business; about two thirds of T3's threads are those.
 */
const topLevel = (threads: Thread[]) => threads.filter((thread) => !thread.parentId);

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
  /** For tests: how long wake-ups gather events. */
  gather?: number;
};

/** Lines of earlier sessions have ids `a<n>.<offset>`: the nth parent session, and where the line starts. */
const archived = /^a(\d+)\.(\d+)$/;

/** Words for the tools a person would care to see being used. */
const doing: Record<string, string> = {
  overview: "Looking at your T3 work",
  read: "Reading its notes",
  write: "Updating its notes",
  edit: "Updating its notes",
  approve: "Answering the thread",
  [showTool]: "Getting it to show you",
  mcp__t3__t3_thread_launch: "Starting a thread",
  mcp__t3__t3_thread_send: "Messaging a thread",
  mcp__t3__t3_thread_read: "Reading a thread",
  mcp__t3__t3_thread_list: "Looking at threads",
  mcp__t3__t3_project_list: "Looking at your projects",
  mcp__t3__t3_thread_interrupt: "Stopping a thread",
  mcp__t3__t3_pending_request_respond: "Answering the thread",
};

/**
 * Words for what a tool call is doing, or nothing for ones not worth showing. A codemode script says what
 * it does in its opening comment; without one, the first tool it calls does.
 */
function step(tool: string, args: { code?: unknown } | undefined) {
  if (tool === "codemode") {
    const code = typeof args?.code === "string" ? args.code : "";
    const comment = /^\s*\/\/\s*(.+)$/m.exec(code.trimStart().split("\n")[0] ?? "")?.[1]?.trim();
    if (comment) return comment.slice(0, 120);
    const first = /tools\.([A-Za-z0-9_]+)\s*\(/.exec(code)?.[1];
    return (first && doing[first]) ?? (first?.startsWith("mcp__t3__") ? "Talking to T3" : "Working it out");
  }
  return doing[tool] ?? (tool.startsWith("mcp__t3__") ? "Talking to T3" : undefined);
}

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
        tasks: () => Task[];
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
  const withOverview = () => {
    if (live?.t3.state().state !== "connected") return;
    const now = overview(live.t3.threads(), live.t3.projects());
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
  /** Ids pages gave the lines they sent, in order, for Pi's echo of each user message. */
  const pageIds: string[] = [];
  /**
   * Pictures of lines sent before Pi saves their message (it saves after extensions hear `message_end`).
   * Only the last few; older ones are read back from the session by entry id.
   */
  const recent = new Map<string, { mimeType: string; data: string }[]>();

  /** Earlier session files, the parent first, found as the page scrolls back into them. */
  let chain: string[] = [];
  const archive = (index: number) => {
    while (chain.length <= index) {
      const parent = chain.length
        ? parentOf(chain[chain.length - 1] as string)
        : ctx?.sessionManager.getHeader()?.parentSession;
      if (!parent || !existsSync(parent)) return undefined;
      chain.push(parent);
    }
    return chain[index];
  };

  /**
   * A page of lines before `before` (or the newest), going on into earlier sessions when this one runs out.
   */
  const history = (before?: string): { lines: Line[]; more: boolean } => {
    const found: Line[] = [];
    let index = 0;
    let end: number | undefined;
    const old = before === undefined ? null : archived.exec(before);
    if (old) {
      index = Number(old[1]);
      end = Number(old[2]);
    } else {
      if (!ctx) return { lines: [], more: false };
      const current = lines(ctx.sessionManager, link, before);
      if (current.more) return current;
      found.push(...current.lines);
    }
    while (found.length < page) {
      const file = archive(index);
      if (!file) return { lines: found, more: false };
      const n = index;
      const back = readBack(file, end, page - found.length, (entry, offset) => {
        const id = `a${n}.${offset}`;
        if (entry.type === "custom" && entry.customType === showEntry)
          return shownLine(entry.data, id, Date.parse(String(entry.timestamp)));
        if (entry.type !== "message") return undefined;
        return toLine(
          entry.message as Message,
          id,
          (picture) => link(id, picture),
          Date.parse(String(entry.timestamp)),
        );
      });
      found.unshift(...back.found);
      if (!back.done) return { lines: found, more: true };
      index++;
      end = undefined;
    }
    return { lines: found, more: archive(index) !== undefined };
  };

  const send = (event: ServerEvent) => live?.server.send(event);
  const link = (id: string, index: number) => `/image/${encodeURIComponent(id)}/${index}?t=${live?.key ?? ""}`;
  const flush = () => {
    if (!writing) return;
    clearTimeout(writing.timer);
    writing.timer = undefined;
    if (!writing.unsent) return;
    send({ type: "append", id: writing.line.id, text: writing.unsent });
    writing.unsent = "";
  };

  const hello = (): ServerEvent => {
    const shown = history();
    return {
      type: "hello",
      lines: writing?.line.text ? [...shown.lines, writing.line] : shown.lines,
      more: shown.more,
      busy,
      t3: live?.t3.state() ?? { state: "connecting" },
      projects: live?.t3.projects() ?? [],
      threads: topLevel(live?.t3.threads() ?? []),
      tasks: live?.tasks() ?? [],
    };
  };

  const image = (id: string, index: number) => {
    const found = recent.get(id);
    if (found) return found[index];
    const old = archived.exec(id);
    if (old) {
      const file = archive(Number(old[1]));
      const text = file && lineAt(file, Number(old[2]));
      if (!text) return undefined;
      const block = pictures((JSON.parse(text).message as Message | undefined)?.content)[index];
      return block?.data ? { mimeType: block.mimeType ?? "image/png", data: block.data } : undefined;
    }
    const entry = ctx?.sessionManager.getEntry(id);
    if (entry?.type !== "message") return undefined;
    const block = pictures((entry.message as Message).content)[index];
    return block?.data ? { mimeType: block.mimeType ?? "image/png", data: block.data } : undefined;
  };

  /**
   * Answers the permission request a thread waits on. Questions (user_input) go through T3's MCP tools
   * instead, since they need answers, not a yes or no.
   */
  const answer = async (threadId: string, decision: Decision) => {
    const thread = live?.t3.threads().find((each) => each.id === threadId);
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
      reply({ type: "older", ...history(event.before) });
      return;
    }
    if (event.type !== "say") return;
    // The page shows the line at once under its own id; the echo of it uses that id.
    if (event.id && /^[\w-]{1,64}$/.test(event.id)) pageIds.push(event.id);
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
        image,
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
      lookup: (id) => t3.threads().find((thread) => thread.id === id),
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
    // The threads open tasks name are followed closely: what they say reaches the assistant.
    const follow = (list: Task[]) => t3.follow(list.filter(open).flatMap((task) => task.threads));
    const tasks = watchTasks(context.cwd, (list) => {
      send({ type: "tasks", tasks: list });
      waker.tasks(list);
      follow(list);
    });
    waker.tasks(tasks.list());
    follow(tasks.list());
    const unsubscribe = t3.onChange((change) => {
      if (change.t3) send({ type: "t3", t3: change.t3 });
      if (change.projects) send({ type: "projects", projects: change.projects });
      if (change.threads) waker.threads(change.threads);
      if (change.message) waker.message(change.message.threadId, change.message.text);
      const threads = topLevel(change.threads ?? []);
      if (threads.length) send({ type: "threads", threads });
    });
    waker.threads(t3.threads());
    const current = {
      server,
      t3,
      key: secret,
      tasks: tasks.list,
      parts,
      waker,
      address: undefined as string | undefined,
      sessionLimit: (config.sessionMB ?? 20) * 1024 * 1024,
      stop: () => {
        unsubscribe();
        waker.close();
        tasks.close();
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

  pi.registerTool({
    name: "overview",
    label: "Overview",
    description:
      "What is going on across all the user's T3 work right now: threads waiting on the user, working, failed, and finished but not yet opened. Instant, from bruv's live view of T3. Start here; read a thread with T3's tools when you need more.",
    parameters: Type.Object({
      project: Type.Optional(Type.String({ description: "Only this project, by name or id." })),
    }),
    async execute(_id, args) {
      if (!live) throw new Error("The web version is off.");
      const state = live.t3.state();
      const text = overview(live.t3.threads(), live.t3.projects(), { project: args.project });
      return {
        ...toolResult({ text }),
        content: [
          { type: "text" as const, text: state.state === "unavailable" ? `T3 is unavailable: ${state.reason}` : text },
        ],
      };
    },
  });

  pi.registerTool({
    name: "approve",
    label: "Approve",
    description:
      "Answer a T3 thread's permission request (a command, a file change, a permission) as the user would in T3. Only when the user said to: approve once, approve for the rest of the thread's session, or deny. The thread's requestKind says what it asks; read the thread first if you need the details.",
    parameters: Type.Object({
      threadId: Type.String(),
      decision: Type.Union([Type.Literal("approve"), Type.Literal("approve for session"), Type.Literal("deny")]),
    }),
    async execute(_id, args) {
      const decision: Decision =
        args.decision === "approve" ? "accept" : args.decision === "deny" ? "decline" : "acceptForSession";
      const thread = await answer(args.threadId, decision);
      return toolResult({ answered: thread.title, decision: args.decision });
    },
  });

  pi.registerTool({
    name: showTool,
    label: "Show",
    description:
      "Show the user a file on the page, in the conversation: a picture, video, sound, HTML page, PDF or text file. From your working folder (path), from a T3 thread's folder (path and thread), or a page a thread showed with html_render (render: its attachment id, and thread). It shows at once; say what it is in a line, not what's in it.",
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: "The file: in your working folder, or with thread, in that thread's folder." }),
      ),
      thread: Type.Optional(Type.String({ description: "The T3 thread whose folder the file is in." })),
      render: Type.Optional(
        Type.String({ description: "An html_render page's attachment id, from the thread's activity." }),
      ),
      title: Type.Optional(Type.String({ description: "A few words for it, shown with it." })),
    }),
    async execute(_id, args, _signal, _update, context) {
      if (!live) throw new Error("The web version is off.");
      const shown = await prepareShow({
        secret: live.key,
        workspace: context.cwd,
        t3: live.t3,
        path: args.path,
        thread: args.thread,
        render: args.render,
        title: args.title,
      });
      // Saved as a line of its own, and on the page now, while the run goes on.
      pi.appendEntry(showEntry, shown);
      send({
        type: "line",
        line: { id: `live-${++count}`, role: "assistant", text: "", files: [shown], at: new Date().toISOString() },
      });
      return {
        content: [{ type: "text" as const, text: `Shown to the user: ${shown.name} (${shown.kind}).` }],
        details: { shown },
      };
    },
  });

  pi.registerFlag("web", { description: "Run as the web version: your assistant for T3 Code work", type: "boolean" });
  pi.registerFlag("web-dev", {
    description: "With --web, serve the page from its source with live reload",
    type: "boolean",
  });
  pi.registerCommand("web", {
    description:
      "Show the web version's link (start Pi with --web to turn it on); /web tunnel serves it on your domain, for your phone",
    getArgumentCompletions: (prefix) =>
      [
        { value: "tunnel", description: "Serve the page on your own domain, for your phone" },
        { value: "tunnel off", description: "Stop serving the page on your domain" },
        { value: "t3 ", description: "Pair with a T3 on another machine: paste the link `t3 pair` prints there" },
        { value: "t3 local", description: "Use the T3 on this machine again" },
      ]
        .filter(({ value }) => value.startsWith(prefix.trimStart()))
        .map(({ value, description }) => ({ value, label: value, description })),
    handler: async (args, context) => {
      const word = args.trim();
      if (word === "tunnel") return setUpWebTunnel(context, options.agentDir);
      if (word === "tunnel off") return stopWebTunnel(context, options.agentDir);
      if (word === "t3" || word.startsWith("t3 ")) {
        const link = word.slice(2).trim();
        if (!live) return context.ui.notify("Start Pi with --web to run the web version.", "info");
        if (!link)
          return context.ui.notify(
            "Run `t3 pair --tailscale` where T3 runs (or with a --host other machines reach), then /web t3 <the pairing link>.",
            "info",
          );
        if (link === "local")
          return context.ui.notify(
            live.t3.unpair() ? "Using the T3 on this machine again." : "Already using the T3 on this machine.",
            "info",
          );
        try {
          const origin = await live.t3.pair(link);
          context.ui.notify(`Paired with T3 at ${origin}.`, "info");
          await registerMcp?.();
        } catch (error) {
          context.ui.notify(`Couldn't pair with T3: ${message(error)}`, "error");
        }
        return;
      }
      context.ui.notify(
        live
          ? `The web version is on: ${live.address ?? live.server.url}`
          : "Start Pi with --web to run the web version.",
        "info",
      );
    },
  });

  pi.registerCommand("web-fresh", {
    description: "Move the web version to a fresh session; the page can still scroll back into this one",
    handler: async (_args, context) => {
      await context.waitForIdle();
      const parent = context.sessionManager.getSessionFile();
      await context.newSession({
        parentSession: parent,
        setup: async (manager) => {
          manager.appendCustomMessageEntry(
            "bruv-web",
            `This conversation continues an earlier one${parent ? `, saved in ${parent}` : ""}. What you are managing is in tasks/ and memory.md in your working folder: read them before acting on earlier work.`,
            false,
          );
        },
      });
    },
  });

  pi.on("session_start", async (_event, context) => {
    ctx = context;
    chain = [];
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
    const id = (first?.role === "user" && pageIds.shift()) || fresh;
    const line = id === fresh ? first : toLine(message, id, (index) => link(id, index));
    if (!line) return;
    if (line.images) {
      recent.set(
        id,
        pictures(message.content).map((block) => ({ mimeType: block.mimeType ?? "image/png", data: block.data ?? "" })),
      );
      for (const old of recent.keys()) if (recent.size > 8) recent.delete(old);
    }
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
    if (event.message.role !== "assistant") return;
    const current = writing;
    writing = undefined;
    clearTimeout(current?.timer);
    if (!live) return;
    const id = current?.line.id ?? `live-${++count}`;
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
