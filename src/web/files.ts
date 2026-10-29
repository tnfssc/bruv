import { createHmac, timingSafeEqual } from "node:crypto";
import { closeSync, createReadStream, openSync, readSync, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, isAbsolute, join, posix, relative, sep } from "node:path";
import { Readable } from "node:stream";
import type { Shown, ShownKind, Thread } from "./protocol";
import type { T3Asset, T3Link } from "./t3";

/**
 * Files the assistant shows the user: pictures, videos, sound, HTML pages, PDFs and text, from its own
 * workspace or from a T3 thread's folder. T3 may run on another machine, so a thread's files are never read
 * from disk: T3 makes a signed link for each and bruv passes the bytes on, since the page (on a phone, over
 * the tunnel) may not reach T3 itself.
 *
 * A file's link is `/file/<ref>.<signature>/<name>`: the ref says where the file is, the signature (made with
 * the page's key) that the assistant chose to show it. So the link needs no key, which matters because an
 * HTML page can read its own address, and only files that were shown can be fetched. A page's link also
 * reaches the files beside it (`/file/<ref>.<sig>/style.css`), as a page in a browser expects.
 */
export type FileRef =
  /** In the assistant's workspace, relative to it. */
  | { from: "own"; path: string }
  /** In a T3 thread's folder, relative to it; `folder` is that folder on T3's machine, for reading text. */
  | { from: "t3"; thread: string; path: string; folder: string }
  /** A page a T3 thread showed with `html_render`. */
  | { from: "render"; attachment: string };

const kinds: Record<string, ShownKind> = {};
for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg"]) kinds[ext] = "image";
for (const ext of ["mp4", "webm", "mov", "m4v", "ogv"]) kinds[ext] = "video";
for (const ext of ["mp3", "wav", "ogg", "oga", "m4a", "flac", "opus", "aac"]) kinds[ext] = "audio";
for (const ext of ["html", "htm"]) kinds[ext] = "html";
kinds.pdf = "pdf";

const types: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/mp4",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  opus: "audio/ogg",
  aac: "audio/aac",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  pdf: "application/pdf",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json",
  woff2: "font/woff2",
  woff: "font/woff",
  txt: "text/plain; charset=utf-8",
};

const ext = (path: string) => extname(path).slice(1).toLowerCase();
/** What a file is shown as, by its name. Anything not known is shown as text, if it is text. */
export const kindOf = (path: string): ShownKind => kinds[ext(path)] ?? "text";

/**
 * The same sandbox T3 gives a page: scripts run, but in an origin of their own, so a page can't reach the
 * page that shows it, its key or its cookies.
 */
const sandbox = "sandbox allow-scripts allow-forms allow-popups allow-downloads";
/** The most of a text file the page gets; more is cut, and the page says so. */
const textLimit = 256 * 1024;

const sign = (secret: string, data: string) =>
  createHmac("sha256", secret).update(data).digest("base64url").slice(0, 32);

/** The link for a file the assistant shows. */
export function fileLink(secret: string, ref: FileRef, name: string) {
  const data = Buffer.from(JSON.stringify(ref)).toString("base64url");
  return `/file/${data}.${sign(secret, data)}/${encodeURIComponent(name)}`;
}

/** The ref in a link, if its signature is good. */
export function readLink(secret: string, id: string): FileRef | undefined {
  const [data, signature] = id.split(".");
  if (!data || !signature) return undefined;
  const good = Buffer.from(sign(secret, data));
  const given = Buffer.from(signature);
  if (good.length !== given.length || !timingSafeEqual(good, given)) return undefined;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as FileRef;
  } catch {
    return undefined;
  }
}

/** A path inside `root`, or nothing when it would leave it (through `..`, an absolute path or a link). */
export function inside(root: string, path: string) {
  try {
    const base = realpathSync(root);
    const full = realpathSync(isAbsolute(path) ? path : join(base, path));
    const rel = relative(base, full);
    return rel && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel) ? { full, rel } : undefined;
  } catch {
    return undefined;
  }
}

/** A clean relative path: no `..`, no leading slash, `/` between parts. Undefined when it would climb out. */
export function cleanRelative(path: string) {
  const normal = posix.normalize(path.replaceAll("\\", "/"));
  if (!normal || normal === "." || normal.startsWith("../") || normal === ".." || normal.startsWith("/"))
    return undefined;
  return normal;
}

const looksBinary = (file: string) => {
  const buffer = Buffer.alloc(8192);
  const fd = openSync(file, "r");
  try {
    return buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 0)).includes(0);
  } finally {
    closeSync(fd);
  }
};

/**
 * Checks a file the assistant wants to show and says how. Throws with a reason the model can act on.
 * `workspace` is the assistant's folder; `thread` (with T3) means the path is in that thread's folder.
 */
export async function prepareShow(options: {
  secret: string;
  workspace: string;
  t3?: T3Link;
  path?: string;
  thread?: string;
  render?: string;
  title?: string;
}): Promise<Shown> {
  const { secret, t3, title } = options;
  const extra = title ? { title } : {};
  if (options.render) {
    if (!t3) throw new Error("T3 isn't connected.");
    const ref: FileRef = { from: "render", attachment: options.render };
    await t3.asset(assetFor(ref));
    return { url: fileLink(secret, ref, "page.html"), kind: "html", name: title ?? "page", ...extra };
  }
  const path = options.path?.trim();
  if (!path) throw new Error("Say which file: path (and thread, for a file in a T3 thread's folder).");
  if (options.thread) {
    if (!t3) throw new Error("T3 isn't connected.");
    const thread = t3.threads().find((each) => each.id === options.thread);
    if (!thread) throw new Error("No such thread in T3.");
    const folder = folderOf(thread, t3);
    if (!folder) throw new Error("T3 doesn't say which folder that thread works in.");
    // An absolute path inside the thread's folder is fine; T3 wants it relative.
    const given = path.replaceAll("\\", "/");
    const within = given.startsWith(`${folder}/`) ? given.slice(folder.length + 1) : given;
    const rel = cleanRelative(within);
    if (!rel) throw new Error(`The file must be inside the thread's folder (${folder}).`);
    const ref: FileRef = { from: "t3", thread: thread.id, path: rel, folder };
    const kind = kindOf(rel);
    if (kind === "text") {
      try {
        await t3.readFile(folder, rel);
      } catch (error) {
        throw new Error(`T3 won't show that file: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else await t3.asset(assetFor(ref));
    return { url: fileLink(secret, ref, posix.basename(rel)), kind, name: posix.basename(rel), ...extra };
  }
  const found = inside(options.workspace, path);
  if (!found)
    throw new Error(`Only files in your working folder (${options.workspace}) or a T3 thread's folder can be shown.`);
  const stat = statSync(found.full);
  if (!stat.isFile()) throw new Error("That isn't a file.");
  const kind = kindOf(found.rel);
  if (kind === "text" && looksBinary(found.full))
    throw new Error("That file isn't text, a picture, a video, sound, HTML or a PDF.");
  const rel = found.rel.split(sep).join("/");
  return { url: fileLink(secret, { from: "own", path: rel }, basename(rel)), kind, name: basename(rel), ...extra };
}

const folderOf = (thread: Thread, t3: T3Link) =>
  thread.worktree ?? t3.projects().find((project) => project.id === thread.projectId)?.root;

/** What T3 makes a link for, for a ref. Video and sound need `media-file`; T3's `workspace-file` refuses them. */
function assetFor(ref: FileRef, path?: string): T3Asset {
  if (ref.from === "render")
    return { _tag: "attachment", attachmentId: ref.attachment, mimeType: "text/html", disposition: "inline" };
  if (ref.from !== "t3") throw new Error("not a T3 file");
  const file = path ?? ref.path;
  const kind = kindOf(file);
  return {
    _tag: kind === "video" || kind === "audio" ? "media-file" : "workspace-file",
    threadId: ref.thread,
    path: file,
  };
}

/** Headers passed on from T3's answer. */
const passed = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
  "content-security-policy",
  "content-disposition",
];

/**
 * Serves `/file/...` links. T3's links last about an hour, so each is kept until shortly before then and
 * made again when needed: a file seen once costs one call to T3 an hour, however often it is shown.
 */
export function fileRoute(options: { secret: () => string; workspace: () => string; t3: () => T3Link | undefined }) {
  const links = new Map<string, { url: string; expiresAt: number }>();
  const linkFor = async (t3: T3Link, asset: T3Asset, fresh = false) => {
    const key = JSON.stringify(asset);
    const known = links.get(key);
    if (!fresh && known && known.expiresAt - 120_000 > Date.now()) return known.url;
    const made = await t3.asset(asset);
    links.delete(key);
    links.set(key, made);
    for (const old of links.keys()) if (links.size > 500) links.delete(old);
    return made.url;
  };

  const fromT3 = async (
    request: IncomingMessage,
    response: ServerResponse,
    t3: T3Link,
    asset: T3Asset,
    sibling?: string,
  ) => {
    const headers: Record<string, string> = {};
    for (const name of ["range", "if-none-match", "if-modified-since"]) {
      const value = request.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    let answer: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      let url = await linkFor(t3, asset, attempt > 0);
      // A page's link is to its folder's files: `<folder link>/<name>`.
      if (sibling)
        url = `${url.slice(0, url.lastIndexOf("/") + 1)}${sibling.split("/").map(encodeURIComponent).join("/")}`;
      answer = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      // A link that ran out early: make it again, once.
      if (answer.status !== 401 && answer.status !== 403 && !(answer.status === 404 && !sibling)) break;
      await answer.body?.cancel();
    }
    if (!answer) return;
    const out: Record<string, string> = { "x-content-type-options": "nosniff", "cache-control": "private, no-cache" };
    for (const name of passed) {
      const value = answer.headers.get(name);
      if (value) out[name] = value;
    }
    if (/^text\/html|^image\/svg/.test(out["content-type"] ?? "")) out["content-security-policy"] = sandbox;
    response.writeHead(answer.status, out);
    if (!answer.body || request.method === "HEAD") return response.end();
    Readable.fromWeb(answer.body as unknown as import("node:stream/web").ReadableStream).pipe(response);
  };

  const fromDisk = (request: IncomingMessage, response: ServerResponse, full: string) => {
    const stat = statSync(full);
    const etag = `"${stat.size.toString(36)}-${stat.mtimeMs.toString(36)}"`;
    const kind = kindOf(full);
    const type = types[ext(full)] ?? (kind === "text" ? "text/plain; charset=utf-8" : "application/octet-stream");
    const headers: Record<string, string | number> = {
      "content-type": kind === "text" ? "text/plain; charset=utf-8" : type,
      etag,
      "cache-control": "private, no-cache",
      "x-content-type-options": "nosniff",
      "accept-ranges": "bytes",
    };
    if (kind === "html" || ext(full) === "svg") headers["content-security-policy"] = sandbox;
    if (request.headers["if-none-match"] === etag) {
      response.writeHead(304, headers);
      return response.end();
    }
    let start = 0;
    let end = stat.size - 1;
    if (kind === "text" && stat.size > textLimit) {
      end = textLimit - 1;
      headers["x-bruv-truncated"] = "1";
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(request.headers.range ?? ""));
    let status = 200;
    if (range && kind !== "text") {
      const from = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
      const to = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      if (!(from >= 0 && from <= to)) {
        response.writeHead(416, { "content-range": `bytes */${stat.size}` });
        return response.end();
      }
      start = from;
      end = to;
      status = 206;
      headers["content-range"] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers["content-length"] = Math.max(0, end - start + 1);
    response.writeHead(status, headers);
    if (request.method === "HEAD" || stat.size === 0) return response.end();
    createReadStream(full, { start, end }).pipe(response);
  };

  return async (request: IncomingMessage, response: ServerResponse, path: string) => {
    const match = /^\/file\/([\w-]+\.[\w-]+)\/(.+)$/.exec(path);
    if (!match) return false;
    const notFound = () => {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
      return true;
    };
    const ref = readLink(options.secret(), match[1] as string);
    let rest: string | undefined;
    try {
      rest = cleanRelative(decodeURIComponent(match[2] as string));
    } catch {}
    if (!ref || !rest) return notFound();
    try {
      if (ref.from === "own") {
        const name = posix.basename(ref.path);
        // Only a page reaches the files beside it.
        const wanted =
          rest === name
            ? ref.path
            : kindOf(ref.path) === "html"
              ? posix.join(posix.dirname(ref.path), rest)
              : undefined;
        const found = wanted && inside(options.workspace(), wanted);
        if (!found || !statSync(found.full).isFile()) return notFound();
        fromDisk(request, response, found.full);
        return true;
      }
      const t3 = options.t3();
      if (!t3) return notFound();
      if (ref.from === "render") {
        if (rest !== "page.html") return notFound();
        await fromT3(request, response, t3, assetFor(ref));
        return true;
      }
      const name = posix.basename(ref.path);
      if (kindOf(ref.path) === "text") {
        if (rest !== name) return notFound();
        const { contents, truncated } = await t3.readFile(ref.folder, ref.path);
        const body = Buffer.from(contents.length > textLimit ? contents.slice(0, textLimit) : contents);
        response.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
          "content-length": body.length,
          "cache-control": "private, no-cache",
          "x-content-type-options": "nosniff",
          ...(truncated || contents.length > textLimit ? { "x-bruv-truncated": "1" } : {}),
        });
        response.end(request.method === "HEAD" ? undefined : body);
        return true;
      }
      if (rest === name) await fromT3(request, response, t3, assetFor(ref));
      else if (kindOf(ref.path) === "html") {
        // A page's own link (T3's `workspace-file`) reaches its folder; the file beside it goes through that.
        await fromT3(request, response, t3, assetFor(ref), rest);
      } else return notFound();
      return true;
    } catch {
      if (!response.headersSent) return notFound();
      response.destroy();
      return true;
    }
  };
}
