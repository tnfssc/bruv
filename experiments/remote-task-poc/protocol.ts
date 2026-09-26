const [port, token] = process.argv.slice(2);
const url = "http://127.0.0.1:" + port;
async function req(path: string, body?: object, auth = token) {
  const r = await fetch(url + path, {
    method: body ? "POST" : "GET",
    signal: AbortSignal.timeout(2500),
    headers: { authorization: "Bearer " + auth, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { code: r.status, value: await r.json() };
}
const check = (yes: boolean, msg: string) => {
  if (!yes) throw Error(msg);
};
check((await req("/hello", undefined, "wrong")).code === 401, "unauthorized handshake");
check(
  (await req("/launch", { v: 2, profile: "fixture", id: "a", prompt: "hi" })).code === 400,
  "version accepted",
);
check(
  (await req("/launch", { v: 1, profile: "missing", id: "a", prompt: "hi" })).code === 400,
  "profile fallback",
);
check((await req("/events?identity=wrong&epoch=1&cursor=0")).code === 409, "identity accepted");
console.log("protocol negative checks PASS");

export {};
