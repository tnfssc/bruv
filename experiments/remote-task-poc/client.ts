import { openSync, writeSync, fsyncSync, closeSync, readFileSync, existsSync } from "node:fs";
const [op, port, token, file, ...params] = process.argv.slice(2);
if (!op || !file) throw Error("usage client.ts hello|launch|sync|offline PORT TOKEN REPLICA [id prompt]");
const replica = () =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((s) => JSON.parse(s))
    : [];
const saved = replica();
if (op === "offline") {
  console.log(
    JSON.stringify({
      offline: true,
      events: saved.length,
      latest: saved.at(-1),
      fullToolResults: saved.filter((x) => x.type === "tool_execution_end").length,
    }),
  );
  process.exit(0);
}
const base = "http://127.0.0.1:" + port,
  headers = { authorization: "Bearer " + token, "content-type": "application/json" };
async function request(path: string, init?: RequestInit) {
  const r = await fetch(base + path, { ...init, headers });
  const x = await r.json();
  if (!r.ok) throw Error(r.status + " " + JSON.stringify(x));
  return x;
}
if (op === "hello") console.log(JSON.stringify(await request("/hello")));
else if (op === "launch")
  console.log(
    JSON.stringify(
      await request("/launch", {
        method: "POST",
        body: JSON.stringify({ v: 1, profile: "fixture", id: params[0], prompt: params[1] }),
      }),
    ),
  );
else if (op === "sync") {
  const hello = await request("/hello");
  let cursor = saved.length,
    pages = 0,
    bytes = 0;
  const meta = existsSync(file + ".meta") ? JSON.parse(readFileSync(file + ".meta", "utf8")) : null;
  if (meta && (meta.identity !== hello.identity || meta.epoch !== hello.epoch))
    throw Error("owner identity/epoch changed: explicit reconciliation required");
  if (!meta)
    await Bun.write(file + ".meta", JSON.stringify({ identity: hello.identity, epoch: hello.epoch }));
  const fd = openSync(file, "a");
  try {
    for (let i = 0; i < 20; i++) {
      const x = await request(
        "/events?identity=" +
          encodeURIComponent(hello.identity) +
          "&epoch=" +
          hello.epoch +
          "&cursor=" +
          cursor,
      );
      if (x.events.length === 0 && x.hasMore) throw Error("stalled page");
      for (const e of x.events) {
        if (e.seq !== cursor + 1) throw Error("noncontiguous event");
        writeSync(fd, JSON.stringify(e) + "\n");
        fsyncSync(fd);
        cursor++;
      }
      pages++;
      bytes += x.bytes;
      if (!x.hasMore) {
        console.log(JSON.stringify({ phase: x.phase, cursor, pages, bytes }));
        break;
      }
    }
  } finally {
    closeSync(fd);
  }
} else throw Error("unknown operation");
