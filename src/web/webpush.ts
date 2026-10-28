import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
} from "node:crypto";

/**
 * Web push by hand with node:crypto: the VAPID sign-in (RFC 8292) and the payload encryption (RFC 8291,
 * aes128gcm). About 80 lines, checked against RFC 8291's worked example, so bruv needs no push library.
 */

export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };

/** The server's P-256 pair: `publicKey` is the raw point the page subscribes with, `jwk` signs. */
export type Vapid = { publicKey: string; jwk: { kty: "EC"; crv: "P-256"; x: string; y: string; d: string } };

const b64 = (data: Uint8Array) => Buffer.from(data).toString("base64url");
const unb64 = (text: string) => Buffer.from(text, "base64url");

export function newVapid(): Vapid {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" }) as Vapid["jwk"];
  return { publicKey: b64(Buffer.concat([Buffer.from([4]), unb64(jwk.x), unb64(jwk.y)])), jwk };
}

/** Whether a subscription from a page looks like one a browser made. */
export function validSubscription(value: unknown): value is Subscription {
  const sub = value as Subscription | undefined;
  if (typeof sub?.endpoint !== "string" || typeof sub.keys?.p256dh !== "string" || typeof sub.keys.auth !== "string")
    return false;
  try {
    if (new URL(sub.endpoint).protocol !== "https:") return false;
  } catch {
    return false;
  }
  const point = unb64(sub.keys.p256dh);
  return point.length === 65 && point[0] === 4 && unb64(sub.keys.auth).length === 16;
}

/** The `Authorization` header for one push service: a JWT signed with the VAPID key, good for 12 hours. */
export function vapidHeader(vapid: Vapid, endpoint: string, subject: string, now = Date.now()) {
  const header = b64(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject };
  const body = `${header}.${b64(Buffer.from(JSON.stringify(claims)))}`;
  const key = createPrivateKey({ key: vapid.jwk, format: "jwk" });
  const signature = sign("sha256", Buffer.from(body), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${body}.${b64(signature)}, k=${vapid.publicKey}`;
}

/**
 * Encrypts a payload for one subscription (RFC 8291): a fresh key pair and salt per message, one record.
 * `fixed` is for tests only, to repeat the RFC's example.
 */
export function encrypt(payload: Uint8Array, sub: Subscription["keys"], fixed?: { salt: Buffer; privateKey: Buffer }) {
  const own = createECDH("prime256v1");
  if (fixed) own.setPrivateKey(fixed.privateKey);
  else own.generateKeys();
  const ownPublic = own.getPublicKey();
  const theirs = unb64(sub.p256dh);
  const secret = own.computeSecret(theirs);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), theirs, ownPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", secret, unb64(sub.auth), info, 32));
  const salt = fixed?.salt ?? randomBytes(16);
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // The 2 marks the last (and only) record.
  const sealed = Buffer.concat([
    cipher.update(payload),
    cipher.update(Buffer.from([2])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0);
  head.writeUInt32BE(4096, 16);
  head[20] = ownPublic.length;
  return Buffer.concat([head, ownPublic, sealed]);
}

/** Sends one push. The status tells the caller whether the subscription is gone (404, 410). */
export async function sendPush(
  sub: Subscription,
  payload: string,
  vapid: Vapid,
  subject: string,
  fetch: typeof globalThis.fetch = globalThis.fetch,
) {
  const response = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      authorization: vapidHeader(vapid, sub.endpoint, subject),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(24 * 3600),
      urgency: "high",
    },
    body: encrypt(Buffer.from(payload), sub.keys),
    signal: AbortSignal.timeout(15_000),
  });
  await response.body?.cancel().catch(() => {});
  return response.status;
}
