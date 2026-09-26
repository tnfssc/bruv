// Host-side Mac stand-in. Replica is durable without connecting to the owner.
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
export type Event = { v: 1; seq: number; id: string; kind: string; text: string; at: number };
type Replica = { v: 1; cursor: number; events: Event[] };
export class Client {
  replica: Replica;
  metrics = { requests: 0, requestBytes: 0, responseBytes: 0, events: 0 };
  constructor(
    public file: string,
    public url = "http://127.0.0.1:18784",
  ) {
    this.replica = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { v: 1, cursor: 0, events: [] };
    if (this.replica.v !== 1) throw Error("unsupported replica");
  }
  persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + ".tmp", JSON.stringify(this.replica));
    renameSync(this.file + ".tmp", this.file);
  }
  async request(path: string, body?: unknown) {
    const text = body ? JSON.stringify(body) : "";
    this.metrics.requests++;
    this.metrics.requestBytes += new TextEncoder().encode(text).length + new TextEncoder().encode(path).length;
    const response = await fetch(this.url + path, {
      signal: AbortSignal.timeout(10000),
      ...(body ? { method: "POST", headers: { "content-type": "application/json" }, body: text } : {}),
    });
    const result = await response.text();
    this.metrics.responseBytes += new TextEncoder().encode(result).length;
    if (!response.ok) throw Error(response.status + " " + result);
    return JSON.parse(result);
  }
  launch(id: string, spec: "plain" | "needs-mac") {
    return this.request("/launch", { v: 1, id, spec });
  }
  reply(id: string, text: string) {
    return this.request("/reply", { v: 1, id, text });
  }
  async catchup(limit = 10) {
    const page = await this.request("/events?cursor=" + this.replica.cursor + "&limit=" + limit);
    if (
      page.v !== 1 ||
      !Array.isArray(page.events) ||
      page.events.length > limit ||
      typeof page.more !== "boolean" ||
      page.events.some((e: Event, i: number) => e.v !== 1 || e.seq !== this.replica.cursor + i + 1) ||
      page.next !== this.replica.cursor + page.events.length
    )
      throw Error("invalid cursor page");
    this.replica.events.push(...page.events);
    this.replica.cursor = page.next;
    this.metrics.events += page.events.length;
    this.persist();
    return page;
  }
  show() {
    const tasks = new Map<string, { status: string; text: string }>();
    for (const e of this.replica.events) {
      tasks.set(e.id, {
        status:
          e.kind === "accepted"
            ? "running"
            : e.kind === "question"
              ? "waiting"
              : e.kind === "answered"
                ? "running"
                : e.kind === "unknown"
                  ? "unknown"
                  : e.kind === "done"
                    ? "done"
                    : (tasks.get(e.id)?.status ?? "running"),
        text: e.text,
      });
    }
    return {
      cursor: this.replica.cursor,
      tasks: Object.fromEntries(tasks),
      transcript: this.replica.events.map((e) => "#" + e.seq + " " + e.id + " " + e.kind + ": " + e.text),
    };
  }
}
if (import.meta.main) {
  const [cmd, ...args] = Bun.argv.slice(2);
  const file = process.env.LAB_REPLICA ?? "/tmp/die-network-lab-replica.json";
  const c = new Client(file);
  try {
    if (cmd === "offline" || cmd === "status") console.log(JSON.stringify(c.show(), null, 2));
    else if (cmd === "sync") {
      let p;
      do {
        p = await c.catchup();
      } while (p.more);
      console.log(JSON.stringify(c.show(), null, 2));
    } else if (cmd === "launch") console.log(await c.launch(args[0], args[1] as "plain" | "needs-mac"));
    else if (cmd === "reply") console.log(await c.reply(args[0], args[1]));
    else throw Error("commands: offline | sync | launch ID plain|needs-mac | reply ID TEXT");
  } catch (e) {
    console.error(String(e));
    process.exitCode = 1;
  }
}
