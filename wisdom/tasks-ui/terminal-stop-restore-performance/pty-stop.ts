/** Provider-free compiled ProcessTerminal shutdown; report writes are outside stop timing. */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { UserMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, Input, ProcessTerminal, ScrollView, TuiAltScreen, VStack } from "@earendil-works/pi-tui";
const reportPath = process.argv[2]!;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const text = "deterministic output row abcdefghijklmnopqrstuvwxyz 0123456789\n".repeat(Math.ceil(2097152 / 61)).slice(0, 2097152);
initTheme("dark", false);
const terminal = new ProcessTerminal();
const tui = new TuiAltScreen(terminal, false, undefined, { mouse: true });
const document = new Container();
document.addChild(new UserMessageComponent("small-session start"));
document.addChild(new UserMessageComponent(text));
const scroll = new ScrollView(document, { follow: "end" });
const input = new Input();
tui.addChild(document);
tui.setLayoutRoot(new VStack([{ component: scroll, grow: 1, minSize: 1 }, { component: input, basis: 1, shrink: 0 }]));
tui.setFocus(input);
tui.start();
tui.renderNow();
// Let only startup protocol/timer work settle; never await within stop timing.
const settleStart = performance.now();
await Bun.sleep(200);
const settleAwaitedMs = performance.now() - settleStart;
let frames = 0, renders = 0, documentLines = 0;
const render = document.render;
document.render = function(width: number) { renders++; const rows = render.call(this, width); documentLines += rows.length; return rows; };
(tui as any).doRender = () => { frames++; throw new Error("unexpected stop frame"); };
const writes: { text: string; syncMs: number }[] = [];
const nativeWrite = terminal.write.bind(terminal);
terminal.write = (text: string) => { const start = performance.now(); nativeWrite(text); writes.push({ text, syncMs: performance.now() - start }); };
writeFileSync(reportPath + ".ready", "ready");
const start = performance.now();
tui.stop();
const stopSyncMs = performance.now() - start;
const restored = writes.find(w => w.text.includes("\x1b[?1049l"))!;
writeFileSync(reportPath + ".restore.bin", restored.text);
writeFileSync(reportPath, JSON.stringify({ runtime: Bun.version, columns: terminal.columns, rows: terminal.rows,
  settleAwaitedMs, stopSyncMs, frames, renders, documentLines, inputHash: sha(text),
  stopWrites: writes.map(w => ({ syncMs: w.syncMs, bytes: Buffer.byteLength(w.text), hash: sha(w.text) })),
  restoreBytes: Buffer.byteLength(restored.text), restoreHash: sha(restored.text),
  rawAfterStop: process.stdin.isRaw, boundary: "each sync stop/write is entry-to-return; settleAwaitedMs is NOT synchronous work"
}, null, 2) + "\n");
