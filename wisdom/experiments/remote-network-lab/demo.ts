import { Client } from "./client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { control } from "./admin";
async function reset() {
  await control("/proxies/owner/toxics", "GET").then(async (xs: any[]) => {
    for (const x of xs) await control("/proxies/owner/toxics/" + x.name, "DELETE");
  });
  await control("/proxies/owner", "POST", { enabled: true });
}
const sleep = (n: number) => new Promise((r) => setTimeout(r, n));
const now = () => performance.now();
const dir = mkdtempSync(join(tmpdir(), "die-network-lab-"));
const run = Date.now().toString(36);
async function syncUntil(c: Client, id: string, kind: string, limit = 10) {
  let count = 0;
  while (count++ < 60) {
    const page = await c.catchup(limit);
    if (c.replica.events.some((e) => e.id === id && e.kind === kind)) return;
    if (!page.more) await sleep(25);
  }
  throw Error("timeout " + kind);
}
async function caseRun(label: string, delay: number, bandwidth = 0) {
  await reset();
  if (delay) {
    for (const [side, stream] of [
      ["up", "upstream"],
      ["down", "downstream"],
    ])
      await control("/proxies/owner/toxics", "POST", {
        name: side,
        type: "latency",
        stream,
        attributes: { latency: delay, jitter: 0 },
      });
  }
  if (bandwidth)
    for (const [side, stream] of [
      ["bwu", "upstream"],
      ["bwd", "downstream"],
    ])
      await control("/proxies/owner/toxics", "POST", {
        name: side,
        type: "bandwidth",
        stream,
        attributes: { rate: bandwidth },
      });
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const id = run + "-" + label + "-" + i,
      c = new Client(join(dir, id + ".json"));
    c.replica.cursor = (await c.request("/head")).cursor;
    c.persist();
    c.metrics = { requests: 0, requestBytes: 0, responseBytes: 0, events: 0 };
    const t = now();
    await c.launch(id, "plain");
    const acceptance = now() - t;
    await syncUntil(c, id, "progress");
    const progress = now() - t;
    await syncUntil(c, id, "done");
    const completion = now() - t;
    const offline = new Client(c.file).show();
    if (offline.tasks[id]?.status !== "done") throw Error("offline failed");
    samples.push({
      acceptanceMs: Math.round(acceptance),
      progressMs: Math.round(progress),
      completionMs: Math.round(completion),
      ...c.metrics,
    });
  }
  return { label, injectedOneWayMs: delay, bandwidthKiBPerSecond: bandwidth, samples };
}
async function bandwidthProbe() {
  const samples = [];
  for (const rate of [0, 8]) {
    await reset();
    if (rate)
      await control("/proxies/owner/toxics", "POST", {
        name: "bulk-bandwidth",
        type: "bandwidth",
        stream: "downstream",
        attributes: { rate },
      });
    const t = now();
    const r = await fetch("http://127.0.0.1:18784/payload", { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Error("payload request failed");
    const bytes = (await r.arrayBuffer()).byteLength;
    if (bytes !== 16384) throw Error("payload truncated");
    samples.push({ rateKiBPerSecond: rate, bodyBytes: bytes, elapsedMs: Math.round(now() - t) });
  }
  await reset();
  return samples;
}
async function invariants() {
  await reset();
  const id = run + "-detach",
    a = new Client(join(dir, "detach.json"));
  a.replica.cursor = (await a.request("/head")).cursor;
  a.persist();
  // Deliberately discard acceptance response. Retry stable ID via new client, even if original UI went away.
  const response = await fetch(a.url + "/launch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ v: 1, id, spec: "needs-mac" }),
  });
  if (!response.ok) throw Error("initial launch failed");
  const retry = new Client(a.file);
  const duplicate = await retry.launch(id, "needs-mac");
  if (!duplicate.replayed) throw Error("dedup failed");
  let conflict = false;
  try {
    await retry.launch(id, "plain");
  } catch {
    conflict = true;
  }
  if (!conflict) throw Error("ID conflict allowed");
  await sleep(650); // UI disconnected: remote owner continues up to its Mac-only dependency.
  await syncUntil(retry, id, "question", 1);
  const offline = new Client(a.file).show();
  if (offline.tasks[id]?.status !== "waiting") throw Error("question not durable");
  await retry.reply(id, "fixture");
  const replyDuplicate = await retry.reply(id, "fixture");
  if (!replyDuplicate.replayed) throw Error("reply not deduplicated");
  await sleep(500);
  await syncUntil(retry, id, "done", 1);
  const events = retry.replica.events.filter((x) => x.id === id);
  if (events.filter((x) => x.kind === "accepted").length !== 1 || events.filter((x) => x.kind === "done").length !== 1)
    throw Error("duplicate event");
  // Proxy outage after acceptance, owner proceeds; offline transcript still readable.
  const b = new Client(join(dir, "outage.json")),
    other = run + "-outage";
  b.replica.cursor = (await b.request("/head")).cursor;
  b.persist();
  await b.launch(other, "plain");
  await syncUntil(b, other, "accepted", 1);
  await control("/proxies/owner", "POST", { enabled: false });
  await sleep(650);
  let failed = false;
  try {
    await b.catchup();
  } catch {
    failed = true;
  }
  if (!failed) throw Error("proxy outage not observed");
  const offlineDuringOutage = new Client(b.file).show();
  await control("/proxies/owner", "POST", { enabled: true });
  const t = now();
  await syncUntil(b, other, "done", 1);
  const catchupMs = Math.round(now() - t);
  return {
    discardedResponseRetry: duplicate.replayed,
    questionOfflineStatus: offline.tasks[id].status,
    questionEvents: events.map((x) => x.kind),
    outageFailed: failed,
    offlineDuringOutage,
    cursor: b.replica.cursor,
    reconnectCatchupMs: catchupMs,
    slowPageMetrics: b.metrics,
  };
}
try {
  const results = [];
  for (const [label, ms, rate] of [
    ["baseline", 0, 0],
    ["latency100", 100, 0],
    ["latency300", 300, 0],
    ["bandwidth1KiB", 0, 1],
  ] as const)
    results.push(await caseRun(label, ms, rate));
  const bandwidthTransfer = await bandwidthProbe();
  const checks = await invariants();
  console.log(
    JSON.stringify({ v: 1, simulated: true, host: "Linux Mac stand-in", results, bandwidthTransfer, checks }, null, 2),
  );
} finally {
  await reset().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
