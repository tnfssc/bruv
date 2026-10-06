/** Research replay of exact restore transforms; phase timing isn't a stop latency gate. */
import { createHash } from "node:crypto";
import { UserMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, CURSOR_MARKER, Input, ScrollView, TuiAltScreen, VStack, sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { isImageLine } from "../../../node_modules/@earendil-works/pi-tui/dist/terminal-image.js";
import { FakeTerminal } from "../../../scripts/terminal-perf/workloads";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const zonePrefix = /^(?:\x1b\]133;[ABC](?:\x07|\x1b\\))+/;
const samples: any[] = [];
initTheme("dark", false);
const repeated = "deterministic output row abcdefghijklmnopqrstuvwxyz 0123456789\n".repeat(Math.ceil(2097152 / 61)).slice(0, 2097152);
const unique = Array.from({ length: 40000 }, (_, i) => String(i).padStart(8, "0") + " output row abcdefghijklmnopqrstuvwxyz 0123456789\n").join("").slice(0, 2097152);
for (const [fixture, text] of [["audit-repeated", repeated], ["unique-row-counter", unique]]) {
  const terminal = new FakeTerminal(100, 32);
  const tui = new TuiAltScreen(terminal, false, undefined, { mouse: false }) as any;
  const document = new Container();
  document.addChild(new UserMessageComponent("small-session start"));
  document.addChild(new UserMessageComponent(text));
  const scroll = new ScrollView(document, { follow: "end" });
  const input = new Input();
  tui.addChild(document);
  tui.setLayoutRoot(new VStack([{ component: scroll, grow: 1, minSize: 1 }, { component: input, basis: 1, shrink: 0 }]));
  tui.setFocus(input);
  tui.start(); tui.renderNow(); terminal.takeOutput();
  let expectedHash = "";
  for (let iteration = 0; iteration < 3; iteration++) for (const variant of ["before", "consecutive"]) {
    const phases: any = {};
    function phase<T>(name: string, run: () => T): T {
      const start = performance.now(); const result = run(); phases[name] = performance.now() - start; return result;
    }
    const raw: string[] = phase("renderMs", () => tui.render(100));
    let rows: string[];
    let misses = raw.length;
    if (variant === "before") {
      const stripped = phase("stripMs", () => raw.map(line => line.replace(zonePrefix, "")).map(line => line.replaceAll(CURSOR_MARKER, "")));
      rows = phase("normalizeMs", () => tui.applyLineResets(stripped));
      rows = phase("imageWidthClipMs", () => rows.map(line => isImageLine(line) || visibleWidth(line) <= 100 ? line : sliceByColumn(line, 0, 100, true)));
    } else {
      let previousLine: string | undefined, previousRestored: string | undefined;
      misses = 0; phases.normalizeMs = 0; phases.imageWidthClipMs = 0;
      rows = phase("transformInclusiveMs", () => raw.map(line => {
        if (line === previousLine) return previousRestored!;
        let restored: string;
        misses++;
        const stripped = line.replace(zonePrefix, "").replaceAll(CURSOR_MARKER, "");
        let start = performance.now(); restored = tui.applyLineResets([stripped])[0]; phases.normalizeMs += performance.now() - start;
        start = performance.now();
        if (!isImageLine(restored) && visibleWidth(restored) > 100) restored = sliceByColumn(restored, 0, 100, true);
        phases.imageWidthClipMs += performance.now() - start;
        previousLine = line; previousRestored = restored; return restored;
      }));
      phases.stripCacheAndLoopResidualMs = phases.transformInclusiveMs - phases.normalizeMs - phases.imageWidthClipMs;
    }
    const buffer = phase("assembleMs", () => {
      let buffer = "\x1b[?2026h\x1b[?1049l\x1b[?7l";
      for (let row = 0; row < rows.length; row++) {
        if (row > 0) buffer += "\r\n";
        buffer += "\r\x1b[2K" + (rows[row] ?? "");
      }
      return buffer + "\x1b[0m\x1b[?7h\r\n\x1b[?25h\x1b[?2026l";
    });
    phase("countingWriteMs", () => terminal.write(buffer));
    const output = terminal.takeOutput();
    const hash = sha(output.output);
    if (expectedHash && hash !== expectedHash) throw Error("replay output mismatch");
    expectedHash = hash;
    samples.push({ fixture, variant, iteration, inputBytes: Buffer.byteLength(text!), inputHash: sha(text!), documentLines: raw.length,
      distinctRawLines: new Set(raw).size, transformedRows: misses, outputBytes: Buffer.byteLength(output.output), outputHash: hash, phases });
  }
  // Check the replay's bytes against the actual patched stop output.
  tui.stop();
  const stopped = terminal.takeOutput().output;
  const begin = stopped.indexOf("\x1b[?2026h\x1b[?1049l\x1b[?7l");
  if (sha(stopped.slice(begin)) !== expectedHash) throw Error("actual stop mismatch");
}
await Bun.write(process.argv[2] ?? "/tmp/stop-stages.json", JSON.stringify({ runtime: Bun.version,
  boundary: "serial extracted sync phases; no await in phases; cache timers on misses add instrumentation overhead; counting write has no PTY/backpressure", samples }, null, 2) + "\n");
