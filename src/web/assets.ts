import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The page's Vite project. Its built files in `dist/` are committed: users never build. */
export const webDir = fileURLToPath(new URL("../../web/", import.meta.url));
/** Where the dev server's hot reload socket listens, beside bruv's own `/socket`. */
export const hmrPath = "/__vite_hmr";

export type PageAssets = {
  /** The page's HTML for a request to `/` (the caller checks the key). */
  index(url: string): Promise<string>;
  /** Serves the request if it is one of the page's files; false leaves it to the caller. */
  handle(request: IncomingMessage, response: ServerResponse): boolean | Promise<boolean>;
  close(): Promise<void>;
};

const types: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * The built page, read into memory once: a few hundred KB, so no disk reads per request. Files under
 * `assets/` have content hashes in their names, so browsers keep them for good.
 */
function built(dist: string): PageAssets {
  let html: string;
  try {
    html = readFileSync(join(dist, "index.html"), "utf8");
  } catch {
    throw new Error(`The page isn't built: ${join(dist, "index.html")} is missing. Run \`bun run build:web\`.`);
  }
  const served = new Map<string, { body: Buffer; type: string; cache: string }>();
  for (const file of files(dist)) {
    const path = `/${relative(dist, file).split(sep).join("/")}`;
    if (path === "/index.html") continue;
    served.set(path, {
      body: readFileSync(file),
      type: types[extname(file)] ?? "application/octet-stream",
      cache: path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
  }
  return {
    index: async () => html,
    handle(request, response) {
      if (request.method !== "GET" && request.method !== "HEAD") return false;
      const file = served.get(new URL(request.url ?? "/", "http://x").pathname);
      if (!file) return false;
      response.writeHead(200, {
        "content-type": file.type,
        "content-length": file.body.length,
        "cache-control": file.cache,
        "x-content-type-options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : file.body);
      return true;
    },
    close: async () => {},
  };
}

/**
 * Vite in middleware mode on bruv's own server, for working on the page: one origin (so it works through
 * the tunnel on a phone), React Fast Refresh, and hot reload on its own socket path. Vite is a dev
 * dependency, so this only works in a checkout after `bun install`.
 */
async function dev(server: Server): Promise<PageAssets> {
  let vite: typeof import("vite");
  try {
    vite = await import("vite");
  } catch {
    throw new Error("Live reload needs Vite: run `bun install` in a checkout of bruv.");
  }
  const devServer = await vite.createServer({
    root: webDir,
    configFile: join(webDir, "vite.config.ts"),
    appType: "custom",
    // bruv checks the page key; hosts vary (localhost, the LAN, a tunnel).
    server: { middlewareMode: true, hmr: { server, path: hmrPath }, allowedHosts: true },
  });
  return {
    index: async (url) => devServer.transformIndexHtml(url, await readFile(join(webDir, "index.html"), "utf8")),
    handle: (request, response) =>
      new Promise<boolean>((resolve, reject) => {
        response.once("close", () => resolve(true));
        devServer.middlewares(request, response, (error?: unknown) => (error ? reject(error) : resolve(false)));
      }),
    close: () => devServer.close(),
  };
}

/** The page's files: built ones normally, or Vite's dev server with live reload. */
export async function pageAssets(options: { dev: boolean; server: Server }): Promise<PageAssets> {
  return options.dev ? dev(options.server) : built(join(webDir, "dist"));
}
