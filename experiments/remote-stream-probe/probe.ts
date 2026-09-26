import http from "node:http";
import os from "node:os";
import { Log, Notices, Replica, PAGE_BYTES, PAGE_EVENTS, type Event, type Kind } from "./core.ts";
const sleep = (n: number) => new Promise<void>((r) => setTimeout(r, n));
type Mode = "poll" | "notify" | "direct";
type Row = {
  variant: string;
  mode: Mode;
  tasks: number;
  eachWayMs: number;
  batchMs: number;
  events: number;
  requests: number;
  requestBytes: number;
  responseBytes: number;
  frames: number;
  latencyMs: Record<string, { min: number; median: number; max: number; n: number }>;
  peakQueueBytes: number;
  gap: boolean;
  unavailable: boolean;
  catchupPages: number;
  elapsedMs: number;
  maxPageBytes: number;
  maxPageEvents: number;
};
async function run(
  mode: Mode,
  tasks: number,
  eachWayMs: number,
  batchMs: number,
  variant: "normal" | "burst" | "reconnect" = "normal",
): Promise<Row> {
  const log = new Log(2 * 1024 * 1024),
    q = new Notices(4096);
  let replica: Replica | undefined;
  let wake: (() => void) | undefined;
  let flush: ReturnType<typeof setTimeout> | undefined;
  let frames = 0,
    requests = 0,
    requestBytes = 0,
    responseBytes = 0,
    catchupPages = 0,
    maxPageBytes = 0,
    maxPageEvents = 0,
    gap = false,
    unavailable = false;
  const lat: Record<string, number[]> = {
    acceptance: [],
    progress: [],
    question: [],
    result: [],
    transcript: [],
  };
  const publish = (e: Event) => {
    q.push(e);
    if (wake) {
      const w = wake;
      wake = undefined;
      w();
    }
  };
  const emit = (kind: Kind, text = "x") => {
    for (let t = 0; t < tasks; t++) {
      const e = log.add(t, kind, text);
      if (mode === "notify") {
        if (kind !== "progress" || batchMs === 0) {
          if (flush) {
            clearTimeout(flush);
            flush = undefined;
          }
          publish(e);
        } else {
          q.push(e);
          if (!flush)
            flush = setTimeout(() => {
              flush = undefined;
              if (wake) {
                const w = wake;
                wake = undefined;
                w();
              }
            }, batchMs);
        }
      }
      if (mode === "direct") {
        if (wake) {
          const w = wake;
          wake = undefined;
          w();
        }
      }
    }
  };
  const server = http.createServer(async (req, res) => {
    try {
      await sleep(eachWayMs); // loopback impairment: per-direction propagation delay, not TCP shaping
      const url = new URL(req.url ?? "/", "http://localhost");
      let body: unknown;
      if (url.pathname === "/hello") body = { epoch: log.epoch, cursor: 0 };
      else if (url.pathname === "/notify") {
        if (!q.entries.length && !q.gap)
          await Promise.race([
            new Promise<void>((r) => {
              wake = r;
            }),
            sleep(120),
          ]);
        body = q.drain();
      } else if (url.pathname === "/page") {
        body = log.page(Number(url.searchParams.get("cursor")), url.searchParams.get("epoch") ?? "");
      } else {
        const cursor = Number(url.searchParams.get("cursor")),
          epoch = url.searchParams.get("epoch") ?? "";
        if (url.pathname === "/direct" && epoch === log.epoch && cursor === log.cursor)
          await Promise.race([
            new Promise<void>((r) => {
              wake = r;
            }),
            sleep(120),
          ]);
        body = log.page(cursor, epoch);
      }
      if (url.pathname === "/poll" || url.pathname === "/page" || url.pathname === "/direct") {
        const p = body as { events: Event[] };
        maxPageBytes = Math.max(maxPageBytes, Buffer.byteLength(JSON.stringify(p)));
        maxPageEvents = Math.max(maxPageEvents, p.events.length);
      }
      const data = JSON.stringify(body);
      await sleep(eachWayMs);
      if (!res.destroyed) {
        res.setHeader("content-type", "application/json");
        res.end(data);
        frames++;
        responseBytes += Buffer.byteLength(data);
      }
    } catch (e) {
      res.destroy(e as Error);
    }
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("listen failed");
  const base = `http://127.0.0.1:` + address.port;
  const get = async (path: string): Promise<any> => {
    requests++;
    requestBytes += Buffer.byteLength(path);
    const res = await fetch(base + path, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw Error(String(res.status));
    return res.json();
  };
  const ingest = (events: Event[]) => {
    replica!.apply(events);
    for (const e of events) lat[e.kind].push(performance.now() - e.created);
  };
  const page = async (path: string) => {
    const p = await get(path + "?cursor=" + replica!.cursor + "&epoch=" + replica!.epoch);
    if (p.unavailable) {
      unavailable = true;
      return p;
    }
    if (p.epoch !== replica!.epoch || p.cursor !== (p.events.at(-1)?.cursor ?? replica!.cursor))
      throw Error("invalid page");
    ingest(p.events);
    if (p.more && !p.events.length) throw Error("non-advancing page");
    return p;
  };
  const catchup = async (target?: number) => {
    let more: boolean;
    do {
      catchupPages++;
      const p = await page("/page");
      more = !p.unavailable && (p.more || (target !== undefined && replica!.cursor < target));
      if (more && !p.events.length) throw Error("non-advancing catchup");
    } while (more);
  };
  const start = performance.now();
  const timers = [
    setTimeout(() => emit("acceptance"), 10),
    setTimeout(() => emit("progress"), 100),
    setTimeout(() => emit("question"), variant === "burst" ? 120 : 220),
    setTimeout(() => emit("result"), 460),
  ];
  if (variant === "burst") for (let i = 1; i <= 12; i++) timers.push(setTimeout(() => emit("progress"), 100 + i * 3));
  if (variant === "reconnect")
    for (let i = 0; i < 128; i++) timers.push(setTimeout(() => emit("transcript", "z".repeat(4096)), 120 + i));
  const expected = tasks * (variant === "burst" ? 16 : variant === "reconnect" ? 132 : 4);
  try {
    const hello = await get("/hello");
    if (hello.cursor !== 0) throw Error("unexpected handshake cursor");
    replica = new Replica(hello.epoch);
    const deadline = start + Math.max(2200, eachWayMs * 16 + 2200);
    while (performance.now() < deadline && replica.cursor < expected && !unavailable) {
      if (mode === "poll" || mode === "direct") {
        const p = await page(mode === "poll" ? "/poll" : "/direct");
        if (p.more) await catchup();
        if (mode === "poll" && replica.cursor < expected) await sleep(25);
      } else {
        const n = await get("/notify");
        if (n.gap) gap = true;
        if (n.gap || (n.highwater !== undefined && n.highwater > replica.cursor)) await catchup(n.highwater);
        if (variant === "reconnect" && replica.cursor < expected) await sleep(550);
      }
    }
    if (replica.cursor < expected && !unavailable) await catchup(); // deadline diagnostic, not normal flow control
    const summary: Row = {
      variant,
      mode,
      tasks,
      eachWayMs,
      batchMs,
      events: replica.cursor,
      requests,
      requestBytes,
      responseBytes,
      frames,
      latencyMs: Object.fromEntries(
        Object.entries(lat)
          .filter(([, v]) => v.length)
          .map(([k, v]) => {
            v.sort((a, b) => a - b);
            return [
              k,
              {
                min: +v[0]!.toFixed(1),
                median: +v[Math.floor(v.length / 2)]!.toFixed(1),
                max: +v.at(-1)!.toFixed(1),
                n: v.length,
              },
            ];
          }),
      ),
      peakQueueBytes: q.peak,
      gap,
      unavailable,
      catchupPages,
      maxPageBytes,
      maxPageEvents,
      elapsedMs: Math.round(performance.now() - start),
    };
    return summary;
  } finally {
    timers.forEach(clearTimeout);
    if (flush) clearTimeout(flush);
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}
const rows: Row[] = [];
for (const delay of [0, 100, 300])
  for (const mode of ["poll", "notify", "direct"] as const) rows.push(await run(mode, 1, delay, 0));
for (const tasks of [100, 1000]) {
  rows.push(await run("poll", tasks, 0, 0));
  rows.push(await run("notify", tasks, 0, 0));
  rows.push(await run("direct", tasks, 0, 0));
}
for (const batch of [0, 10, 40]) rows.push(await run("notify", 1, 0, batch, "burst"));
rows.push(await run("notify", 1, 0, 0, "reconnect"));
console.log(
  JSON.stringify(
    {
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus().length,
        impairment: "loopback application per-direction delay (no bandwidth shaping)",
        sampleCount: 1,
      },
      limits: {
        queueBytes: 4096,
        retentionBytes: 2 * 1024 * 1024,
        pageEvents: PAGE_EVENTS,
        pageBytes: PAGE_BYTES,
        taskDurationMs: 460,
      },
      rows,
    },
    null,
    2,
  ),
);
