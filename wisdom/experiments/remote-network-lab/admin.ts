const admin = "http://127.0.0.1:18785";
export async function control(path: string, method = "POST", body?: unknown) {
  const r = await fetch(admin + path, {
    method,
    signal: AbortSignal.timeout(10000),
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw Error(method + " " + path + " " + r.status + " " + (await r.text()));
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}
