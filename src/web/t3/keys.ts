import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { T3Place } from "./locate";

/**
 * bruv's two T3 keys. "session" is the app's own key, for the live feed and file links; "mcp" works only at
 * /mcp. Both come from one-time pairing tokens: `t3 pair` on this machine, or minted with the session itself
 * for a T3 elsewhere, so signing in again needs no person. T3 gives no refresh tokens; keys last 30 days.
 */
export type KeyKind = "session" | "mcp";
/** `standard`: the session holds T3's standard scope set, which file links and minting need. */
type Key = { token: string; expiresAt: number; life?: number; standard?: boolean };
/** `remote`: paired from a link (`/web t3 <link>`), so tokens are minted with the session, not `t3 pair`. */
type Saved = { origin?: string; remote?: boolean } & Partial<Record<KeyKind, Key>>;

/** What the MCP key asks for. The session asks for T3's standard set (no scopes named). */
const mcpScopes = ["orchestration:read", "orchestration:operate"];
const label = "bruv web";
/**
 * Sign in again this long before T3 would refuse the key: two days (a quarter of a short-lived key's life),
 * so a key paired from a link is still good for minting the next one even if bruv was off for a while.
 */
const margin = (key: Key) => Math.min(2 * 24 * 60 * 60 * 1000, (key.life ?? 0) / 4);

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
  return { token: body.access_token, expiresAt: Date.now() + seconds * 1000, life: seconds * 1000 };
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

/** A pairing token for a session key. */
async function exchange(origin: string, code: string): Promise<Key> {
  const key = asKey(
    await call(
      `${origin}/oauth/token`,
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
  return { ...key, standard: true };
}

/** A one-time pairing token minted with a session that has `access:write`. No scopes: the standard set. */
export async function mint(origin: string, session: string, scopes: string[], name = label) {
  const body = await call(`${origin}/api/auth/pairing-token`, {
    method: "POST",
    headers: { authorization: `Bearer ${session}`, "content-type": "application/json" },
    body: JSON.stringify({ label: name, ...(scopes.length ? { scopes } : {}) }),
  });
  if (typeof body.credential !== "string") throw new Error("T3 gave no pairing token");
  return body.credential;
}

/** The origin and token in a pairing link (`https://host/pair#token=…`), as `t3 pair` prints it. */
export function readPairingLink(link: string) {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return undefined;
  }
  const token = new URLSearchParams(url.hash.slice(1)).get("token") ?? url.searchParams.get("token");
  return token && /^https?:$/.test(url.protocol) ? { origin: url.origin, token } : undefined;
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
    scope: mcpScopes.join(" "),
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
  // A session from before file links lacks scopes they need.
  if (keys.session && !keys.session.standard) keys = { ...keys, session: undefined };
  const saved = (kind: KeyKind, origin: string) => {
    const key = keys.origin === origin ? keys[kind] : undefined;
    return key && key.expiresAt - margin(key) > Date.now() ? key.token : undefined;
  };
  const save = () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  };
  const signIn = async (kind: KeyKind, place: T3Place) => {
    const key = await (kind === "session" ? exchange(place.origin, await place.pair([], label)) : signInMcp(place));
    keys = { ...(keys.origin === place.origin ? keys : {}), origin: place.origin, [kind]: key };
    save();
    return key.token;
  };
  return {
    /** The T3 paired from a link, if any: its origin, and pairing tokens minted with the session. */
    remote(): T3Place | undefined {
      const origin = keys.remote ? keys.origin : undefined;
      if (!origin) return undefined;
      return {
        origin,
        pair: async (scopes, name) => {
          // The session that is still good, even inside the margin: it mints its own successor.
          const session = keys.session && keys.session.expiresAt > Date.now() ? keys.session.token : undefined;
          if (!session) throw new T3Error(401, "bruv's T3 key ran out; pair again with /web t3 <link>");
          return mint(origin, session, scopes, name);
        },
      };
    },
    /** Pairs with the T3 a link (from `t3 pair`) points to; from then on that T3 is the one used. */
    async pair(link: string) {
      const found = readPairingLink(link);
      if (!found)
        throw new Error("That isn't a pairing link; run `t3 pair` where T3 runs and paste the link it prints.");
      const session = await exchange(found.origin, found.token);
      keys = { origin: found.origin, remote: true, session };
      save();
      return found.origin;
    },
    /** Forgets a T3 paired from a link, to use the one on this machine again. */
    unpair() {
      if (!keys.remote) return false;
      keys = {};
      save();
      return true;
    },
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
