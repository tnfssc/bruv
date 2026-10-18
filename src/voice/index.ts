import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { readConfig, saveConfig } from "../config";
import { setStatus } from "../status";
import { Call, type Engine } from "./call";
import { chooseCloud } from "./choose";
import { downloadCloudflared, findCloudflared, runTunnel } from "./cloudflared";
import { type Cloud, startEngine } from "./engine";
import { readKey, saveKey } from "./keys";
import { audioMissing, startLocal } from "./local";
import { download, type ModelPaths, missing, modelPaths } from "./models";
import { registerSay, Speaker } from "./say";
import { type Served, serve } from "./server";
import { showInTerminal, showPhoneCode } from "./terminal";
import { isEcho } from "./text";
import { registerShow, voiceTools } from "./tool";
import { cleanHost, permissions, prepare } from "./tunnel";

const guidance = readFileSync(new URL("../../prompts/voice.md", import.meta.url), "utf8").trim();

type Options = {
  engine?: (paths: ModelPaths, threads?: number, cloud?: Cloud, speed?: number) => Engine;
  /** This machine's microphone and speaker, or why they can't be used. */
  local?: (call: Call) => { stop(): void } | string;
  agentDir?: string;
  /** For Cloudflare's API. */
  fetch?: typeof fetch;
};

/**
 * Where voice is right now, for the model: who holds the microphone and whether a page is open. It changes
 * only when that does, so the prompt stays cached in between.
 */
function where(voice: { call: Call; tunnel?: { url: string } }) {
  const { screens, mic } = voice.call.where();
  const lines = [
    mic === "local"
      ? "Right now the user talks through this machine's microphone and hears its speaker, at the terminal."
      : mic === "page"
        ? "Right now the user talks through the voice page, maybe on a phone or another computer, not at this machine's terminal."
        : "Nothing is connected to voice right now: the voice page isn't open, so a message now was typed.",
  ];
  if (mic === "local" && screens)
    lines.push("A voice page is open too, so they may be on a phone or another computer.");
  if (voice.tunnel) lines.push(`The voice page can be reached from anywhere at ${new URL(voice.tunnel.url).host}.`);
  return lines.join(" ");
}

/** What /voice takes after it; /voice alone turns voice in the terminal on or off. */
const choices = [
  { value: "web", description: "Talk from the browser, alongside the terminal" },
  { value: "tunnel", description: "Serve the page on your own domain, for your phone" },
  { value: "tunnel off", description: "Stop serving the page on your domain" },
  { value: "speed", description: "How fast it talks: /voice speed 1.2 is a fifth faster" },
  { value: "off", description: "Turn voice off everywhere" },
];

/** The slowest and fastest /voice speed takes, around the normal pace of 1; Drama 3 goes no faster. */
const speeds = { slowest: 0.5, fastest: 1.6 };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The page's key. It stays the same across runs, so a bookmarked or tunnelled link keeps working. */
function token(dir: string) {
  const file = join(dir, "token");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const fresh = randomBytes(18).toString("base64url");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, fresh, { mode: 0o600 });
  return fresh;
}

/**
 * /voice: talk to bruv with this machine's microphone and speaker; /voice again stops. /voice web adds a
 * browser page as a microphone and speaker, so bruv can be used from anywhere the page can reach. Speech is
 * recognised and spoken on this machine; the session's model is the brain.
 */
export function registerVoice(pi: ExtensionAPI, options: Options = {}) {
  let live:
    | {
        call: Call;
        engine: Engine;
        /** The page server, started by /voice web or /voice tunnel. */
        served?: Served;
        local?: { stop(): void };
        tunnel?: { stop(): void; url: string };
      }
    | undefined;
  let starting: Promise<unknown> | undefined;
  /** Where the phone's QR code is showing, so it can go when a page starts. */
  let phoneCode: ExtensionContext["ui"] | undefined;
  const hidePhoneCode = () => {
    phoneCode?.setWidget("bruv-voice-phone", undefined);
    phoneCode = undefined;
  };
  let ctx: ExtensionContext | undefined;
  const agentDir = () => options.agentDir ?? getAgentDir();
  const dir = () => join(agentDir(), "bruv", "voice");
  const status = (context: ExtensionContext) =>
    setStatus(context, "voice", `● voice${live?.served ? " · web" : ""}${live?.tunnel ? " · tunnel" : ""}`);

  /** Tools running now. While one runs, the user's words wait for it; Pi only takes them between steps. */
  let tools = 0;
  /** Set when the user spoke and the agent hasn't said anything back yet. */
  let awaiting = false;
  const speaker = new Speaker(() => live?.call);

  /**
   * What the user says goes to the agent as a voice message. While it thinks or writes, that stops so it
   * answers now; nothing is lost but the unfinished reply. A running tool is left to finish (cutting it
   * would break builds and edits), and the words arrive when it does. A message that starts a run is a user
   * message: a run started by a custom message gets Pi's base prompt, without bruv's or voice's sections.
   */
  const tell = async (words: string, _interrupted: boolean, cut?: string) => {
    // The note says how much of what it said the user actually heard.
    const heard = cut ? ` They talked over you at: "${cut}"` : "";
    const content = `The user said by voice: "${words}"${heard}`;
    awaiting = true;
    if (ctx && !ctx.isIdle() && !tools) {
      ctx.abort();
      // Pi is not idle yet when agent_end comes, and a message queued then is lost.
      for (let waited = 0; !ctx.isIdle() && waited < 5000; waited += 20) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    if (ctx?.isIdle() ?? true) {
      pi.sendUserMessage(content);
      return;
    }
    // Shown, so a long step doesn't look like being ignored.
    if (tools) live?.call.note("tool", "Your words reach the agent when this step ends");
    pi.sendMessage({ customType: "bruv-voice", content, display: true, details: { words } }, { deliverAs: "steer" });
  };

  const start = async (context: ExtensionContext) => {
    const config = readConfig(options.agentDir).voice ?? {};
    const models = join(dir(), "models");
    const needed = missing(models);
    if (needed.length) {
      const mb = needed.reduce((sum, model) => sum + model.mb, 0);
      const ok =
        !context.hasUI ||
        (await context.ui.confirm(
          "Download voice models?",
          `Voice runs speech recognition and speech on this machine. It needs ${mb} MB of models in ${models}.`,
        ));
      if (!ok) {
        context.ui.notify("Voice stays off.", "info");
        return;
      }
      await download(models, (text) => setStatus(context, "voice", text));
    }
    const cloud = await chooseCloud(context, config.speech, dir());
    const engine = (options.engine ?? startEngine)(
      modelPaths(models, config.voice),
      config.threads,
      cloud,
      config.speed,
    );
    // Pages show these themselves; the terminal has only this.
    engine.onEvent((event) => event.type === "error" && context.ui.notify(event.message, "error"));
    const call = new Call(engine, {
      tell: (text, interrupted, cut) => void tell(text, interrupted, cut),
    });
    live = { call, engine };
    voiceTools(pi, true);
    status(context);
    return live;
  };

  /** Starts voice once, however many commands ask for it at the same time. */
  const ensure = async (context: ExtensionContext) => {
    if (!live) {
      starting ??= start(context).finally(() => {
        starting = undefined;
      });
      await starting;
    }
    return live;
  };

  /**
   * Starts the page server, and the tunnel if one was set up before (unless `savedTunnel` is false). Nothing
   * opens a browser: the user wanted a link to click, which is the tunnel's once it is up, since that is
   * where an installed app lives.
   */
  const web = async (context: ExtensionContext, savedTunnel = true) => {
    if (!live || live.served) return live?.served;
    const current = live;
    const config = readConfig(options.agentDir).voice ?? {};
    const served = await serve(current.call, {
      host: config.host ?? "127.0.0.1",
      port: config.port ?? 7807,
      token: token(dir()),
      onStart: hidePhoneCode,
    });
    if (live !== current) {
      await served.close();
      return undefined;
    }
    current.served = served;
    status(context);
    const host = config.tunnel;
    const key = readKey(agentDir());
    // The tunnel can take a while; the page works locally meanwhile.
    if (savedTunnel && host && key)
      void openTunnel(context, host, key).then(
        () => live?.tunnel && context.ui.notify(`Voice from anywhere: ${live.tunnel.url}`, "info"),
        (error) => context.ui.notify(`Voice tunnel failed: ${message(error)}`, "error"),
      );
    return served;
  };

  /** cloudflared on this machine, or a copy downloaded after asking. */
  const cloudflared = async (context: ExtensionContext) => {
    const bin = join(dir(), "bin");
    const found = findCloudflared(bin);
    if (found) return found;
    const ok =
      context.hasUI &&
      (await context.ui.confirm(
        "Download cloudflared?",
        `The tunnel runs Cloudflare's cloudflared program, which isn't installed. Download it (about 40 MB) from github.com/cloudflare/cloudflared into ${bin}?`,
      ));
    if (!ok) throw new Error("The tunnel needs cloudflared. Install it, then run /voice tunnel again.");
    setStatus(context, "voice", "voice: downloading cloudflared");
    return downloadCloudflared(bin);
  };

  /** Serves the page on https://host through a Cloudflare tunnel. */
  const openTunnel = async (context: ExtensionContext, host: string, key: string) => {
    if (!live?.served) return;
    const served = live.served;
    const binary = await cloudflared(context);
    setStatus(context, "voice", "voice: connecting tunnel");
    const listen = readConfig(options.agentDir).voice?.host ?? "127.0.0.1";
    const origin = `http://${listen === "0.0.0.0" || listen === "::" ? "127.0.0.1" : listen}:${served.port}`;
    try {
      const current = live;
      const tunnel = { stop: () => {}, url: `https://${host}/${new URL(served.url).search}` };
      const running = await runTunnel(binary, await prepare(key, host, origin, options.fetch), (message) => {
        if (current.tunnel !== tunnel) return;
        current.tunnel = undefined;
        served.setRemote(undefined);
        hidePhoneCode();
        status(context);
        context.ui.notify(`Voice tunnel stopped: ${message}`, "error");
      });
      tunnel.stop = running.stop;
      current.tunnel?.stop();
      if (live === current) {
        current.tunnel = tunnel;
        served.setRemote(tunnel.url);
        if (context.mode === "tui") {
          showPhoneCode(context.ui, tunnel.url);
          phoneCode = context.ui;
        }
      } else running.stop();
    } finally {
      if (live) status(context);
    }
  };

  /** Closes the page server and its tunnel, keeping voice in the terminal. */
  const stopWeb = async (context: ExtensionContext) => {
    const current = live;
    if (!current?.served) return;
    current.tunnel?.stop();
    current.tunnel = undefined;
    const served = current.served;
    current.served = undefined;
    hidePhoneCode();
    await served.close();
    status(context);
  };

  const stop = async (context?: ExtensionContext) => {
    const current = live;
    live = undefined;
    if (!current) return;
    voiceTools(pi, false);
    current.local?.stop();
    current.tunnel?.stop();
    await current.served?.close();
    await current.call.close();
    if (context) setStatus(context, "voice", undefined);
    if (context?.mode === "tui") showInTerminal(context.ui, undefined);
    hidePhoneCode();
    // Pages saved for terminal links are only for this run.
    rmSync(join(dir(), "shown"), { recursive: true, force: true });
  };

  const run = async (args: string, context: ExtensionContext) => {
    ctx = context;
    const word = args.trim();
    if (word === "off") {
      await stop(context);
      context.ui.notify("Voice is off.", "info");
      return;
    }
    const pace = /^speed\b\s*(.*)$/.exec(word);
    if (pace) {
      const current = readConfig(options.agentDir).voice?.speed ?? 1;
      if (!pace[1]) {
        context.ui.notify(
          `Voice talks at ${current}× its normal pace. /voice speed 1.2 makes it a fifth faster.`,
          "info",
        );
        return;
      }
      const speed = Number(pace[1].replace(/[x×]$/i, ""));
      if (!(speed >= speeds.slowest && speed <= speeds.fastest)) {
        context.ui.notify(
          `Give a speed from ${speeds.slowest} to ${speeds.fastest}, such as /voice speed 1.2.`,
          "error",
        );
        return;
      }
      saveConfig({ voice: { ...readConfig(options.agentDir).voice, speed } }, options.agentDir);
      live?.engine.setSpeed?.(speed);
      context.ui.notify(`Voice talks at ${speed}× its normal pace${live ? ", from the next sentence" : ""}.`, "info");
      return;
    }
    if (word === "tunnel off") {
      live?.tunnel?.stop();
      if (live) live.tunnel = undefined;
      live?.served?.setRemote(undefined);
      hidePhoneCode();
      const { tunnel: host, ...rest } = readConfig(options.agentDir).voice ?? {};
      if (host) saveConfig({ voice: rest }, options.agentDir);
      if (live) status(context);
      const key = readKey(agentDir()) ? " /logout can remove the saved Cloudflare key." : "";
      context.ui.notify(`Voice tunnel is off.${key}`, "info");
      return;
    }
    if (word === "") {
      // /voice turns voice in the terminal on, and off again. The page, when on, stays on.
      if (live?.local) {
        if (live.served) {
          live.local.stop();
          live.local = undefined;
          context.ui.notify("Voice in the terminal is off; the page stays on. /voice off stops it too.", "info");
          return;
        }
        await stop(context);
        context.ui.notify("Voice is off.", "info");
        return;
      }
      const absent = options.local ? undefined : audioMissing();
      if (absent) throw new Error(`${absent} Or use /voice web to talk from the browser.`);
      const current = await ensure(context);
      if (!current) return;
      const local = (options.local ?? startLocal)(current.call);
      if (typeof local === "string") {
        if (!current.served) await stop(context);
        throw new Error(`${local} Or use /voice web to talk from the browser.`);
      }
      current.local = local;
      context.ui.notify("Voice is on. Just talk; /voice again turns it off.", "info");
      return;
    }
    if (word !== "web" && word !== "tunnel") {
      context.ui.notify(
        "Use /voice, /voice web, /voice tunnel, /voice tunnel off, /voice speed or /voice off.",
        "error",
      );
      return;
    }
    if (word === "tunnel") {
      await setUpTunnel(context);
      return;
    }
    const served = (await ensure(context)) && (await web(context));
    if (!served) return;
    const saved = readConfig(options.agentDir).voice?.tunnel;
    const remote = live?.tunnel
      ? `\nFrom anywhere: ${live.tunnel.url}`
      : saved
        ? `\nConnecting the tunnel to ${saved}; its link comes here once it's up.`
        : "\nTo talk from your phone, run /voice tunnel.";
    // An installed app keeps one address; a page on another port is a different app.
    const wanted = readConfig(options.agentDir).voice?.port ?? 7807;
    const moved =
      wanted && served.port !== wanted ? `\nPort ${wanted} was busy, so this page is on ${served.port}.` : "";
    context.ui.notify(`Voice is on: ${served.url}${remote}${moved}`, "info");
  };

  /**
   * /voice tunnel: asks for the host and the Cloudflare key, then starts voice and the page if they are off,
   * sets the tunnel up, and keeps both. Cancelling a question changes nothing; if the tunnel fails, what this
   * started stops again.
   */
  const setUpTunnel = async (context: ExtensionContext) => {
    const config = readConfig(options.agentDir).voice ?? {};
    const typedHost = await context.ui.input("Host name for the voice page", config.tunnel ?? "voice.example.com");
    if (typedHost === undefined) return;
    const host = cleanHost(typedHost || config.tunnel || "");
    if (!host) {
      context.ui.notify("That isn't a host name. Use one like voice.example.com.", "error");
      return;
    }
    const saved = readKey(agentDir());
    const answer = await context.ui.input(
      saved ? "Cloudflare token" : "Cloudflare API token or tunnel token",
      saved ? "Leave empty to keep the saved one" : `API token with ${permissions}`,
    );
    // Escape gives undefined; only an empty answer keeps the saved key.
    if (answer === undefined) return;
    const typedKey = answer.trim();
    const key = typedKey || saved;
    if (!key) {
      context.ui.notify("The tunnel needs a Cloudflare token.", "error");
      return;
    }
    const wasOn = live !== undefined;
    const wasServed = live?.served !== undefined;
    if (!(await ensure(context)) || !(await web(context, false))) return;
    try {
      await openTunnel(context, host, key);
    } catch (error) {
      if (!wasOn) await stop(context);
      else if (!wasServed) await stopWeb(context);
      throw error;
    }
    if (typedKey) await saveKey(typedKey, agentDir());
    saveConfig({ voice: { ...readConfig(options.agentDir).voice, tunnel: host } }, options.agentDir);
    context.ui.notify(`Voice is on at ${live?.tunnel?.url}`, "info");
  };

  const command = async (args: string, context: ExtensionContext) => {
    try {
      await run(args, context);
    } catch (error) {
      if (live) status(context);
      else setStatus(context, "voice", undefined);
      context.ui.notify(`Voice failed: ${message(error)}`, "error");
    }
  };

  pi.registerMessageRenderer("bruv-voice", (entry, _options, theme) => {
    const words = (entry.details as { words?: string } | undefined)?.words;
    return new Text(`${theme.fg("accent", "●")} ${words ?? ""}`, 1, 0);
  });
  registerSay(
    pi,
    speaker,
    () => {
      awaiting = false;
    },
    () => live?.call.hearers() ?? [],
  );
  registerShow(
    pi,
    () =>
      live && {
        call: live.call,
        web: live.served && {
          shelf: live.served.shelf,
          address: new URL(live.tunnel?.url ?? live.served.url).origin,
        },
        saved: join(dir(), "shown"),
      },
  );
  pi.registerFlag("voice", { description: "Start voice with this machine's microphone and speaker", type: "boolean" });
  pi.registerCommand("voice", {
    description:
      "Talk to bruv: /voice turns it on or off here; /voice web gives a link to talk from the browser; /voice tunnel serves it on your domain; /voice speed sets how fast it talks",
    getArgumentCompletions: (prefix) =>
      choices
        .filter(({ value }) => value.startsWith(prefix.trimStart()))
        .map(({ value, description }) => ({ value, label: value, description })),
    handler: command,
  });

  pi.on("session_start", (_event, context) => {
    ctx = context;
    if (pi.getFlag("voice") === true) void command("", context);
  });
  pi.on("before_agent_start", (event, context) => {
    ctx = context;
    if (live) event.systemPromptOptions.sections.voice = `${guidance}\n\n${where(live)}`;
    else delete event.systemPromptOptions.sections.voice;
  });
  pi.on("agent_start", (_event, context) => {
    ctx = context;
    live?.call.thinking();
  });
  // Settled, not agent_end: Pi may still retry a failed request, and the user hears about a failure once.
  let failed: string | undefined;
  // The user spoke and heard nothing back: one more step to answer them, within the same run.
  pi.on("agent_before_settle", (event) => {
    if (!live || !awaiting || event.outcome !== "completed" || event.continue || event.entries.length) return {};
    awaiting = false;
    return {
      entries: [
        {
          type: "custom_message" as const,
          customType: "bruv-voice",
          display: false,
          content: "They heard nothing back. Answer them with say.",
        },
      ],
      continue: true,
    };
  });
  pi.on("agent_settled", () => {
    if (failed) live?.call.fail(failed);
    awaiting = false;
    failed = undefined;
    live?.call.idle();
  });
  // Only `say` is spoken, from its arguments as they stream.
  pi.on("message_update", (event) => {
    const update = event.assistantMessageEvent;
    if (update.type !== "toolcall_start" && update.type !== "toolcall_delta" && update.type !== "toolcall_end") return;
    const block = update.type === "toolcall_end" ? update.toolCall : update.partial.content[update.contentIndex];
    if (block?.type !== "toolCall" || block.name !== "say") return;
    awaiting = false;
    const text = typeof block.arguments?.text === "string" ? block.arguments.text : "";
    const confirm = block.arguments?.confirm === true;
    if (update.type === "toolcall_end") speaker.finish(block.id, text, confirm);
    else speaker.stream(block.id, text, confirm);
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const { content, stopReason } = event.message;
    failed = stopReason === "error" ? (event.message.errorMessage ?? "The model failed.") : undefined;
    // A say cut off with its message stops where it was.
    for (const block of content) if (block.type === "toolCall" && block.name === "say") speaker.finish(block.id, "");
    const written = content.flatMap((block) => (block.type === "text" && block.text.trim() ? [block.text.trim()] : []));
    // Models often write what they just said; the page shows it once.
    const text = written.join("\n\n");
    if (text && live && !isEcho(text, live.call.lately())) live.call.note("text", text);
  });
  pi.on("tool_execution_start", () => {
    tools++;
  });
  pi.on("tool_execution_end", () => {
    tools = Math.max(0, tools - 1);
  });
  pi.on("session_shutdown", async () => {
    await stop();
  });
}
