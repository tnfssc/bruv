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

/**
 * Things shared under random names, so only someone who was shown one can fetch it: a file by its path, or
 * a page the agent wrote, kept in memory.
 */
export class Shelf {
  private files = new Map<string, { source: string | Buffer; type: string }>();

  add(source: string | Buffer, type: string) {
    const id = randomBytes(16).toString("base64url");
    this.files.set(id, { source, type });
    if (this.files.size > kept) this.files.delete(this.files.keys().next().value as string);
    return `/shown/${id}`;
  }

  /** Answers `/shown/<id>`, with byte ranges, which Safari needs to play video. */
  serve(request: IncomingMessage, response: ServerResponse, id: string) {
    const file = this.files.get(id);
    let size = 0;
    try {
      if (file) size = typeof file.source === "string" ? statSync(file.source).size : file.source.length;
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
      // Nothing shown runs with the voice page's origin: an SVG runs no scripts, and a page runs its own in a
      // sandbox, as it does inside the voice page.
      "content-security-policy": file.type.startsWith("text/html")
        ? "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox"
        : "sandbox",
    };
    const body = (start?: number, end?: number) => {
      if (typeof file.source === "string") createReadStream(file.source, { start, end }).pipe(response);
      else response.end(start === undefined ? file.source : file.source.subarray(start, (end ?? 0) + 1));
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
    if (!range || (!range[1] && !range[2])) {
      response.writeHead(200, { ...headers, "content-length": size });
      body();
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
    body(start, end);
  }
}

/** What to show, checked: a whole page, a file on this machine, or a link. */
export type Resolved = {
  kind: Shown["kind"];
  title?: string;
  html?: string;
  path?: string;
  url?: string;
  type?: string;
};

/** Checks what the agent asked to show. Throws with a reason the agent can act on. */
export function resolveShown(args: ShowArgs, cwd: string): Resolved {
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
    return { kind, title, url: url.href };
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
  if (type[0] !== "html") return { kind: type[0], title, path, type: type[1] };
  if (size > maxHtml) throw new Error("That page is over 2 MB. Make it smaller.");
  return { kind: "html", title, html: readFileSync(path, "utf8"), path };
}

/** What a voice page gets: the page itself, the link, or a file shared under a name no one can guess. */
export function forPage(item: Resolved, shelf: Shelf): Shown {
  const { kind, title } = item;
  if (kind === "html") return { kind, title, html: item.html };
  return { kind, title, src: item.url ?? shelf.add(item.path as string, item.type as string) };
}
