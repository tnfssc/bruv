import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import WebSocket from "ws";
import { hmrPath, type PageAssets, pageAssets, webDir } from "../src/web/assets";

let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) await step();
  cleanup = [];
});

function files(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true }))
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      out.set(relative(dir, path), readFileSync(path));
    }
  return out;
}

async function serve(dev: boolean): Promise<{ base: string; server: Server; assets: PageAssets }> {
  let assets: PageAssets | undefined;
  const server = createServer(async (request, response) => {
    if (new URL(request.url ?? "/", "http://x").pathname === "/") {
      response.end(await assets?.index(request.url ?? "/"));
      return;
    }
    if (assets && (await assets.handle(request, response))) return;
    response.writeHead(404).end();
  });
  assets = await pageAssets({ dev, server });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () => assets?.close(),
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server, assets };
}

// The built page is committed, so a change to web/ without `bun run build:web` must fail here. Built with
// Node, as `build:web` does: Vite's output differs by a few bytes under Bun's runtime.
test("web/dist matches a fresh build of web/", () => {
  const out = mkdtempSync(join(tmpdir(), "bruv-web-"));
  cleanup.push(() => rmSync(out, { recursive: true, force: true }));
  const build = Bun.spawnSync(
    [
      "node",
      join(webDir, "node_modules/vite/bin/vite.js"),
      "build",
      "--outDir",
      out,
      "--emptyOutDir",
      "--logLevel",
      "error",
    ],
    // Bun's test runner sets NODE_ENV=test, which would make Vite build React's development files.
    { cwd: webDir, stderr: "pipe", env: { ...process.env, NODE_ENV: "production" } },
  );
  expect(build.stderr.toString()).toBe("");
  expect(build.exitCode).toBe(0);
  const fresh = files(out);
  const committed = files(join(webDir, "dist"));
  expect([...committed.keys()].sort()).toEqual([...fresh.keys()].sort());
  for (const [path, body] of fresh) expect(committed.get(path)?.equals(body), path).toBe(true);
}, 60_000);

test("built page: hashed files cached for good, unknown paths left to the caller", async () => {
  const { base } = await serve(false);
  const html = await (await fetch(`${base}/`)).text();
  const script = html.match(/src="\.?(\/assets\/[^"]+\.js)"/)?.[1];
  const style = html.match(/href="\.?(\/assets\/[^"]+\.css)"/)?.[1];
  expect(script).toBeDefined();
  expect(style).toBeDefined();

  const js = await fetch(`${base}${script}`);
  expect(js.status).toBe(200);
  expect(js.headers.get("content-type")).toStartWith("text/javascript");
  expect(js.headers.get("cache-control")).toContain("immutable");
  expect((await fetch(`${base}${style}`)).headers.get("content-type")).toStartWith("text/css");

  const head = await fetch(`${base}${script}`, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect((await head.arrayBuffer()).byteLength).toBe(0);

  expect((await fetch(`${base}/assets/nope.js`)).status).toBe(404);
  expect((await fetch(`${base}/assets/../../package.json`)).status).toBe(404);
  expect((await fetch(`${base}${script}`, { method: "POST" })).status).toBe(404);
});

test("dev page: Vite serves the source and its hot reload socket works beside other sockets", async () => {
  const { base, server } = await serve(true);
  // Another socket on the same server, as bruv's /socket is: Vite must leave it alone.
  const { WebSocketServer } = await import("ws");
  const other = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url ?? "/", "http://x").pathname === "/socket")
      other.handleUpgrade(request, socket, head, (ws) => ws.send("hi"));
  });
  cleanup.push(() => other.close());

  const html = await (await fetch(`${base}/`)).text();
  expect(html).toContain("/@vite/client");
  const main = await fetch(`${base}/src/main.tsx`);
  expect(main.status).toBe(200);
  expect(main.headers.get("content-type")).toContain("javascript");
  expect((await fetch(`${base}/not-a-page-file`)).status).toBe(404);

  // The client gets its socket token from /@vite/client.
  const client = await (await fetch(`${base}/@vite/client`)).text();
  const token = client.match(/const wsToken = "([^"]+)"/)?.[1] ?? "";
  const ws = (path: string, protocol?: string) =>
    new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`${base.replace("http", "ws")}${path}`, protocol);
      socket.once("open", () => resolve(socket));
      socket.once("error", reject);
    });
  const hmr = await ws(`${hmrPath}?token=${token}`, "vite-hmr");
  const mine = await ws("/socket");
  cleanup.push(
    () => hmr.close(),
    () => mine.close(),
  );
  expect(hmr.readyState).toBe(WebSocket.OPEN);
  expect(mine.readyState).toBe(WebSocket.OPEN);
}, 30_000);
