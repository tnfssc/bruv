import { createSendWorkload } from "./send-workloads";
import { createToolWorkload, toolShapes, toolStages } from "./tool-workloads";
import { createToolEventWorkload, type ToolEventOptions } from "./tool-event-workloads";
import { createNavigationWorkloads, navigationModes, runOfflineNavigationSdkProbe } from "./navigation-workloads";
import { attachTerminalActionProfiler, type TerminalActionProfiler } from "./action-profiler";
import { attachTerminalProfiler, type TerminalProfiler } from "./profiler";

/** One child process per case/repetition. Permanent journal installers never share a parent. */
import { interactionCatalog } from "./interaction-catalog";
export async function measureInteractionCase(id: string, width: number, height: number) {
  if (!interactionCatalog.includes(id)) throw new Error(`Unknown case ${id}`);
  if (id.startsWith("send/")) {
    const name = id.slice(5);
    let action: TerminalActionProfiler | undefined, frames: TerminalProfiler | undefined;
    const text = (bytes: number) =>
      "Probe pasted line with actual editor input.\n".repeat(Math.ceil(bytes / 43)).slice(0, bytes);
    const fixture = createSendWorkload({
      path: name === "steer" || name === "follow-up" || name === "command" ? name : "normal",
      message: name === "command" ? undefined : text(name === "large-paste" ? 262144 : name === "long" ? 16384 : 64),
      historyTurns: 4,
      columns: width,
      rows: height,
      providerDelayMs: 5,
      journal: name === "bruv-short" ? "bruv-disk" : "sdk-disk",
      onRendererReady(renderer) {
        frames = attachTerminalProfiler(renderer, { capacity: 256 });
        action = attachTerminalActionProfiler(renderer, { capacity: 4096 });
        return () => {
          action?.dispose();
          frames?.dispose();
        };
      },
    });
    try {
      await fixture.setup();
      if (!action || !frames) throw new Error("Send renderer callback did not attach profilers");
      const init = { actionProfiler: action.snapshot(), frameProfiler: frames.snapshot() };
      action.clear();
      frames.clear();
      const evidence = await fixture.action();
      return { id, init, evidence, actionProfiler: action.snapshot(), frameProfiler: frames.snapshot() };
    } finally {
      await fixture.dispose();
    }
  }
  if (id.startsWith("tools/events/")) {
    const eventCase = id.slice("tools/events/".length);
    const options: ToolEventOptions = ["error", "warning"].includes(eventCase)
      ? { shape: "normal", outcome: eventCase as "error" | "warning" }
      : { shape: eventCase as ToolEventOptions["shape"] };
    if (!["normal", "ascii", "ansi", "unicode", "newline", "structured", "error", "warning"].includes(eventCase))
      throw new Error(`Unknown tool-event case: ${id}`);
    const fixture = createToolEventWorkload(options);
    try {
      await fixture.setup();
      return { id, evidence: await fixture.action() };
    } finally {
      await fixture.dispose();
    }
  }
  if (id.startsWith("tools/")) {
    const shape = toolShapes.find((s) => id === `tools/${s}`);
    if (!shape) throw new Error(`Catalog/fixture tool shape mismatch: ${id}`);
    const fixture = createToolWorkload({ shape, historySize: 8, columns: width, rows: height });
    try {
      return { id, options: fixture.options, samples: [fixture.setup(), ...toolStages.map((s) => fixture.action(s))] };
    } finally {
      fixture.dispose();
    }
  }
  if (id === "navigation/lifecycle")
    return { id, evidence: await runOfflineNavigationSdkProbe(4, { interactive: true }) };
  const mode = navigationModes.find((m) => id === `navigation/${m}`);
  if (!mode) throw new Error(`Catalog/fixture navigation mode mismatch: ${id}`);
  const fixture = createNavigationWorkloads({
    modes: [mode],
    sizes: [4],
    columns: width,
    rows: height,
    pasteCharacters: 262144,
    toolOutputLines: 200,
  })[0];
  try {
    return { id, samples: [await fixture.setup(), await fixture.step()] };
  } finally {
    fixture.dispose();
  }
}
if (import.meta.main) {
  const [id, width, height, out] = process.argv.slice(2);
  try {
    await Bun.write(out, JSON.stringify(await measureInteractionCase(id, Number(width), Number(height))));
  } catch (e) {
    console.error(e);
    process.exitCode = 2;
  }
}
