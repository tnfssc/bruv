import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileLink, fileRoute, prepareShow, readLink } from "../src/web/files";
import { shownLine } from "../src/web/lines";
import type { Thread } from "../src/web/protocol";
import type { T3Asset, T3Link } from "../src/web/t3";
import { T3RpcError } from "../src/web/t3";

const secret = "page-key";
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const each of cleanup.splice(0)) each();
});

function folder() {
  const dir = mkdtempSync(join(tmpdir(), "bruv-files-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Serves `route` the way the web server does, on a port of its own. */
async function serve(route: ReturnType<typeof fileRoute>) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://x").pathname;
    if (!(await route(request, response, path))) response.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  cleanup.push(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const thread: Thread = {
  id: "t1",
  projectId: "p1",
  title: "Build the report",
  status: "completed",
  needsUser: false,
  pinned: false,
  away: false,
  worktree: "/remote/work/t1",
  createdAt: "2026-10-29T00:00:00.000Z",
  updatedAt: "2026-10-29T00:00:00.000Z",
};

/**
 * T3 on "another machine": its files exist only behind the links it makes, served by a server of its own,
 * like T3's /api/assets. Links run out when `expire` is called.
 */
async function fakeT3(files: Record<string, { type: string; body: string }>) {
  const made: T3Asset[] = [];
  let generation = 0;
  let server: Server | undefined;
  server = createServer((request, response) => {
    const match = /^\/api\/assets\/g(\d+)-([^/]*)\/(.+)$/.exec(new URL(request.url ?? "/", "http://x").pathname);
    if (!match || Number(match[1]) !== generation) return response.writeHead(403).end();
    const base = decodeURIComponent(match[2] as string);
    const file = files[base ? `${base}/${match[3]}` : (match[3] as string)];
    if (!file) return response.writeHead(404).end();
    // A transfer that breaks halfway.
    if (file.body === "BREAK") {
      response.writeHead(200, { "content-type": file.type, "content-length": "1000" });
      response.write("partial");
      return setTimeout(() => response.socket?.destroy(), 10);
    }
    const range = /^bytes=(\d+)-(\d+)$/.exec(String(request.headers.range ?? ""));
    if (range) {
      const part = file.body.slice(Number(range[1]), Number(range[2]) + 1);
      response.writeHead(206, {
        "content-type": file.type,
        "content-range": `bytes ${range[1]}-${range[2]}/${file.body.length}`,
        "accept-ranges": "bytes",
      });
      return response.end(part);
    }
    response.writeHead(200, { "content-type": file.type, etag: '"e1"' });
    response.end(file.body);
  });
  await new Promise<void>((done) => server?.listen(0, "127.0.0.1", done));
  cleanup.push(() => server?.close());
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const link = {
    threads: () => [thread],
    thread: (id: string) => (id === thread.id ? thread : undefined),
    projects: () => [{ id: "p1", title: "bruv", root: "/remote/bruv" }],
    async asset(resource: T3Asset) {
      made.push(resource);
      if (resource._tag === "attachment") {
        if (!files[resource.attachmentId])
          throw new T3RpcError([{ error: { _tag: "AssetWorkspaceAssetNotFoundError" } }]);
        return {
          url: `${origin}/api/assets/g${generation}-/${resource.attachmentId}`,
          expiresAt: Date.now() + 3600_000,
        };
      }
      if (!files[resource.path]) throw new T3RpcError([{ error: { _tag: "AssetWorkspaceAssetNotFoundError" } }]);
      const slash = resource.path.lastIndexOf("/");
      const base = slash < 0 ? "" : resource.path.slice(0, slash);
      return {
        url: `${origin}/api/assets/g${generation}-${encodeURIComponent(base)}/${resource.path.slice(slash + 1)}`,
        expiresAt: Date.now() + 3600_000,
      };
    },
    async readFile(where: string, path: string) {
      const file = files[path];
      if (where !== thread.worktree || !file) throw new T3RpcError([{ error: { _tag: "ProjectReadFileError" } }]);
      return { contents: file.body, truncated: false };
    },
  } as unknown as T3Link;
  return { link, made, expire: () => generation++ };
}

test("a file link works only with the signature the page's key made", () => {
  const link = fileLink(secret, { from: "own", path: "out/report.html" }, "report.html");
  const id = link.split("/")[2] as string;
  expect(readLink(secret, id)).toEqual({ from: "own", path: "out/report.html" });
  expect(readLink("another key", id)).toBeUndefined();
  const [data, signature] = id.split(".");
  const forged = Buffer.from(JSON.stringify({ from: "own", path: "../secrets" })).toString("base64url");
  expect(readLink(secret, `${forged}.${signature}`)).toBeUndefined();
  expect(readLink(secret, `${data}.`)).toBeUndefined();
});

test("only files in the workspace can be shown from this machine, each as what it is", async () => {
  const workspace = folder();
  const outside = folder();
  mkdirSync(join(workspace, "out"));
  writeFileSync(join(workspace, "out", "chart.png"), "png");
  writeFileSync(join(workspace, "out", "notes.md"), "# notes");
  writeFileSync(join(workspace, "out", "blob.bin"), Buffer.from([1, 0, 2]));
  writeFileSync(join(outside, "secret.txt"), "no");
  symlinkSync(join(outside, "secret.txt"), join(workspace, "out", "link.txt"));
  const show = (path: string) => prepareShow({ secret, workspace, path });

  expect(await show("out/chart.png")).toMatchObject({ kind: "image", name: "chart.png" });
  expect(await show(join(workspace, "out", "notes.md"))).toMatchObject({ kind: "text", name: "notes.md" });
  for (const path of ["../secret.txt", join(outside, "secret.txt"), "out/link.txt", "out/blob.bin", "out", "nope.png"])
    await expect(show(path)).rejects.toThrow();
});

test("the page gets a shown file from this machine, and a page the files beside it", async () => {
  const workspace = folder();
  mkdirSync(join(workspace, "out"));
  writeFileSync(join(workspace, "out", "page.html"), '<img src="chart.png">');
  writeFileSync(join(workspace, "out", "chart.png"), "png-bytes");
  writeFileSync(join(workspace, "out", "clip.mp4"), "0123456789");
  writeFileSync(join(workspace, "secret.txt"), "no");
  const origin = await serve(fileRoute({ secret: () => secret, workspace: () => workspace, t3: () => undefined }));
  const shown = async (path: string) => (await prepareShow({ secret, workspace, path })).url;

  const pageUrl = await shown("out/page.html");
  const page = await fetch(origin + pageUrl);
  expect(page.status).toBe(200);
  // Scripts in it run in an origin of their own.
  expect(page.headers.get("content-security-policy")).toContain("sandbox");
  expect((await fetch(origin + pageUrl.replace(/page\.html$/, "chart.png"))).status).toBe(200);
  expect((await fetch(origin + pageUrl.replace(/page\.html$/, "..%2Fsecret.txt"))).status).toBe(404);

  // A picture's link reaches only the picture.
  const picture = await shown("out/chart.png");
  expect(await (await fetch(origin + picture)).text()).toBe("png-bytes");
  expect((await fetch(origin + picture.replace(/chart\.png$/, "page.html"))).status).toBe(404);

  // Video seeks, and an unchanged file isn't sent again.
  const clip = origin + (await shown("out/clip.mp4"));
  const part = await fetch(clip, { headers: { range: "bytes=2-4" } });
  expect(part.status).toBe(206);
  expect(await part.text()).toBe("234");
  const etag = (await fetch(clip)).headers.get("etag") ?? "";
  expect((await fetch(clip, { headers: { "if-none-match": etag } })).status).toBe(304);
});

test("a thread's files come through T3's links, never from this machine's disk", async () => {
  const t3 = await fakeT3({
    "site/index.html": { type: "text/html; charset=utf-8", body: '<link href="style.css">' },
    "site/style.css": { type: "text/css", body: "body{}" },
    "demo.mp4": { type: "video/mp4", body: "0123456789" },
    "src/report.md": { type: "text/plain", body: "# Report" },
  });
  const workspace = folder();
  const origin = await serve(fileRoute({ secret: () => secret, workspace: () => workspace, t3: () => t3.link }));
  const show = (path: string) => prepareShow({ secret, workspace, t3: t3.link, thread: "t1", path });

  // A path inside the thread's folder is taken as T3 wants it, relative.
  const page = await show("/remote/work/t1/site/index.html");
  expect(page).toMatchObject({ kind: "html", name: "index.html" });
  const answer = await fetch(origin + page.url);
  expect(await answer.text()).toBe('<link href="style.css">');
  expect(answer.headers.get("content-security-policy")).toContain("sandbox");
  expect(await (await fetch(origin + page.url.replace(/index\.html$/, "style.css"))).text()).toBe("body{}");

  // Video needs T3's media links, and seeks through them.
  const video = await show("demo.mp4");
  const part = await fetch(origin + video.url, { headers: { range: "bytes=0-3" } });
  expect(part.status).toBe(206);
  expect(await part.text()).toBe("0123");
  expect(t3.made.some((asset) => asset._tag === "media-file" && asset.path === "demo.mp4")).toBe(true);

  // Text is read through T3.
  const report = await show("src/report.md");
  expect(report.kind).toBe("text");
  expect(await (await fetch(origin + report.url)).text()).toBe("# Report");

  for (const path of ["../other/secret.png", "/etc/passwd", "missing.png"]) await expect(show(path)).rejects.toThrow();
  await expect(prepareShow({ secret, workspace, t3: t3.link, thread: "nope", path: "demo.mp4" })).rejects.toThrow();
});

test("a link from T3 is made once while it lasts, and again when T3 stops taking it", async () => {
  const t3 = await fakeT3({ "shot.png": { type: "image/png", body: "png" } });
  const workspace = folder();
  const origin = await serve(fileRoute({ secret: () => secret, workspace: () => workspace, t3: () => t3.link }));
  const { url } = await prepareShow({ secret, workspace, t3: t3.link, thread: "t1", path: "shot.png" });
  const before = t3.made.length;
  for (let i = 0; i < 3; i++) expect((await fetch(origin + url)).status).toBe(200);
  expect(t3.made.length).toBe(before + 1);
  t3.expire();
  expect(await (await fetch(origin + url)).text()).toBe("png");
  expect(t3.made.length).toBe(before + 2);
});

test("a page a thread showed in T3 can be shown here", async () => {
  const t3 = await fakeT3({ "att-1-html": { type: "text/html; charset=utf-8", body: "<h1>Chart</h1>" } });
  const workspace = folder();
  const origin = await serve(fileRoute({ secret: () => secret, workspace: () => workspace, t3: () => t3.link }));
  const shown = await prepareShow({ secret, workspace, t3: t3.link, render: "att-1-html", title: "Speed" });
  expect(shown).toMatchObject({ kind: "html", title: "Speed" });
  expect(await (await fetch(origin + shown.url)).text()).toBe("<h1>Chart</h1>");
  await expect(prepareShow({ secret, workspace, t3: t3.link, render: "missing" })).rejects.toThrow();
});

test("a saved shown file becomes a line of its own, and only a link of bruv's own does", () => {
  const shown = { url: "/file/abc.def/chart.png", kind: "image" as const, name: "chart.png" };
  expect(shownLine(shown, "l1", 0)).toMatchObject({ role: "assistant", files: [shown] });
  expect(shownLine({ ...shown, url: "https://elsewhere/x.png" }, "l2", 0)).toBeUndefined();
  expect(shownLine(undefined, "l3", 0)).toBeUndefined();
});

test("a file whose transfer from T3 breaks halfway fails on its own", async () => {
  const t3 = await fakeT3({
    "broken.mp4": { type: "video/mp4", body: "BREAK" },
    "ok.png": { type: "image/png", body: "png" },
  });
  const workspace = folder();
  const origin = await serve(fileRoute({ secret: () => secret, workspace: () => workspace, t3: () => t3.link }));
  const broken = await prepareShow({ secret, workspace, t3: t3.link, thread: "t1", path: "broken.mp4" });
  await fetch(origin + broken.url)
    .then((answer) => answer.text())
    .catch(() => "");
  // The server is still there for the next file.
  const ok = await prepareShow({ secret, workspace, t3: t3.link, thread: "t1", path: "ok.png" });
  expect(await (await fetch(origin + ok.url)).text()).toBe("png");
});
