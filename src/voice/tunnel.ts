/**
 * Cloudflare Tunnel setup: gives the voice page a public https address on the user's own domain.
 * An API token sets everything up; a tunnel token from the dashboard is used as it is.
 */

const api = "https://api.cloudflare.com/client/v4";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** The API token needs Account › Cloudflare Tunnel › Edit, Zone › DNS › Edit and Zone › Zone › Read. */
export const permissions = "Account › Cloudflare Tunnel › Edit, Zone › DNS › Edit and Zone › Zone › Read";

/** A tunnel token is base64 JSON naming the account, the tunnel and its secret. */
export function isTunnelToken(key: string) {
  try {
    const data = JSON.parse(Buffer.from(key, "base64").toString("utf8"));
    return typeof data?.a === "string" && typeof data?.t === "string";
  } catch {
    return false;
  }
}

/** A host name like voice.example.com, without a scheme or path. */
export function cleanHost(input: string) {
  const host = input
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host) ? host : undefined;
}

async function request<T>(fetch: Fetch, key: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    result?: T;
    errors?: { message: string }[];
  };
  if (!response.ok || !json.success) {
    const why = json.errors?.map((error) => error.message).join("; ") || `HTTP ${response.status}`;
    throw new Error(`Cloudflare said: ${why}`);
  }
  return json.result as T;
}

type Zone = { id: string; name: string; account: { id: string } };

/**
 * Makes `host` lead to `origin` through a tunnel named after the host, and returns the token cloudflared
 * runs it with. Safe to run again: it reuses the tunnel and record and points the tunnel at the new origin.
 * It never replaces a DNS record it did not make.
 */
export async function prepare(key: string, host: string, origin: string, fetch: Fetch = globalThis.fetch) {
  if (isTunnelToken(key)) return key;
  const call = <T>(method: string, path: string, body?: unknown) => request<T>(fetch, key, method, path, body);
  // The zone is the longest suffix of the host that the token can see.
  const labels = host.split(".");
  let zone: Zone | undefined;
  for (let at = 0; !zone && at < labels.length - 1; at++) {
    const name = labels.slice(at).join(".");
    [zone] = await call<Zone[]>("GET", `/zones?name=${encodeURIComponent(name)}`);
  }
  if (!zone) throw new Error(`This Cloudflare token can't see a zone for ${host}.`);
  const account = zone.account.id;
  const name = `bruv-voice-${host}`;
  const [found] = await call<{ id: string }[]>(
    "GET",
    `/accounts/${account}/cfd_tunnel?is_deleted=false&name=${encodeURIComponent(name)}`,
  );
  const id =
    found?.id ??
    (await call<{ id: string }>("POST", `/accounts/${account}/cfd_tunnel`, { name, config_src: "cloudflare" })).id;
  await call("PUT", `/accounts/${account}/cfd_tunnel/${id}/configurations`, {
    config: { ingress: [{ hostname: host, service: origin }, { service: "http_status:404" }] },
  });
  const target = `${id}.cfargotunnel.com`;
  const [record] = await call<{ content: string }[]>(
    "GET",
    `/zones/${zone.id}/dns_records?name=${encodeURIComponent(host)}`,
  );
  if (!record) {
    await call("POST", `/zones/${zone.id}/dns_records`, { type: "CNAME", name: host, content: target, proxied: true });
  } else if (record.content !== target) {
    throw new Error(`${host} already has a DNS record. Pick another host, or delete that record first.`);
  }
  return call<string>("GET", `/accounts/${account}/cfd_tunnel/${id}/token`);
}
