/** Provider-free audit: synchronous public journal calls and alternate-screen stop.
 * No timing gate; run with: bun scripts/terminal-perf/audit-probes/journal-stop.ts [output.json]
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, cpus } from "node:os";
import { join } from "node:path";
import { SessionManager, UserMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, Input, ScrollView, TuiAltScreen, VStack } from "@earendil-works/pi-tui";
import { installDiskBackedSessionManager, disposeDiskBackedSessionManager } from "../../../src/history/session-manager";
import { DiskEntryStore } from "../../../src/history/disk-entry-store";
import { FakeTerminal } from "../workloads";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const root = mkdtempSync(join(tmpdir(), "bruv-stall-audit-"));
const samples: any[] = [];
let reads = 0, parsedBytes = 0;
const nativeMaterialize = DiskEntryStore.prototype.materialize;
DiskEntryStore.prototype.materialize = function(meta: any) {
  const metadata = typeof meta === "string" ? this.byId.get(meta)! : meta;
  reads++; parsedBytes += metadata.length;
  return nativeMaterialize.call(this, meta);
};
function segment(name: string, run: () => any, fingerprint: object, summarize: (value: any) => object) {
  reads = parsedBytes = 0;
  const start = performance.now();
  const value = run(); // Never await inside this timed boundary.
  const syncMs = performance.now() - start;
  samples.push({ name, syncMs, materializeCalls: reads, parsedBytes, ...fingerprint, ...summarize(value) });
  return value;
}
const body = (bytes: number) => ("deterministic output row abcdefghijklmnopqrstuvwxyz 0123456789\n").repeat(Math.ceil(bytes / 61)).slice(0, bytes);
const canonicalMessages = (messages: any[]) => messages.map(m => ({ role: m.role, content: m.content }));
const messagesSummary = (messages: any[]) => ({ messages: messages.length, contentHash: sha(JSON.stringify(canonicalMessages(messages))) });
const managers: SessionManager[] = [];
try {
  installDiskBackedSessionManager();
  for (const payloadBytes of [4096, 262144, 2097152, 8388608]) {
    const text = body(payloadBytes);
    const fingerprint = { payloadBytes, inputHash: sha(text), fixture: "two-user-one-tool-result-v1" };
    const manager = SessionManager.create(root, join(root, String(payloadBytes)));
    managers.push(manager);
    manager.appendMessage({ role: "user", content: "run the deterministic fixture", timestamp: 1 });
    segment("journal.appendMessage.toolResult", () => manager.appendMessage({ role: "toolResult", toolCallId: "audit-tool", toolName: "execute", content: [{ type: "text", text }], isError: false, timestamp: 2 }), fingerprint, () => ({ entriesAdded: 1 }));
    manager.appendMessage({ role: "user", content: "summarize the result", timestamp: 3 });
    for (let iteration = 0; iteration < 5; iteration++) {
      const fp = { ...fingerprint, iteration, state: iteration ? "repeated-byte-cache-not-parsed-object-cache" : "first-read-after-append" };
      segment("journal.getBranch", () => manager.getBranch(), fp, entries => messagesSummary(entries.filter((e: any) => e.type === "message").map((e: any) => e.message)));
      segment("journal.buildSessionProjection", () => manager.buildSessionProjection(), fp, projection => messagesSummary(projection.messages));
    }
    const reopened = segment("journal.open", () => SessionManager.open(manager.getSessionFile()!), fingerprint, value => ({ entries: value.getEntryCount() }));
    managers.push(reopened);
    segment("journal.reopened.getBranch", () => reopened.getBranch(), fingerprint, entries => messagesSummary(entries.filter((e: any) => e.type === "message").map((e: any) => e.message)));
  }
  initTheme("dark", false);
  for (const payloadBytes of [4096, 65536, 262144, 2097152]) {
    for (let iteration = 0; iteration < 3; iteration++) {
      const text = body(payloadBytes);
      const terminal = new FakeTerminal(100, 32);
      const tui = new TuiAltScreen(terminal, false, undefined, { mouse: false });
      const document = new Container();
      document.addChild(new UserMessageComponent("small-session start"));
      document.addChild(segment("sdk.UserMessageComponent.construct", () => new UserMessageComponent(text), { payloadBytes, iteration, inputHash: sha(text), fixture: "two-native-user-messages-100x32-v1" }, () => ({ componentsCreated: 1 })));
      const scroll = new ScrollView(document, { follow: "end" });
      const input = new Input();
      tui.addChild(document);
      tui.setLayoutRoot(new VStack([{ component: scroll, grow: 1, minSize: 1 }, { component: input, basis: 1, shrink: 0 }]));
      tui.setFocus(input);
      let documentRenders = 0, documentLines = 0, insideDoRender = false;
      const render = document.render;
      document.render = function(width) { documentRenders++; const result = render.call(this, width); documentLines += result.length; return result; };
      const nativeFrame = (tui as any).doRender;
      let frames = 0;
      (tui as any).doRender = function() { frames++; insideDoRender = true; try { return nativeFrame.call(this); } finally { insideDoRender = false; } };
      tui.start();
      tui.renderNow(); // setup frame is not the stop measurement
      terminal.takeOutput();
      documentRenders = documentLines = frames = 0;
      segment("terminal.stop.restore", () => tui.stop(), { payloadBytes, iteration, inputHash: sha(text), fixture: "two-native-user-messages-100x32-v1" }, () => {
        const { output, writes } = terminal.takeOutput();
        if (!output.includes(text.split("\n")[0]!)) throw new Error("stop did not restore fixture text");
        if (insideDoRender || frames !== 0 || documentRenders !== 1) throw new Error("stop boundary changed");
        return { frames, documentRenders, documentLines, outputWrites: writes, outputBytes: Buffer.byteLength(output), outputHash: sha(output) };
      });
    }
  }
  const sourceFiles = ["scripts/terminal-perf/audit-probes/journal-stop.ts", "src/history/session-manager.ts", "src/history/disk-entry-store.ts", "node_modules/@earendil-works/pi-tui/dist/tui.js", "node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js"];
  const report = { version: 1, sourceCommit: Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim(), runtime: Bun.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, sourceHashes: Object.fromEntries(sourceFiles.map(path => [path, sha(readFileSync(path))])), boundary: "sync entry-to-return elapsed; no provider, scheduler or awaited time included; GC/OS preemption possible", samples };
  const output = process.argv[2] ?? "artifacts/terminal-perf/audit-journal-stop.json";
  await Bun.write(output, JSON.stringify(report, null, 2) + "\n");
  console.log(output);
  for (const name of new Set(samples.map(s => s.name))) for (const payloadBytes of new Set(samples.filter(s => s.name === name).map(s => s.payloadBytes))) {
    const rows = samples.filter(s => s.name === name && s.payloadBytes === payloadBytes);
    console.log(name, payloadBytes, rows.map(s => s.syncMs.toFixed(3)).join(", "));
  }
} finally {
  DiskEntryStore.prototype.materialize = nativeMaterialize;
  for (const manager of managers) disposeDiskBackedSessionManager(manager);
  rmSync(root, { recursive: true, force: true });
}
