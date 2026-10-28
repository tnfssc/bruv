import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { T3Place } from "./locate";

/**
 * bruv's two T3 keys. "session" is the app's own key, for the live feed; "mcp" works only at /mcp. Both come from
 * a one-time `t3 pair` token, so signing in again needs no person. T3 gives no refresh tokens; keys last 30 days.
 */
export type KeyKind = "session" | "mcp";
type Key = { token: string; expiresAt: number };
type Saved = { origin?: string } & Partial<Record<KeyKind, Key>>;

const scopes = ["orchestration:read", "orchestration:operate"];
const label = "bruv web";
/** Sign in again a little before T3 would refuse the key. */
const margin = 60_000;

export class T3Error extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`T3 answered ${status}: ${body.slice(0, 200)}`);
  }
}

export async function call(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new T3Error(response.status, await response.text().catch(() => ""));
  return response.json() as Promise<Record<string, unknown>>;
}

const asKey = (body: Record<string, unknown>): Key => {
  if (typeof body.access_token !== "string") throw new Error("T3 gave no access token");
  const seconds = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return { token: body.access_token, expiresAt: Date.now() + seconds * 1000 };
};

const form = (fields: Record<string, string>) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function signInSession(place: T3Place): Promise<Key> {
  const code = await place.pair(scopes, label);
  return asKey(
    await call(
      `${place.origin}/oauth/token`,
      form({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: code,
        subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        client_label: label,
        client_device_type: "bot",
      }),
    ),
  );
}

/** OAuth with PKCE, approved with a pairing token instead of a browser. Nothing listens at the redirect URI. */
async function signInMcp(place: T3Place): Promise<Key> {
  const redirect = "http://127.0.0.1/bruv-callback";
  const client = await call(
    `${place.origin}/oauth/mcp/register`,
    json({
      client_name: label,
      redirect_uris: [redirect],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  );
  if (typeof client.client_id !== "string") throw new Error("T3 gave no client id");
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(12).toString("base64url");
  const authorization = {
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirect,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    scope: scopes.join(" "),
    state,
    resource: `${place.origin}/mcp`,
  };
  // T3 grants "full-access" only for a code with its standard scope set, which an empty list asks for.
  const pairing = await place.pair([], label);
  const decision = await call(
    `${place.origin}/oauth/mcp/decision`,
    json({ authorization, decision: { _tag: "pairing-code", access: "full-access", code: pairing } }),
  );
  if (typeof decision.redirectTo !== "string") throw new Error("T3 did not approve the MCP sign-in");
  const back = new URL(decision.redirectTo).searchParams;
  const code = back.get("code");
  if (!code || back.get("state") !== state) throw new Error("T3 did not approve the MCP sign-in");
  return asKey(
    await call(
      `${place.origin}/oauth/mcp/token`,
      form({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
        client_id: client.client_id,
        code_verifier: verifier,
        resource: authorization.resource,
      }),
    ),
  );
}

/** Keys saved in `<dir>/t3.json` (mode 0600), reused until they expire or T3 refuses them. */
export function keyStore(dir: string) {
  const file = join(dir, "t3.json");
  const pending = new Map<KeyKind, Promise<string>>();
  // Read once; written only when a sign-in brings a new key.
  let keys: Saved = {};
  try {
    keys = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  const saved = (kind: KeyKind, origin: string) => {
    const key = keys.origin === origin ? keys[kind] : undefined;
    return key && key.expiresAt - margin > Date.now() ? key.token : undefined;
  };
  const signIn = async (kind: KeyKind, place: T3Place) => {
    const key = await (kind === "session" ? signInSession(place) : signInMcp(place));
    keys = { ...(keys.origin === place.origin ? keys : {}), origin: place.origin, [kind]: key };
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    return key.token;
  };
  return {
    /** A working key, signing in when there is none. Only one sign-in per kind runs at a time. */
    get(kind: KeyKind, place: T3Place): Promise<string> {
      const token = saved(kind, place.origin);
      if (token) return Promise.resolve(token);
      let running = pending.get(kind);
      if (!running) {
        running = signIn(kind, place).finally(() => pending.delete(kind));
        pending.set(kind, running);
      }
      return running;
    },
    /** T3 refused this key: forget it so the next `get` signs in again. The sign-in saves the file. */
    drop(kind: KeyKind, token: string) {
      if (keys[kind]?.token === token) keys = { ...keys, [kind]: undefined };
    },
  };
}

export type KeyStore = ReturnType<typeof keyStore>;
