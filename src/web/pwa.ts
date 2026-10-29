import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebPart } from "./part";
import { allowed } from "./server";

export type { Route } from "./part";
/** Answers with JSON, never cached. */
export function json(response: ServerResponse, status: number, body?: unknown) {
  const text = body === undefined ? "" : JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  response.end(text);
}

/** A small JSON body, or undefined when it is too big or not JSON. */
export async function readJson(request: IncomingMessage, limit = 16 << 10): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

/**
 * The page's web app manifest. The key is the page's only sign-in, so `start_url` holds it and the
 * manifest itself is served only with the key: the installed app opens signed in. Icons and the service
 * worker are plain files in `web/public`.
 */
export function manifest(key: string) {
  return JSON.stringify({
    id: "/",
    name: "bruv",
    short_name: "bruv",
    description: "Your assistant for the work in T3 Code.",
    start_url: `/?t=${encodeURIComponent(key)}`,
    scope: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  });
}

/** Makes the page installable: serves the keyed manifest at `/manifest.webmanifest?t=<key>`. */
export function appPart(): WebPart {
  let remove: (() => void) | undefined;
  return {
    name: "app",
    start(web) {
      const body = manifest(web.key);
      remove = web.route((request, response, path) => {
        if (path !== "/manifest.webmanifest") return false;
        if (!allowed(request, web.key)) {
          response.writeHead(404).end();
          return true;
        }
        response.writeHead(200, {
          "content-type": "application/manifest+json",
          "content-length": Buffer.byteLength(body),
          "cache-control": "no-cache",
        });
        response.end(body);
        return true;
      });
    },
    close() {
      remove?.();
    },
  };
}
