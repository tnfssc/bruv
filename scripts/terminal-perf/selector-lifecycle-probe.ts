import { requireValue } from "../lib/require-value";
import type { ProbeMethods, ProbeInteractiveMode } from "./sdk-probe-types";
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
function wrap(target: object, names: string[], prefix: string) {
  const proto = target as ProbeMethods;
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
const originalInit = (InteractiveMode.prototype as unknown as ProbeInteractiveMode).init;
(InteractiveMode.prototype as unknown as ProbeInteractiveMode).init = function () {
  wrap(
    SessionManager.prototype,
    ["getTree", "getEntries", "getEntryCountByType", "buildContextEntries"],
    "SessionManager.",
  );
  return originalInit.call(this);
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

// Own the selector-confirm capture from mounting through final verification.
// No provider/summary access; settling and verification are outside lifecycle timing.
async function captureSelectorConfirmation(app: ProbeInteractiveMode, leafId: string) {
  app.settingsManager.getBranchSummarySkipPrompt = () => true;
  app.showTreeSelector(leafId);
  const selector = app.editorContainer.children.find((child) => child instanceof TreeSelectorComponent);
  if (!selector) throw new Error("No real tree selector mounted");
  await Bun.sleep(40); // Let the actual selector frame finish; not CPU time.

  const frames: { startedAtMs: number; durationMs: number }[] = [];
  const renderer = app.renderer;
  const measuredRenderer = renderer as unknown as ProbeMethods;
  const originalRender = measuredRenderer.doRender;
  const treeList = selector.getTreeList();
  const originalSelect = requireValue(treeList.onSelect) as (entryId: string) => Promise<unknown>;
  let completion: Promise<unknown> | undefined;
  measuredRenderer.doRender = function (...args: unknown[]) {
    const startedAtMs = performance.now();
    try {
      return originalRender.apply(this, args);
    } finally {
      frames.push({ startedAtMs, durationMs: performance.now() - startedAtMs });
    }
  };
  treeList.onSelect = (...selection: [string]) => {
    completion = originalSelect(...selection);
    return completion;
  };
  try {
    const start = performance.now();
    const syncMs = measure("selector.confirm.dispatch", () => {
      treeList.handleInput("\r");
      return performance.now() - start;
    });
    if (!completion) throw new Error("Selector accept did not navigate");
    await completion;
    const elapsedMs = performance.now() - start;
    await Bun.sleep(40); // Actual choose/rebuild frame capture, outside lifecycle elapsed.
    // Separately render the completed chat for deterministic output equivalence. This
    // verification is AFTER actual-frame capture and is not lifecycle CPU evidence.
    const transcriptOutputHash = createHash("sha256").update(app.chatContainer.render(80).join("\n")).digest("hex");
    return {
      initialSyncMs: syncMs,
      elapsedMs,
      frames,
      leafId: app.sessionManager.getLeafId(),
      messages: app.session.state.messages.length,
      transcriptOutputHash,
      chatChildren: app.chatContainer.children.length,
      note: "elapsed/drains/verification render are not CPU; synchronous phase spans may nest",
    };
  } finally {
    treeList.onSelect = originalSelect;
    measuredRenderer.doRender = originalRender;
  }
}

// Capture the actual selector confirm path only after real disk resume completes.
const originalResume = (InteractiveMode.prototype as unknown as ProbeInteractiveMode).handleResumeSession;
let choose!: Awaited<ReturnType<typeof captureSelectorConfirmation>>;
(InteractiveMode.prototype as unknown as ProbeInteractiveMode).handleResumeSession = async function (
  ...args: unknown[]
) {
  const resumed = await originalResume.apply(this, args);
  choose = await captureSelectorConfirmation(this, `a${size - 1}`);
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
