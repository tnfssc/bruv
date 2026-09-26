import { openSync, writeSync, fsyncSync, closeSync, readFileSync, existsSync } from "node:fs";
const argv = process.argv.slice(2);
const [op, port, token, fileArg, ...params] = argv;
const file = op === "offline" && argv.length === 2 ? argv[1] : fileArg;
if (!op || !file) throw Error("usage client.ts offline REPLICA | hello|launch|sync PORT TOKEN REPLICA [id prompt]");
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
    JSON.stringify(
      {
        offline: true,
        connection: "not checked; cached transcript only",
        events: saved.length,
        latest: saved.at(-1),
        transcript: saved,
        fullToolResults: saved.filter((x) => x.type === "tool_execution_end").length,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const base = "http://127.0.0.1:" + port,
  headers = { authorization: "Bearer " + token, "content-type": "application/json" };
async function request(path: string, init?: RequestInit) {
  const r = await fetch(base + path, { ...init, headers, signal: AbortSignal.timeout(2500) });
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
else if (op === "reply")
  console.log(
    JSON.stringify(
      await request("/lab/reply", {
        method: "POST",
        body: JSON.stringify({ questionId: "q1", replyId: params[0], answer: params[1] }),
      }),
    ),
  );
else if (op === "capability") {
  const status = params[0];
  if (status === "granted" && (!process.env.LAB_FIXTURE_FILE || params[2] !== process.env.LAB_FIXTURE_FILE))
    throw Error("only the explicitly configured local fixture file may be read");
  const content = status === "granted" ? (await Bun.file(process.env.LAB_FIXTURE_FILE!).text()).trim() : undefined;
  console.log(
    JSON.stringify(
      await request("/lab/capability-result", {
        method: "POST",
        body: JSON.stringify({ capabilityId: "c1", responseId: params[1], status, content }),
      }),
    ),
  );
} else if (op === "sync") {
  const hello = await request("/hello");
  let cursor = saved.length,
    pages = 0,
    bytes = 0;
  const meta = existsSync(file + ".meta") ? JSON.parse(readFileSync(file + ".meta", "utf8")) : null;
  if (saved.length && !meta) throw Error("replica without meta: explicit reconciliation required");
  if (!Number.isSafeInteger(hello.epoch) || hello.epoch < 1 || typeof hello.identity !== "string" || !hello.identity)
    throw Error("invalid hello identity/epoch");
  if (meta && (meta.identity !== hello.identity || meta.epoch !== hello.epoch))
    throw Error("owner identity/epoch changed: explicit reconciliation required");
  if (!meta) await Bun.write(file + ".meta", JSON.stringify({ identity: hello.identity, epoch: hello.epoch }));
  const fd = openSync(file, "a");
  try {
    for (let i = 0; i < 20; i++) {
      const x = await request(
        "/events?identity=" + encodeURIComponent(hello.identity) + "&epoch=" + hello.epoch + "&cursor=" + cursor,
      );
      if (
        x.identity !== hello.identity ||
        x.epoch !== hello.epoch ||
        !Array.isArray(x.events) ||
        x.events.length > 10 ||
        !Number.isSafeInteger(x.next) ||
        x.next !== cursor + x.events.length ||
        typeof x.hasMore !== "boolean" ||
        !Number.isSafeInteger(x.bytes) ||
        x.bytes < 0 ||
        x.bytes > 30000 ||
        x.bytes !== x.events.reduce((n: number, e: unknown) => n + Buffer.byteLength(JSON.stringify(e)), 0) ||
        x.events.some(
          (e: any, i: number) =>
            !e || e.k !== "event" || e.seq !== cursor + i + 1 || Buffer.byteLength(JSON.stringify(e)) > 20000,
        )
      )
        throw Error("invalid event page identity/epoch/next/caps");
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
