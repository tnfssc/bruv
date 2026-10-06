/** Offline phase probe; existing shared navigation fixture is unchanged. */
import { runOfflineNavigationSdkProbe } from "./navigation-workloads";
import { InteractiveMode } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js";
import { TreeSelectorComponent } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tree-selector.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

const phases: { name: string; startedAtMs: number; durationMs: number }[] = [];
function measure<T>(name: string, action: () => T): T {
  const startedAtMs = performance.now();
  try {
    return action();
  } finally {
    phases.push({ name, startedAtMs, durationMs: performance.now() - startedAtMs });
  }
}
function wrap(proto: any, names: string[], prefix: string) {
  for (const name of names) {
    const original = proto[name];
    if (typeof original !== "function") continue;
    proto[name] = function (...args: unknown[]) {
      return measure(prefix + name, () => original.apply(this, args));
    };
  }
}
// Empty construction gets the private TreeList prototype without building real history.
const priorAssetDir = process.env.PI_PACKAGE_DIR;
delete process.env.PI_PACKAGE_DIR;
const { initTheme } = await import(
  "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js"
);
initTheme("dark");
if (priorAssetDir !== undefined) process.env.PI_PACKAGE_DIR = priorAssetDir;
const list = new TreeSelectorComponent(
  [],
  null,
  24,
  () => {},
  () => {},
).getTreeList();
wrap(
  Object.getPrototypeOf(list),
  ["flattenTree", "buildActivePath", "applyFilter", "recalculateVisualStructure", "findNearestVisibleIndex"],
  "TreeList.",
);
const originalInit = (InteractiveMode.prototype as any).init;
(InteractiveMode.prototype as any).init = function (...args: unknown[]) {
  wrap(
    SessionManager.prototype,
    ["getTree", "getEntries", "getEntryCountByType", "buildContextEntries"],
    "SessionManager.",
  );
  return originalInit.apply(this, args);
};
wrap(
  InteractiveMode.prototype,
  [
    "renderSessionEntries",
    "renderSessionItems",
    "renderInitialMessages",
    "showTreeSelector",
    "getMarkdownThemeWithSettings",
    "getMarkdownTransformers",
  ],
  "InteractiveMode.",
);

// Capture the actual selector confirm path after real disk resume. No provider/summary access.
const originalResume = (InteractiveMode.prototype as any).handleResumeSession;
let choose: any;
(InteractiveMode.prototype as any).handleResumeSession = async function (...args: unknown[]) {
  const resumed = await originalResume.apply(this, args);
  this.settingsManager.getBranchSummarySkipPrompt = () => true;
  this.showTreeSelector("a" + (size - 1));
  const selector = this.editorContainer.children.find((child: any) => child instanceof TreeSelectorComponent);
  if (!selector) throw new Error("No real tree selector mounted");
  await Bun.sleep(40); // Let the actual selector frame finish; not CPU time.
  const frames: { startedAtMs: number; durationMs: number }[] = [];
  const renderer = this.renderer;
  const originalRender = renderer.doRender;
  renderer.doRender = function (...args: unknown[]) {
    const startedAtMs = performance.now();
    try {
      return originalRender.apply(this, args);
    } finally {
      frames.push({ startedAtMs, durationMs: performance.now() - startedAtMs });
    }
  };
  const treeList = selector.getTreeList();
  const originalSelect = treeList.onSelect;
  let completion: Promise<unknown> | undefined;
  treeList.onSelect = (...selection: unknown[]) => {
    completion = originalSelect(...selection);
    return completion;
  };
  const start = performance.now();
  const syncMs = measure("selector.confirm.dispatch", () => {
    treeList.handleInput("\r");
    return performance.now() - start;
  });
  if (!completion) throw new Error("Selector accept did not navigate");
  await completion;
  const elapsedMs = performance.now() - start;
  await Bun.sleep(40); // Actual choose/rebuild frame capture, outside lifecycle elapsed.
  const sha = (value: string) => createHash("sha256").update(value).digest("hex");
  // Separately render the completed chat for deterministic output equivalence. This
  // verification is AFTER actual-frame capture and is not lifecycle CPU evidence.
  const transcriptOutputHash = sha(this.chatContainer.render(80).join("\n"));
  choose = {
    initialSyncMs: syncMs,
    elapsedMs,
    frames,
    leafId: this.sessionManager.getLeafId(),
    messages: this.session.state.messages.length,
    transcriptOutputHash,
    chatChildren: this.chatContainer.children.length,
    note: "elapsed/drains/verification render are not CPU; synchronous phase spans may nest",
  };
  renderer.doRender = originalRender;
  return resumed;
};
const size = Number(process.argv[2] ?? "1000");
const result = await runOfflineNavigationSdkProbe(size, { interactive: true });
const actionSegments = result.segments.filter((span) =>
  /^(InteractiveMode\.(show|ctrl|session-selector|tree-selector|handleResume)|AgentSession\.navigateTree|AgentSessionRuntime\.fork)/.test(
    span.operation,
  ),
);
const apiEntries = result.elapsed.filter((span) => span.name !== "InteractiveMode.init");
const observedPeakSyncMs = Math.max(
  ...actionSegments.map((span) => span.durationMs),
  ...apiEntries.map((span) => span.initialSyncMs),
  ...result.appInput.map((input) => input.durationMs),
  choose.initialSyncMs,
);
console.log(
  JSON.stringify(
    {
      ...result,
      phases,
      choose,
      observedPeakSyncMs,
      peakScope:
        "largest observed synchronous action/span, NOT complete async continuation CPU or a sum of nested spans",
    },
    null,
    2,
  ),
);
