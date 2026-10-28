import { afterEach, expect, test } from "bun:test";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebContext, WebPart } from "../src/web/part";
import { pushPart } from "../src/web/push";
import { appPart } from "../src/web/pwa";
import { serveWeb } from "../src/web/server";
import { encrypt, type Subscription } from "../src/web/webpush";

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

/** The real web server with a part started on it, as the web version does. */
async function serve(part: WebPart, dir = mkdtempSync(join(tmpdir(), "bruv-push-"))) {
  const server = await serveWeb({
    host: "127.0.0.1",
    port: 0,
    key,
    assets: async () => ({ index: async () => "<!doctype html>", handle: () => false, close: async () => {} }),
    hello: () => ({ type: "busy", busy: false }),
    onPage: () => {},
    image: () => undefined,
  });
  const state = { watched: false };
  const web: WebContext = {
    http: server.http,
    route: server.route,
    key,
    dir,
    agentDir: dir,
    address: () => `https://bruv.example.com/?t=${key}`,
    setAddress: () => {},
    say: () => {},
    stop: () => {},
    watched: () => state.watched,
    notify: () => {},
    apiKey: async () => undefined,
  };
  await part.start(web);
  cleanup.push(
    () => rmSync(dir, { recursive: true, force: true }),
    () => part.close(),
    () => server.close(),
  );
  const base = `http://127.0.0.1:${server.port}`;
  const post = (path: string, body: unknown, withKey = true) =>
    fetch(`${base}${path}${withKey ? `?t=${key}` : ""}`, { method: "POST", body: JSON.stringify(body) });
  return { base, dir, state, post, server };
}

/** A browser's side of a subscription: its keys, so a test can read what was pushed. */
function device(endpoint = "https://push.example/send/1") {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = Buffer.from("0123456789abcdef");
  const sub: Subscription = {
    endpoint,
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
  };
  /** RFC 8291 from the receiving end. */
  const decrypt = (body: Buffer) => {
    const salt = body.subarray(0, 16);
    const length = body[20] as number;
    const sender = body.subarray(21, 21 + length);
    const sealed = body.subarray(21 + length);
    const secret = ecdh.computeSecret(sender);
    const info = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), sender]);
    const ikm = Buffer.from(hkdfSync("sha256", secret, auth, info, 32));
    const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
    const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
    decipher.setAuthTag(sealed.subarray(-16));
    const plain = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
    expect(plain.at(-1)).toBe(2);
    return JSON.parse(plain.subarray(0, -1).toString("utf8"));
  };
  return { sub, decrypt };
}

/** A push service that records what it got and answers with `status`. */
function pushService(status = 201) {
  const got: { url: string; headers: Headers; body: Buffer }[] = [];
  const service = { status, got };
  const fetch = (async (url: string, init: RequestInit) => {
    got.push({ url, headers: new Headers(init.headers), body: Buffer.from(init.body as Uint8Array) });
    return new Response(null, { status: service.status });
  }) as unknown as typeof globalThis.fetch;
  return { service, fetch };
}

const saved = (dir: string) =>
  existsSync(join(dir, "push.json"))
    ? (JSON.parse(readFileSync(join(dir, "push.json"), "utf8")) as Subscription[])
    : [];

test("encryption matches RFC 8291's worked example", () => {
  const b64 = (text: string) => Buffer.from(text, "base64url");
  const body = encrypt(
    Buffer.from("When I grow up, I want to be a watermelon"),
    {
      p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      auth: "BTBZMqHH6r4Tts7J_aSIgg",
    },
    { salt: b64("DGv6ra1nlYgDCS1FRnbzlw"), privateKey: b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw") },
  );
  expect(body.toString("base64url")).toBe(
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  );
});

test("the push key is made once, kept private, and served only with the page key", async () => {
  const first = await serve(pushPart());
  const file = join(first.dir, "vapid.json");
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect((await fetch(`${first.base}/push/key`)).status).toBe(404);
  const { key: one } = (await (await fetch(`${first.base}/push/key?t=${key}`)).json()) as { key: string };
  expect(Buffer.from(one, "base64url")).toHaveLength(65);
  const again = await serve(pushPart(), first.dir);
  const { key: two } = (await (await fetch(`${again.base}/push/key?t=${key}`)).json()) as { key: string };
  expect(two).toBe(one);
  // The server's own routes still work beside the part's.
  expect((await fetch(`${again.base}/?t=${key}`)).status).toBe(200);
  expect((await fetch(`${again.base}/nothing`)).status).toBe(404);
});

test("pages subscribe and unsubscribe with the key; bad subscriptions are refused", async () => {
  const { dir, post } = await serve(pushPart());
  const { sub } = device();
  expect((await post("/push/subscribe", sub, false)).status).toBe(404);
  expect(saved(dir)).toEqual([]);
  expect((await post("/push/subscribe", { ...sub, endpoint: "http://push.example/x" })).status).toBe(400);
  expect((await post("/push/subscribe", { endpoint: sub.endpoint, keys: { p256dh: "x", auth: "y" } })).status).toBe(
    400,
  );
  expect((await post("/push/subscribe", sub)).status).toBe(204);
  expect((await post("/push/subscribe", sub)).status).toBe(204);
  expect(saved(dir)).toEqual([sub]);
  expect(statSync(join(dir, "push.json")).mode & 0o777).toBe(0o600);
  expect((await post("/push/unsubscribe", { endpoint: sub.endpoint })).status).toBe(204);
  expect(saved(dir)).toEqual([]);
});

test("news is pushed only while no page is in front, encrypted for the device and signed", async () => {
  const { service, fetch: fake } = pushService();
  const part = pushPart({ fetch: fake });
  const { base, state, post } = await serve(part);
  const phone = device();
  await post("/push/subscribe", phone.sub);
  state.watched = true;
  part.news?.("Seen on the page already");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(service.got).toHaveLength(0);

  state.watched = false;
  part.news?.(`The **login fix** is ready. ${"More words. ".repeat(40)}`);
  await until(() => service.got.length === 1);
  const sent = service.got[0] as (typeof service.got)[number];
  expect(sent.url).toBe(phone.sub.endpoint);
  expect(sent.headers.get("content-encoding")).toBe("aes128gcm");
  const message = phone.decrypt(sent.body);
  expect(message.web_push).toBe(8030);
  expect(message.notification.title).toBeString();
  expect(message.notification.body.length).toBeLessThanOrEqual(180);
  expect(message.notification.navigate).toBe(`https://bruv.example.com/?t=${key}`);

  // The VAPID token is signed by the key pages subscribe with, for this push service.
  const { key: serverKey } = (await (await fetch(`${base}/push/key?t=${key}`)).json()) as { key: string };
  const auth = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(sent.headers.get("authorization") ?? "");
  expect(auth?.[4]).toBe(serverKey);
  const [, header, claims, signature] = auth as RegExpExecArray;
  const point = Buffer.from(serverKey, "base64url");
  const publicKey = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33).toString("base64url"),
    },
    format: "jwk",
  });
  const signed = verify(
    "sha256",
    Buffer.from(`${header}.${claims}`),
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature as string, "base64url"),
  );
  expect(signed).toBe(true);
  expect(JSON.parse(Buffer.from(claims as string, "base64url").toString()).aud).toBe("https://push.example");
});

test("a subscription the push service says is gone is dropped", async () => {
  const { service, fetch: fake } = pushService(410);
  const part = pushPart({ fetch: fake });
  const { dir, post } = await serve(part);
  const gone = device("https://push.example/send/gone");
  await post("/push/subscribe", gone.sub);
  part.news?.("Anything");
  await until(() => saved(dir).length === 0);
  expect(service.got).toHaveLength(1);
  // Other failures keep it.
  service.status = 500;
  await post("/push/subscribe", gone.sub);
  part.news?.("Anything");
  await until(() => service.got.length === 2);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(saved(dir)).toHaveLength(1);
});

test("the app manifest is served only with the key, and opens the page with it", async () => {
  const { base } = await serve(appPart());
  expect((await fetch(`${base}/manifest.webmanifest`)).status).toBe(404);
  const response = await fetch(`${base}/manifest.webmanifest?t=${key}`);
  expect(response.headers.get("content-type")).toContain("manifest");
  const manifest = (await response.json()) as { start_url: string; display: string; icons: unknown[] };
  expect(new URL(manifest.start_url, base).searchParams.get("t")).toBe(key);
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.length).toBeGreaterThan(0);
});
