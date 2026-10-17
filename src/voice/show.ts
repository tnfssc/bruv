import { randomBytes } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve } from "node:path";
import type { Shown } from "./call";

/** Shown things: what the voice page can put on screen next to the talk. */

const types: Record<string, [Shown["kind"], string]> = {
  ".png": ["image", "image/png"],
  ".jpg": ["image", "image/jpeg"],
  ".jpeg": ["image", "image/jpeg"],
  ".gif": ["image", "image/gif"],
  ".webp": ["image", "image/webp"],
  ".avif": ["image", "image/avif"],
  ".svg": ["image", "image/svg+xml"],
  ".bmp": ["image", "image/bmp"],
  ".mp4": ["video", "video/mp4"],
  ".m4v": ["video", "video/mp4"],
  ".webm": ["video", "video/webm"],
  ".mov": ["video", "video/quicktime"],
  ".ogv": ["video", "video/ogg"],
  ".html": ["html", "text/html"],
  ".htm": ["html", "text/html"],
};

/** A page is sent whole, so it has a size limit; pictures and videos are streamed. */
const maxHtml = 2_000_000;
/** Files the page may still ask for, oldest dropped first. */
const kept = 200;

export type ShowArgs = { html?: string; file?: string; url?: string; kind?: "image" | "video"; title?: string };

/** Files shared with the page under random names, so only a page that was shown one can fetch it. */
export class Shelf {
  private files = new Map<string, { path: string; type: string }>();

  add(path: string, type: string) {
    const id = randomBytes(16).toString("base64url");
    this.files.set(id, { path, type });
    if (this.files.size > kept) this.files.delete(this.files.keys().next().value as string);
    return `/shown/${id}`;
  }

  /** Answers `/shown/<id>`, with byte ranges, which Safari needs to play video. */
  serve(request: IncomingMessage, response: ServerResponse, id: string) {
    const file = this.files.get(id);
    let size = 0;
    try {
      if (file) size = statSync(file.path).size;
    } catch {}
    if (!file || !size) {
      response.writeHead(404).end();
      return;
    }
    const headers = {
      "content-type": file.type,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      // An SVG opened on its own must not run scripts with the page's origin.
      "content-security-policy": "sandbox",
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
    if (!range || (!range[1] && !range[2])) {
      response.writeHead(200, { ...headers, "content-length": size });
      createReadStream(file.path).pipe(response);
      return;
    }
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      response.writeHead(416, { "content-range": `bytes */${size}` }).end();
      return;
    }
    response.writeHead(206, {
      ...headers,
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${size}`,
    });
    createReadStream(file.path, { start, end }).pipe(response);
  }
}

/** Turns what the agent asked to show into what the page gets. Throws with a reason the agent can act on. */
export function prepareShown(args: ShowArgs, cwd: string, shelf: Shelf): Shown {
  const given = [args.html, args.file, args.url].filter((value) => value !== undefined);
  if (given.length !== 1) throw new Error("Give exactly one of html, file or url.");
  const title = args.title?.trim() || undefined;
  if (args.html !== undefined) {
    if (args.html.length > maxHtml) throw new Error("That page is over 2 MB. Make it smaller.");
    return { kind: "html", title, html: args.html };
  }
  if (args.url !== undefined) {
    let url: URL;
    try {
      url = new URL(args.url);
    } catch {
      throw new Error("That url isn't a full http or https link.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https links work.");
    const kind = args.kind ?? types[extname(url.pathname).toLowerCase()]?.[0];
    if (kind !== "image" && kind !== "video") throw new Error("Say whether the link is an image or a video in kind.");
    return { kind, title, src: url.href };
  }
  const path = resolve(cwd, args.file as string);
  const type = types[extname(path).toLowerCase()];
  if (!type)
    throw new Error(
      `Can't show ${extname(path) || "files without an extension"}. Use ${Object.keys(types).join(" ")}.`,
    );
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    throw new Error(`No file at ${path}.`);
  }
  if (type[0] === "html") {
    if (size > maxHtml) throw new Error("That page is over 2 MB. Make it smaller.");
    return { kind: "html", title, html: readFileSync(path, "utf8") };
  }
  return { kind: type[0], title, src: shelf.add(path, type[1]) };
}
