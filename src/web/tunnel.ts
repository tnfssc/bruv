import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readConfig, saveConfig } from "../config";
import { downloadCloudflared, findCloudflared, runTunnel } from "../voice/cloudflared";
import { readKey, saveKey } from "../voice/keys";
import { qrSvg } from "../voice/qr";
import { cleanHost, permissions, prepare } from "../voice/tunnel";
import type { WebContext, WebPart } from "./part";
import { allowed } from "./server";

type Options = {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** For tests: where cloudflared is, instead of looking on this machine. */
  find?: (dir: string) => string | undefined;
};

type State = {
  web: WebContext;
  options: Options;
  tunnel?: { url: string; stop(): void };
  /** Counts tries, so an older try that connects late doesn't replace a newer one. */
  tries: number;
  qr?: { url: string; svg: string };
  remove(): void;
};

/** The web version's tunnel part while it runs, for `/web tunnel`. */
let running: State | undefined;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** cloudflared is shared with voice's tunnel, so one download serves both. */
const binDir = (agentDir: string) => join(agentDir, "bruv", "voice", "bin");

/**
 * Serves the page on https://host through a Cloudflare tunnel, and makes that the web version's address.
 * `ask` is asked before downloading cloudflared; without it (at start, or headless) a missing cloudflared
 * is an error that says how to get it.
 */
async function open(state: State, host: string, key: string, ask?: () => Promise<boolean>) {
  const { web, options } = state;
  const attempt = ++state.tries;
  const bin = binDir(web.agentDir);
  let binary = (options.find ?? findCloudflared)(bin);
  if (!binary) {
    if (!(await ask?.()))
      throw new Error("The tunnel needs cloudflared: install it, or run /web tunnel in a terminal to download it.");
    binary = await downloadCloudflared(bin);
  }
  const listen = readConfig(web.agentDir).web?.host ?? "127.0.0.1";
  const local = listen === "0.0.0.0" || listen === "::" ? "127.0.0.1" : listen;
  const origin = `http://${local.includes(":") ? `[${local}]` : local}:${(web.http.address() as AddressInfo).port}`;
  const tunnel = { url: `https://${host}/?t=${encodeURIComponent(web.key)}`, stop: () => {} };
  const token = await prepare(key, host, origin, options.fetch);
  const run = await runTunnel(binary, token, (why) => {
    if (state.tunnel !== tunnel) return;
    state.tunnel = undefined;
    web.setAddress(undefined);
    web.notify(`The web tunnel stopped: ${why}`, "error");
  });
  tunnel.stop = run.stop;
  if (running !== state || attempt !== state.tries) {
    run.stop();
    return undefined;
  }
  state.tunnel?.stop();
  state.tunnel = tunnel;
  web.setAddress(tunnel.url);
  return tunnel.url;
}

/**
 * The tunnel to the user's own domain, so a phone can reach the page (and install it, and get pushes,
 * which need https on a host that stays the same). It starts with the web version when `web.tunnel` and a
 * Cloudflare key are saved, and serves the phone's QR code at `/qr.svg?t=<key>` while it is up.
 */
export function tunnelPart(options: Options = {}): WebPart {
  let state: State | undefined;
  return {
    name: "tunnel",
    start(web) {
      const current: State = { web, options, tries: 0, remove: () => {} };
      state = current;
      running = current;
      current.remove = web.route((request, response, path) => {
        if (path !== "/qr.svg") return false;
        const url = current.tunnel?.url;
        if (!url || !allowed(request, web.key)) {
          response.writeHead(404, { "cache-control": "no-store" }).end();
          return true;
        }
        if (current.qr?.url !== url) current.qr = { url, svg: qrSvg(url) };
        response.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store" });
        response.end(current.qr.svg);
        return true;
      });
      const host = readConfig(web.agentDir).web?.tunnel;
      if (!host) return;
      const key = readKey(web.agentDir);
      if (!key) {
        web.notify(`The web tunnel to ${host} needs a Cloudflare key: run /web tunnel.`, "error");
        return;
      }
      // The tunnel takes a few seconds; the page works locally meanwhile.
      void open(current, host, key).then(
        (url) => url && web.notify(`The web version from anywhere: ${url}`, "info"),
        (error) => web.notify(`The web tunnel failed: ${message(error)}`, "error"),
      );
    },
    close() {
      if (!state) return;
      state.remove();
      state.tunnel?.stop();
      state.tunnel = undefined;
      if (running === state) running = undefined;
      state = undefined;
    },
  };
}

/**
 * `/web tunnel`: asks for the host and the Cloudflare key, starts the tunnel, and saves both once it works.
 * Escape changes nothing; an empty key keeps the saved one. Needs the web version on (`pi --web`).
 */
export async function setUpWebTunnel(context: ExtensionContext, agentDir = running?.web.agentDir) {
  const state = running;
  if (!state || !agentDir) {
    context.ui.notify("The web version is off. Start Pi with --web first.", "error");
    return;
  }
  const config = readConfig(agentDir).web ?? {};
  const typedHost = await context.ui.input("Host name for the web version", config.tunnel ?? "bruv.example.com");
  if (typedHost === undefined) return;
  const host = cleanHost(typedHost || config.tunnel || "");
  if (!host) {
    context.ui.notify("That isn't a host name. Use one like bruv.example.com.", "error");
    return;
  }
  const saved = readKey(agentDir);
  const answer = await context.ui.input(
    saved ? "Cloudflare token" : "Cloudflare API token or tunnel token",
    saved ? "Leave empty to keep the saved one" : `API token with ${permissions}`,
  );
  if (answer === undefined) return;
  const typedKey = answer.trim();
  const key = typedKey || saved;
  if (!key) {
    context.ui.notify("The tunnel needs a Cloudflare token.", "error");
    return;
  }
  const ask = async () =>
    context.hasUI &&
    (await context.ui.confirm(
      "Download cloudflared?",
      `The tunnel runs Cloudflare's cloudflared program, which isn't installed. Download it (about 40 MB) from github.com/cloudflare/cloudflared into ${binDir(agentDir)}?`,
    ));
  let url: string | undefined;
  try {
    url = await open(state, host, key, ask);
  } catch (error) {
    context.ui.notify(`The web tunnel failed: ${message(error)}`, "error");
    return;
  }
  if (!url) return;
  if (typedKey) await saveKey(typedKey, agentDir);
  saveConfig({ web: { ...readConfig(agentDir).web, tunnel: host } }, agentDir);
  context.ui.notify(`The web version from anywhere: ${url}`, "info");
}

/** `/web tunnel off`: stops the tunnel and forgets its host. The Cloudflare key stays for /logout. */
export function stopWebTunnel(context: ExtensionContext, agentDir = running?.web.agentDir) {
  const state = running;
  // Also for a tunnel still connecting: it comes up to find it is no longer wanted and stops.
  if (state) state.tries++;
  if (state?.tunnel) {
    state.tunnel.stop();
    state.tunnel = undefined;
    state.web.setAddress(undefined);
  }
  if (agentDir && readConfig(agentDir).web?.tunnel) {
    const { tunnel: _host, ...rest } = readConfig(agentDir).web ?? {};
    saveConfig({ web: rest }, agentDir);
  }
  context.ui.notify("The web tunnel is off.", "info");
}
