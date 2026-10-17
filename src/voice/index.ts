import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readConfig, saveConfig } from "../config";
import { setStatus } from "../status";
import { Call, type Engine } from "./call";
import { downloadCloudflared, findCloudflared, runTunnel } from "./cloudflared";
import { startEngine } from "./engine";
import { readKey, saveKey } from "./keys";
import { startLocal } from "./local";
import { download, type ModelPaths, missing, modelPaths } from "./models";
import { type Served, serve } from "./server";
import { showInTerminal } from "./terminal";
import { registerShow, showTool } from "./tool";
import { cleanHost, permissions, prepare } from "./tunnel";

const guidance = readFileSync(new URL("../../prompts/voice.md", import.meta.url), "utf8").trim();

type Options = {
  engine?: (paths: ModelPaths, threads?: number) => Engine;
  /** This machine's microphone and speaker, or why they can't be used. */
  local?: (call: Call) => { stop(): void } | string;
  open?: (url: string) => void;
  agentDir?: string;
  /** For Cloudflare's API. */
  fetch?: typeof fetch;
};

/**
 * Where voice is right now, for the model. It changes only when the user turns parts on or off, so the
 * prompt stays cached in between.
 */
function where(voice: { local?: unknown; served?: unknown; tunnel?: { url: string } }) {
  const lines = [
    voice.local
      ? "Right now the user talks through this machine's microphone and hears its speaker, at the terminal."
      : "Right now the user talks through the voice page, not at this machine's terminal.",
  ];
  if (voice.local && voice.served)
    lines.push("The voice page is on too, so they may be on a phone or another computer.");
  if (voice.tunnel) lines.push(`The voice page can be reached from anywhere at ${new URL(voice.tunnel.url).host}.`);
  return lines.join(" ");
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Opens a URL in the desktop browser, when there is a desktop. */
function openBrowser(url: string) {
  if (process.platform !== "darwin" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return;
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [url], { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
}

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
        /** The page server, started by /voice web or /voice tunnel. */
        served?: Served;
        local?: { stop(): void };
        tunnel?: { stop(): void; url: string };
      }
    | undefined;
  let starting: Promise<unknown> | undefined;
  let ctx: ExtensionContext | undefined;
  const agentDir = () => options.agentDir ?? getAgentDir();
  const dir = () => join(agentDir(), "bruv", "voice");
  const status = (context: ExtensionContext) =>
    setStatus(context, "voice", `● voice${live?.served ? " · web" : ""}${live?.tunnel ? " · tunnel" : ""}`);

  /**
   * Talking over a reply stops the run, as it would stop a person; it was most likely still writing.
   * Talking while the agent works without speaking steers the work instead of stopping it.
   */
  const tell = async (text: string, interrupted: boolean) => {
    if (ctx && !ctx.isIdle() && interrupted) {
      ctx.abort();
      // Pi is not idle yet when agent_end comes, and a message queued then is lost.
      for (let waited = 0; !ctx.isIdle() && waited < 5000; waited += 20) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    if (ctx?.isIdle() ?? true) pi.sendUserMessage(text);
    else pi.sendUserMessage(text, { deliverAs: "steer" });
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
      if (!ok) return;
      await download(models, (text) => setStatus(context, "voice", text));
    }
    const engine = (options.engine ?? startEngine)(modelPaths(models, config.voice), config.threads);
    const call = new Call(engine, {
      tell: (text, interrupted) => void tell(text, interrupted),
    });
    live = { call };
    showTool(pi, true);
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

  /** Starts the page server, and the tunnel if one was set up before. */
  const web = async (context: ExtensionContext) => {
    if (!live || live.served) return live?.served;
    const current = live;
    const config = readConfig(options.agentDir).voice ?? {};
    const served = await serve(current.call, {
      host: config.host ?? "127.0.0.1",
      port: config.port ?? 7807,
      token: token(dir()),
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
    if (host && key)
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
        status(context);
        context.ui.notify(`Voice tunnel stopped: ${message}`, "error");
      });
      tunnel.stop = running.stop;
      current.tunnel?.stop();
      if (live === current) current.tunnel = tunnel;
      else running.stop();
    } finally {
      if (live) status(context);
    }
  };

  const stop = async (context?: ExtensionContext) => {
    const current = live;
    live = undefined;
    if (!current) return;
    showTool(pi, false);
    current.local?.stop();
    current.tunnel?.stop();
    await current.served?.close();
    await current.call.close();
    if (context) setStatus(context, "voice", undefined);
    if (context?.mode === "tui") showInTerminal(context.ui, undefined);
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
    if (word === "tunnel off") {
      live?.tunnel?.stop();
      if (live) live.tunnel = undefined;
      const { tunnel: _, ...rest } = readConfig(options.agentDir).voice ?? {};
      saveConfig({ voice: rest }, options.agentDir);
      if (live) status(context);
      context.ui.notify("Voice tunnel is off. /logout can remove the saved Cloudflare key.", "info");
      return;
    }
    if (word === "") {
      // /voice turns voice in the terminal on, and off again.
      if (live) {
        await stop(context);
        context.ui.notify("Voice is off.", "info");
        return;
      }
      const current = await ensure(context);
      if (!current) return;
      const local = (options.local ?? startLocal)(current.call);
      if (typeof local === "string") {
        await stop(context);
        throw new Error(`${local} Or use /voice web to talk from the browser.`);
      }
      current.local = local;
      context.ui.notify("Voice is on. Just talk; /voice again turns it off.", "info");
      return;
    }
    if (word !== "web" && word !== "tunnel") {
      context.ui.notify("Use /voice, /voice web, /voice tunnel, /voice tunnel off or /voice off.", "error");
      return;
    }
    const served = (await ensure(context)) && (await web(context));
    if (!served) return;
    if (word === "tunnel") {
      await setUpTunnel(context);
      return;
    }
    const remote = live?.tunnel ? `\nFrom anywhere: ${live.tunnel.url}` : "";
    context.ui.notify(`Voice is on: ${served.url}${remote}`, "info");
    (options.open ?? openBrowser)(served.url);
  };

  /** /voice tunnel: asks for the host and the Cloudflare key, sets the tunnel up, and keeps both. */
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
    const typedKey = (
      await context.ui.input(
        saved ? "Cloudflare token" : "Cloudflare API token or tunnel token",
        saved ? "Leave empty to keep the saved one" : `API token with ${permissions}`,
      )
    )?.trim();
    const key = typedKey || saved;
    if (!key) return;
    await openTunnel(context, host, key);
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
      "Talk to bruv: /voice turns it on or off here; /voice web opens it in the browser; /voice tunnel serves it on your domain",
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
  pi.on("agent_end", () => live?.call.idle());
  pi.on("message_start", (event) => {
    if (event.message.role === "assistant") live?.call.replyStart();
  });
  pi.on("message_update", (event) => {
    const update = event.assistantMessageEvent;
    if (update.type === "text_delta") live?.call.reply(update.delta);
  });
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant") live?.call.replyEnd();
  });
  pi.on("session_shutdown", async () => {
    await stop();
  });
}
