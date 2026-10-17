import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { readConfig } from "../config";
import { setStatus } from "../status";
import { Call, type Engine } from "./call";
import { startEngine } from "./engine";
import { startLocal } from "./local";
import { download, type ModelPaths, missing, modelPaths } from "./models";
import { type Served, serve } from "./server";

const guidance = readFileSync(new URL("../../prompts/voice.md", import.meta.url), "utf8").trim();

type Options = {
  engine?: (paths: ModelPaths, threads?: number) => Engine;
  open?: (url: string) => void;
  agentDir?: string;
};

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
 * /voice: talk to bruv. A browser page is the microphone and speaker, so bruv can run anywhere the page
 * can reach; /voice here uses this machine's own. Speech is recognised and spoken on this machine; the
 * session's model is the brain.
 */
export function registerVoice(pi: ExtensionAPI, options: Options = {}) {
  let live: { call: Call; served: Served; local?: { stop(): void } } | undefined;
  let starting: Promise<unknown> | undefined;
  let ctx: ExtensionContext | undefined;
  const dir = () => join(options.agentDir ?? getAgentDir(), "bruv", "voice");

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
    try {
      const served = await serve(call, {
        host: config.host ?? "127.0.0.1",
        port: config.port ?? 7807,
        token: token(dir()),
      });
      live = { call, served };
    } catch (error) {
      await call.close();
      throw error;
    }
    setStatus(context, "voice", "● voice");
    return live;
  };

  const stop = async (context?: ExtensionContext) => {
    const current = live;
    live = undefined;
    if (!current) return;
    current.local?.stop();
    await current.served.close();
    await current.call.close();
    if (context) setStatus(context, "voice", undefined);
  };

  const run = async (args: string, context: ExtensionContext) => {
    ctx = context;
    const word = args.trim();
    if (word === "off") {
      await stop(context);
      context.ui.notify("Voice is off.", "info");
      return;
    }
    if (!live) {
      starting ??= start(context).finally(() => {
        starting = undefined;
      });
      await starting;
      if (!live) return;
    }
    if (word === "here") {
      if (live.local) return;
      const local = startLocal(live.call);
      if (typeof local === "string") context.ui.notify(local, "error");
      else live.local = local;
      setStatus(context, "voice", "● voice here");
      return;
    }
    context.ui.notify(`Voice is on: ${live.served.url}`, "info");
    (options.open ?? openBrowser)(live.served.url);
  };

  const command = async (args: string, context: ExtensionContext) => {
    try {
      await run(args, context);
    } catch (error) {
      setStatus(context, "voice", undefined);
      context.ui.notify(`Voice failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  };

  pi.registerFlag("voice", { description: "Start voice and open its page in the browser", type: "boolean" });
  pi.registerCommand("voice", {
    description: "Talk to bruv in the browser; /voice here uses this machine's microphone; /voice off",
    handler: command,
  });

  pi.on("session_start", (_event, context) => {
    ctx = context;
    if (pi.getFlag("voice") === true) void command("", context);
  });
  pi.on("before_agent_start", (event, context) => {
    ctx = context;
    if (live) event.systemPromptOptions.sections.voice = guidance;
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
