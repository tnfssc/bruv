import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WebContext, WebPart } from "./part";
import { json, readJson } from "./pwa";
import { allowed } from "./server";
import { newVapid, type Subscription, sendPush, type Vapid, validSubscription } from "./webpush";

/** The server's push key: made once, since a new one ends every subscription. */
function vapidKeys(dir: string): Vapid {
  const file = join(dir, "vapid.json");
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Vapid;
  const fresh = newVapid();
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(fresh), { mode: 0o600 });
  chmodSync(file, 0o600);
  return fresh;
}

/** News as a notification's body: one plain line of about 180 characters. */
export function shorten(text: string, most = 180) {
  const plain = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(#+|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > most ? `${plain.slice(0, most - 1).trimEnd()}…` : plain;
}

/**
 * The notification, in Declarative Web Push's shape (iOS 18.4+ and macOS 15.5 show it without running the
 * service worker); the service worker reads the same JSON everywhere else.
 */
export function payload(text: string, url: string) {
  return JSON.stringify({
    web_push: 8030,
    notification: { title: "bruv", body: shorten(text), navigate: url, tag: "bruv-news" },
  });
}

/**
 * Push notifications: the assistant's news reaches the user's devices while no page is in front. Pages
 * subscribe from a tap (`/push/subscribe`); subscriptions live in `push.json`, written only when they change.
 */
export function pushPart(options: { fetch?: typeof globalThis.fetch } = {}): WebPart {
  let web: WebContext | undefined;
  let vapid: Vapid | undefined;
  let subs: Subscription[] = [];
  let file = "";
  let remove: (() => void) | undefined;

  const save = () => writeFileSync(file, JSON.stringify(subs), { mode: 0o600 });
  const add = (sub: Subscription) => {
    const found = subs.find((known) => known.endpoint === sub.endpoint);
    if (found?.keys.p256dh === sub.keys.p256dh && found.keys.auth === sub.keys.auth) return;
    subs = [...subs.filter((known) => known.endpoint !== sub.endpoint), { endpoint: sub.endpoint, keys: sub.keys }];
    save();
  };
  const drop = (endpoint: string) => {
    const kept = subs.filter((known) => known.endpoint !== endpoint);
    if (kept.length === subs.length) return;
    subs = kept;
    save();
  };

  return {
    name: "push",
    start(context) {
      web = context;
      const keys = vapidKeys(context.dir);
      vapid = keys;
      file = join(context.dir, "push.json");
      try {
        subs = existsSync(file)
          ? (JSON.parse(readFileSync(file, "utf8")) as Subscription[]).filter(validSubscription)
          : [];
      } catch {
        subs = [];
      }
      remove = context.route(async (request, response, path) => {
        if (!path.startsWith("/push/")) return false;
        if (!allowed(request, context.key)) {
          response.writeHead(404).end();
          return true;
        }
        if (path === "/push/key" && request.method === "GET") {
          json(response, 200, { key: keys.publicKey });
          return true;
        }
        if (request.method !== "POST" || (path !== "/push/subscribe" && path !== "/push/unsubscribe")) {
          response.writeHead(404).end();
          return true;
        }
        const body = await readJson(request);
        if (path === "/push/subscribe" && validSubscription(body)) add(body);
        else if (path === "/push/unsubscribe" && typeof (body as Subscription)?.endpoint === "string")
          drop((body as Subscription).endpoint);
        else {
          json(response, 400);
          return true;
        }
        json(response, 204);
        return true;
      });
    },
    news(text) {
      if (!web || !vapid || !subs.length || web.watched()) return;
      const url = web.address();
      const origin = new URL(url).origin;
      // Apple wants a contact it can read: the page's own https address, or a mailto.
      const subject = origin.startsWith("https://") ? origin : "mailto:bruv@localhost";
      const body = payload(text, url);
      const keys = vapid;
      for (const sub of subs)
        void sendPush(sub, body, keys, subject, options.fetch).then(
          (status) => {
            if (status === 404 || status === 410) drop(sub.endpoint);
          },
          () => {},
        );
    },
    close() {
      remove?.();
      web = undefined;
    },
  };
}
