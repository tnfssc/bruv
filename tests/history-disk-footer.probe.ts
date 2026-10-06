/** Standalone provider-free attribution; intentionally not a timing-gate test. */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { installDiskBackedSessionManager, disposeDiskBackedSessionManager } from "../src/history/session-manager";
import { DiskEntryStore } from "../src/history/disk-entry-store";
import { SessionCostTracker } from "../src/tasks/session-costs";
const sha = (x: string | Buffer) => createHash("sha256").update(x).digest("hex");
const root = mkdtempSync(join(tmpdir(), "bruv-disk-footer-profile-"));
const samples: any[] = [], managers: SessionManager[] = [];
function sync<T>(name: string, payloadBytes: number, fn: () => T): T {
  const parses: any[] = [], decodes: any[] = [], materializations: any[] = [];
  const parse = JSON.parse, decode = Buffer.prototype.toString, materialize = DiskEntryStore.prototype.materialize;
  JSON.parse = function(text: string, reviver?: any) {
    const start = performance.now();
    try { return parse(text, reviver); }
    finally { parses.push({ chars: text.length, syncMs: performance.now() - start }); }
  };
  Buffer.prototype.toString = function(...args: any[]) {
    const start = performance.now();
    const result = (decode as any).apply(this, args);
    decodes.push({ bytes: this.length, chars: result.length, syncMs: performance.now() - start });
    return result;
  };
  DiskEntryStore.prototype.materialize = function(meta: any) {
    const cache = (this as any).cache as Map<string, Buffer>;
    const m = typeof meta === "string" ? this.byId.get(meta)! : meta;
    const cacheHit = cache.has(m.offset + ":" + m.length);
    const start = performance.now();
    const result = materialize.call(this, meta);
    materializations.push({ id: m.id, bytes: m.length, cacheHit, syncMs: performance.now() - start });
    return result;
  };
  const start = performance.now();
  try {
    const result = fn();
    samples.push({ name, payloadBytes, syncMs: performance.now() - start, parses, decodes, materializations });
    return result;
  } finally {
    JSON.parse = parse;
    Buffer.prototype.toString = decode;
    DiskEntryStore.prototype.materialize = materialize;
  }
}
try {
  installDiskBackedSessionManager();
  for (const payloadBytes of [2097152, 8388608]) {
    const dir = join(root, String(payloadBytes));
    const parent = SessionManager.create(root, dir); managers.push(parent);
    parent.appendMessage({ role: "user", content: "parent", timestamp: 1 });
    const child = SessionManager.create(root, dir, { parentSession: parent.getSessionFile()! }); managers.push(child);
    child.appendCustomEntry("bruv-agent", { parentSessionFile: parent.getSessionFile() });
    child.appendMessage({ role: "user", content: "run", timestamp: 1 });
    const text = "0123456789abcdef".repeat(payloadBytes / 16);
    child.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "execute", content: [{ type: "text", text }], isError: false, timestamp: 2 });
    child.appendMessage({ role: "user", content: "done", timestamp: 3 });
    const validate = (entries: any[]) => {
      const actual = entries.find(e => e.message?.role === "toolResult").message.content[0].text;
      if (actual !== text) throw new Error("truncated/altered full content");
      return { contentBytes: Buffer.byteLength(actual), contentHash: sha(actual) };
    };
    for (let iteration = 0; iteration < 2; iteration++) {
      const entries = sync("getBranch." + iteration, payloadBytes, () => child.getBranch());
      Object.assign(samples.at(-1), validate(entries));
    }
    const reopened = sync("open", payloadBytes, () => SessionManager.open(child.getSessionFile()!)); managers.push(reopened);
    for (let iteration = 0; iteration < 2; iteration++) {
      const entries = sync("reopened.getBranch." + iteration, payloadBytes, () => reopened.getBranch());
      Object.assign(samples.at(-1), validate(entries));
    }
    const tracker = new SessionCostTracker(parent.getSessionFile()!, dir);
    const consume = (tracker as any).consume;
    (tracker as any).consume = function(session: any, chunk: Buffer) {
      const pendingBytesBefore = session.pendingLength;
      sync("cost.consume", payloadBytes, () => consume.call(this, session, chunk));
      Object.assign(samples.at(-1), { pendingBytesBefore, chunkBytes: chunk.length, pendingBytesAfter: session.pendingLength });
    };
    const start = performance.now();
    const total = await tracker.refresh();
    samples.push({ name: "cost.refresh", payloadBytes, awaitedElapsedMs: performance.now() - start, total });
    if (total !== 0) throw new Error("unexpected cost");
  }
  writeFileSync(process.argv[2]!, JSON.stringify({ runtime: Bun.version, cpu: cpus()[0]?.model,
    sources: Object.fromEntries(["src/history/disk-entry-store.ts", "src/history/session-manager.ts", "src/tasks/session-costs.ts", "tests/history-disk-footer.probe.ts"].map(p => [p, sha(readFileSync(p))])),
    boundary: "instrumented synchronous entry-to-return including wrapper overhead; parse/decode/materialize spans are nested, NOT additive; awaitedElapsedMs is whole async wall time, NOT CPU",
    samples }, null, 2) + "\n");
} finally {
  for (const manager of managers) disposeDiskBackedSessionManager(manager);
  rmSync(root, { recursive: true, force: true });
}
