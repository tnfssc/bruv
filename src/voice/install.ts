import { readFileSync } from "node:fs";

/**
 * What makes the voice page installable as an app: its manifest, icons and service worker. These need no
 * key, except the manifest, which holds the page's address with the key so the installed app opens signed in.
 */
const file = (name: string) => readFileSync(new URL(`./app/${name}`, import.meta.url));

const files: Record<string, { type: string; body: Buffer }> = {
  "/sw.js": { type: "text/javascript; charset=utf-8", body: file("sw.js") },
  "/icon-180.png": { type: "image/png", body: file("icon-180.png") },
  "/icon-192.png": { type: "image/png", body: file("icon-192.png") },
  "/icon-512.png": { type: "image/png", body: file("icon-512.png") },
  "/icon-maskable.png": { type: "image/png", body: file("icon-maskable.png") },
};

export function appFile(path: string) {
  return files[path];
}

export function manifest(token: string) {
  return JSON.stringify({
    id: "/",
    name: "bruv voice",
    short_name: "bruv",
    description: "Talk to your coding agent.",
    start_url: `/?t=${encodeURIComponent(token)}`,
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
