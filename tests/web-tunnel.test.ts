import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readConfig, saveConfig } from "../src/config";
import { readKey, saveKey } from "../src/voice/keys";
import type { WebContext } from "../src/web/part";
import { serveWeb } from "../src/web/server";
import { setUpWebTunnel, stopWebTunnel, tunnelPart } from "../src/web/tunnel";

let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) await step();
  cleanup = [];
});

async function until(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const key = "page-key";
/** A tunnel token from the dashboard is run as it is, so no Cloudflare API calls are made. */
const tunnelToken = Buffer.from(JSON.stringify({ a: "account", t: "tunnel", s: "secret" })).toString("base64");

/** A stand-in for cloudflared: connects at once, then runs until stopped (or exits soon after, when told). */
function fakeCloudflared(agentDir: string, exits = false) {
  const bin = join(agentDir, "bruv", "voice", "bin");
  mkdirSync(bin, { recursive: true });
  const tail = exits ? "sleep 0.05\nexit 1\n" : "exec sleep 30\n";
  writeFileSync(join(bin, "cloudflared"), `#!/bin/sh\necho 'Registered tunnel connection' >&2\n${tail}`);
  chmodSync(join(bin, "cloudflared"), 0o755);
}

async function start(
  setup: (agentDir: string) => Promise<void> | void,
  options: Parameters<typeof tunnelPart>[0] = {},
) {
  const agentDir = mkdtempSync(join(tmpdir(), "bruv-tunnel-"));
  await setup(agentDir);
  const server = await serveWeb({
    host: "127.0.0.1",
    port: 0,
    key,
    assets: async () => ({ index: async () => "<!doctype html>", handle: () => false, close: async () => {} }),
    hello: () => ({ type: "busy", busy: false }),
    onPage: () => {},
    image: () => undefined,
  });
  const seen = { address: undefined as string | undefined, notes: [] as { text: string; kind?: string }[] };
  const web: WebContext = {
    http: server.http,
    route: server.route,
    key,
    dir: join(agentDir, "bruv", "web"),
    agentDir,
    address: () => seen.address ?? server.url,
    setAddress: (url) => {
      seen.address = url;
    },
    say: () => {},
    stop: () => {},
    watched: () => false,
    notify: (text, kind) => seen.notes.push({ text, kind }),
    apiKey: async () => undefined,
  };
  const part = tunnelPart(options);
  await part.start(web);
  cleanup.push(
    () => rmSync(agentDir, { recursive: true, force: true }),
    () => part.close(),
    () => server.close(),
  );
  return { agentDir, seen, part, base: `http://127.0.0.1:${server.port}` };
}

test("a saved host and key bring the tunnel up at start, with the phone's QR code", async () => {
  const { seen, base, part } = await start(async (agentDir) => {
    fakeCloudflared(agentDir);
    saveConfig({ web: { tunnel: "bruv.example.com" } }, agentDir);
    await saveKey(tunnelToken, agentDir);
  });
  expect((await fetch(`${base}/qr.svg?t=${key}`)).status).toBe(404);
  await until(() => seen.address !== undefined);
  expect(seen.address).toBe(`https://bruv.example.com/?t=${key}`);
  expect((await fetch(`${base}/qr.svg`)).status).toBe(404);
  const qr = await fetch(`${base}/qr.svg?t=${key}`);
  expect(qr.headers.get("content-type")).toBe("image/svg+xml");
  expect(await qr.text()).toContain("<svg");
  await part.close();
  expect((await fetch(`${base}/qr.svg?t=${key}`)).status).toBe(404);
});

test("nothing starts without a saved host; a host without a key or cloudflared says how to fix it", async () => {
  const none = await start(() => {}, { find: () => undefined });
  expect(none.seen.notes).toEqual([]);

  const noKey = await start((agentDir) => saveConfig({ web: { tunnel: "bruv.example.com" } }, agentDir));
  expect(noKey.seen.notes.map((note) => note.kind)).toEqual(["error"]);

  const noBinary = await start(
    async (agentDir) => {
      saveConfig({ web: { tunnel: "bruv.example.com" } }, agentDir);
      await saveKey(tunnelToken, agentDir);
    },
    { find: () => undefined },
  );
  await until(() => noBinary.seen.notes.length > 0);
  expect(noBinary.seen.notes.map((note) => note.kind)).toEqual(["error"]);
  expect(noBinary.seen.address).toBeUndefined();
});

test("a tunnel that stops clears the address", async () => {
  const { seen } = await start(async (agentDir) => {
    fakeCloudflared(agentDir, true);
    saveConfig({ web: { tunnel: "bruv.example.com" } }, agentDir);
    await saveKey(tunnelToken, agentDir);
  });
  await until(() => seen.address !== undefined);
  await until(() => seen.address === undefined);
  expect(seen.notes.at(-1)?.kind).toBe("error");
});

function context(answers: (string | undefined)[], confirm = false) {
  const notes: { text: string; kind?: string }[] = [];
  const ui = {
    input: async () => answers.shift(),
    confirm: async () => confirm,
    notify: (text: string, kind?: string) => notes.push({ text, kind }),
  };
  return { notes, ctx: { hasUI: true, ui } as unknown as ExtensionContext };
}

test("/web tunnel saves the host and key once the tunnel works; Escape changes nothing", async () => {
  const { agentDir, seen } = await start(fakeCloudflared);
  const cancelHost = context([undefined]);
  await setUpWebTunnel(cancelHost.ctx, agentDir);
  const cancelKey = context(["bruv.example.com", undefined]);
  await setUpWebTunnel(cancelKey.ctx, agentDir);
  expect(readConfig(agentDir).web?.tunnel).toBeUndefined();
  expect(readKey(agentDir)).toBeUndefined();

  const set = context(["https://Bruv.Example.com/", tunnelToken]);
  await setUpWebTunnel(set.ctx, agentDir);
  expect(seen.address).toBe(`https://bruv.example.com/?t=${key}`);
  expect(readConfig(agentDir).web?.tunnel).toBe("bruv.example.com");
  expect(readKey(agentDir)).toBe(tunnelToken);

  const off = context([]);
  stopWebTunnel(off.ctx, agentDir);
  expect(seen.address).toBeUndefined();
  expect(readConfig(agentDir).web?.tunnel).toBeUndefined();
});

test("/web tunnel asks before downloading cloudflared, and a no keeps everything as it was", async () => {
  const { agentDir, seen } = await start(() => {}, { find: () => undefined });
  const no = context(["bruv.example.com", tunnelToken], false);
  await setUpWebTunnel(no.ctx, agentDir);
  expect(no.notes.map((note) => note.kind)).toEqual(["error"]);
  expect(seen.address).toBeUndefined();
  expect(readConfig(agentDir).web?.tunnel).toBeUndefined();
  expect(readKey(agentDir)).toBeUndefined();
});
