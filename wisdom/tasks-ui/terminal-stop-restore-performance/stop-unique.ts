/** Matched serial counterprobe: actual synchronous stop with mostly distinct lines. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { UserMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, Input, ScrollView, TuiAltScreen, VStack } from "@earendil-works/pi-tui";
import { FakeTerminal } from "../../../scripts/terminal-perf/workloads";
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const samples: Record<string, unknown>[] = [];
function segment<T>(name: string, run: () => T, fingerprint: object, summarize: (value: T) => object) {
  const start = performance.now();
  const value = run();
  const syncMs = performance.now() - start;
  samples.push({ name, syncMs, ...fingerprint, ...summarize(value) });
  return value;
}
initTheme("dark", false);
for (const payloadBytes of [2097152]) {
  for (let iteration = 0; iteration < 3; iteration++) {
    const text = Array.from(
      { length: 40000 },
      (_, i) => `${String(i).padStart(8, "0")} output row abcdefghijklmnopqrstuvwxyz 0123456789\n`,
    )
      .join("")
      .slice(0, payloadBytes);
    const terminal = new FakeTerminal(100, 32);
    const tui = new TuiAltScreen(terminal, false, undefined, { mouse: false });
    const document = new Container();
    document.addChild(new UserMessageComponent("small-session start"));
    document.addChild(
      segment(
        "sdk.UserMessageComponent.construct",
        () => new UserMessageComponent(text),
        { payloadBytes, iteration, inputHash: sha(text), fixture: "two-native-unique-user-messages-100x32-v1" },
        () => ({ componentsCreated: 1 }),
      ),
    );
    const scroll = new ScrollView(document, { follow: "end" });
    const input = new Input();
    tui.addChild(document);
    tui.setLayoutRoot(
      new VStack([
        { component: scroll, grow: 1, minSize: 1 },
        { component: input, basis: 1, shrink: 0 },
      ]),
    );
    tui.setFocus(input);
    let documentRenders = 0,
      documentLines = 0,
      insideDoRender = false;
    const render = document.render;
    document.render = function (width) {
      documentRenders++;
      const result = render.call(this, width);
      documentLines += result.length;
      return result;
    };
    const frameHook = tui as unknown as { doRender(): void };
    const nativeFrame = frameHook.doRender;
    let frames = 0;
    frameHook.doRender = function () {
      frames++;
      insideDoRender = true;
      try {
        return nativeFrame.call(this);
      } finally {
        insideDoRender = false;
      }
    };
    tui.start();
    tui.renderNow(); // setup frame is not the stop measurement
    terminal.takeOutput();
    documentRenders = documentLines = frames = 0;
    segment(
      "terminal.stop.restore",
      () => tui.stop(),
      { payloadBytes, iteration, inputHash: sha(text), fixture: "two-native-unique-user-messages-100x32-v1" },
      () => {
        const { output, writes } = terminal.takeOutput();
        if (!output.includes(text.slice(0, text.indexOf("\n")))) throw new Error("stop did not restore fixture text");
        if (insideDoRender || frames !== 0 || documentRenders !== 1) throw new Error("stop boundary changed");
        return {
          frames,
          documentRenders,
          documentLines,
          outputWrites: writes,
          outputBytes: Buffer.byteLength(output),
          outputHash: sha(output),
        };
      },
    );
  }
}
const source = "node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js";
const reportPath = process.argv[2];
if (!reportPath) throw new Error("report path required");
await Bun.write(
  reportPath,
  `${JSON.stringify(
    {
      runtime: Bun.version,
      sourceHash: sha(readFileSync(source)),
      boundary: "sync entry-to-return; no awaited elapsed",
      samples,
    },
    null,
    2,
  )}\n`,
);
