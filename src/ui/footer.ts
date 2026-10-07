import { getDiskBackedEntryMetadata } from "../history/session-manager";
import { VOICE_COST_ENTRY } from "../live/cost";
import { SessionCostTracker } from "../tasks/session-costs";
import { sessionIdentity } from "../session/identity";
import { homedir } from "node:os";
import { basename, isAbsolute, relative, sep } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { CompactEditor } from "./editor";
import type { CacheCountdown, CacheEstimate } from "../agent/cache-countdown";

function singleLine(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

function tokens(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 10_000) return `${(value / 1_000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function footerPath(cwd: string, home = homedir()): string {
  const path = relative(home, cwd);
  return path === ""
    ? "~"
    : path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path)
      ? `~${sep}${path}`
      : cwd;
}

/** Keep active work visible even when the path must be shortened. */
export function pathWithTasks(path: string, taskStatus: string | undefined, width: number, theme: Theme): string {
  if (!taskStatus) return truncateToWidth(theme.fg("dim", singleLine(path)), width);
  const label = singleLine(taskStatus).replace(/^(\d+ tasks?) running$/, "$1");
  const badge = theme.fg("dim", " • ") + theme.fg("accent", label);
  const remaining = width - visibleWidth(badge);
  if (remaining < 1) return truncateToWidth(theme.fg("accent", label), width, "…");
  return truncateToWidth(theme.fg("dim", singleLine(path)), remaining, "…") + badge;
}

function columns(left: string, right: string, width: number): string {
  if (visibleWidth(left) + 2 + visibleWidth(right) <= width) {
    return left + " ".repeat(width - visibleWidth(left) - visibleWidth(right)) + right;
  }
  // Narrow terminals retain some model identity as well as usage.
  const rightBudget = Math.min(visibleWidth(right), Math.floor(width * 0.45));
  if (rightBudget < 1) return truncateToWidth(left, width, "…");
  const lhs = truncateToWidth(left, Math.max(0, width - rightBudget - 1), "…");
  const rhs = truncateToWidth(right, rightBudget, "…");
  return lhs + " ".repeat(Math.max(0, width - visibleWidth(lhs) - visibleWidth(rhs))) + rhs;
}

type FooterHistory = {
  input: number;
  output: number;
  read: number;
  write: number;
  cost: number;
  cacheHit: number | undefined;
  hasFastCost: boolean;
  unknownVoiceCost: boolean;
};

type FooterHistoryCache = {
  sessionId: string;
  leafId: string | null;
  entries: WeakRef<object>;
  entryCount: number;
  value: FooterHistory;
};

// Keep only the reduced footer data. In particular, retaining entries here would defeat
// lazy/disk-backed session history by keeping materialized message bodies alive.
const footerHistoryCache = new WeakMap<object, FooterHistoryCache>();

function readFooterHistory(ctx: ExtensionContext): FooterHistory {
  const manager = ctx.sessionManager;
  const identity = manager as typeof manager & {
    getSessionId?: () => string;
    getLeafId?: () => string | null;
  };
  // The pinned SDK (and our disk-backed adapter) keeps an append-only metadata
  // array. Its identity catches reloads. Disk-backed totals use the last usage
  // entry index; native arrays keep the full count/leaf key. Unknown managers stay uncached.
  const fileEntries = (manager as unknown as { fileEntries?: unknown }).fileEntries;
  const cacheable =
    Array.isArray(fileEntries) &&
    typeof identity.getSessionId === "function" &&
    typeof identity.getLeafId === "function";
  const sessionId = cacheable ? identity.getSessionId() : undefined;
  const metadata = getDiskBackedEntryMetadata(manager as object);
  // Totals cover all branches. Cache observations and session labels add no usage.
  const leafId = metadata ? null : cacheable ? identity.getLeafId() : undefined;
  let entryCount = Array.isArray(fileEntries) ? fileEntries.length : 0;
  if (metadata) {
    entryCount = metadata.length;
    while (entryCount > 0) {
      const entry = metadata[entryCount - 1]!;
      if (
        (entry.type === "message" && ["assistant", "toolResult"].includes(entry.messageRole ?? "")) ||
        entry.type === "compaction" ||
        entry.type === "branch_summary" ||
        (entry.type === "custom" &&
          ["bruv-compaction-attempt", "bruv-native-fast-mode", VOICE_COST_ENTRY].includes(entry.customType ?? ""))
      )
        break;
      entryCount--;
    }
  }
  const cached = cacheable ? footerHistoryCache.get(manager as object) : undefined;
  if (
    cacheable &&
    cached &&
    cached.sessionId === sessionId &&
    cached.leafId === leafId &&
    cached.entries.deref() === fileEntries &&
    cached.entryCount === entryCount
  )
    return cached.value;

  let input = 0,
    output = 0,
    read = 0,
    write = 0,
    cost = 0;
  let cacheHit: number | undefined;
  let hasFastCost = false;
  let unknownVoiceCost = false;
  // Include pre-compaction usage, nested tool usage, and summaries, like Pi.
  for (const entry of manager.getEntries()) {
    let usage: Usage | undefined;
    if (entry.type === "message" && entry.message.role === "assistant") {
      usage = entry.message.usage;
      const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
      cacheHit = prompt > 0 ? (usage.cacheRead / prompt) * 100 : undefined;
    } else if (entry.type === "message" && entry.message.role === "toolResult") {
      usage = entry.message.usage;
    } else if (entry.type === "compaction" || entry.type === "branch_summary") {
      usage = entry.usage;
    } else if (entry.type === "custom" && entry.customType === "bruv-compaction-attempt") {
      usage = (entry.data as { usage?: Usage })?.usage;
    }
    if (
      entry.type === "custom" &&
      entry.customType === "bruv-native-fast-mode" &&
      entry.data &&
      typeof entry.data === "object" &&
      (entry.data as { enabled?: unknown }).enabled === true
    ) {
      hasFastCost = true;
    }
    if (entry.type === "custom" && entry.customType === VOICE_COST_ENTRY) {
      const data = entry.data as { cost?: number; unknown?: boolean } | undefined;
      if (typeof data?.cost === "number" && Number.isFinite(data.cost) && data.cost >= 0) cost += data.cost;
      if (data?.unknown) unknownVoiceCost = true;
    }
    if (usage) {
      input += usage.input;
      output += usage.output;
      read += usage.cacheRead;
      write += usage.cacheWrite;
      cost += usage.cost.total;
    }
  }
  const value = { input, output, read, write, cost, cacheHit, hasFastCost, unknownVoiceCost };
  if (cacheable) {
    // This is deliberately a single current-position entry, not a map by leaf. A
    // branch can revisit an old leaf after more entries were appended, so reusing an
    // older value for that leaf would miss the newer append-only history.
    footerHistoryCache.set(manager as object, {
      sessionId: sessionId!,
      leafId: leafId!,
      // Never keep an obsolete native in-memory entries array alive after reset.
      entries: new WeakRef(fileEntries),
      entryCount,
      value,
    });
  }
  return value;
}

function hasFastEstimate(history: FooterHistory, statuses: ReadonlyMap<string, string>): boolean {
  return (
    (!!statuses.get("bruv-native-fast") && !statuses.get("bruv-native-fast")?.endsWith("off")) || history.hasFastCost
  );
}

function cacheBadge(estimate: CacheEstimate | undefined, theme: Theme): string | undefined {
  if (!estimate) return undefined;
  const color =
    estimate.state === "expired" || estimate.state === "urgent"
      ? "error"
      : estimate.state === "warning"
        ? "warning"
        : "dim";
  return theme.fg(color, estimate.text);
}

export function renderDetailedFooter(
  ctx: ExtensionContext,
  data: ReadonlyFooterDataProvider,
  theme: Theme,
  width: number,
  descendantCost = 0,
  cache?: CacheEstimate,
): string[] {
  if (width < 1) return [];
  const history = readFooterHistory(ctx);
  const { input, output, read, write, cost, cacheHit } = history;
  let path = footerPath(ctx.sessionManager.getCwd());
  const branch = data.getGitBranch();
  if (branch) path += ` (${branch})`;
  const name = ctx.sessionManager.getSessionName();
  if (name) path += ` • ${name}`;
  const stats: string[] = [];
  if (input) stats.push(`↑${tokens(input)}`);
  if (output) stats.push(`↓${tokens(output)}`);
  if (read) stats.push(`R${tokens(read)}`);
  if (write) stats.push(`W${tokens(write)}`);
  if ((read || write) && cacheHit !== undefined) stats.push(`CH${cacheHit.toFixed(1)}%`);
  const model = ctx.model;
  const statuses = data.getExtensionStatuses();
  const fastEstimate = hasFastEstimate(history, statuses);
  const subscription = model && (model.provider === "kimi-coding" || ctx.modelRegistry.isUsingOAuth(model));
  if (cost || descendantCost || subscription || history.unknownVoiceCost || statuses.get("bruv-live") || fastEstimate)
    stats.push(
      "$" +
        (cost + descendantCost).toFixed(3) +
        (fastEstimate ? "~ (catalog estimate)" : "") +
        (history.unknownVoiceCost
          ? "+? (voice usage incomplete)"
          : statuses.get("bruv-live")
            ? "~ (live voice pending)"
            : descendantCost
              ? " total"
              : subscription
                ? " (sub)"
                : ""),
    );
  const context = ctx.getContextUsage();
  const percent = context?.percent;
  const contextText = `${percent == null ? "?" : `${percent.toFixed(1)}%`}/${tokens(context?.contextWindow ?? model?.contextWindow ?? 0)}`;
  // The extension API exposes context usage, but not auto-compaction settings;
  // omit the native '(auto)' suffix rather than displaying an assumed setting.
  stats.push(
    theme.fg(
      percent != null && percent > 90 ? "error" : percent != null && percent > 70 ? "warning" : "dim",
      contextText,
    ),
  );
  const detailedCache = cacheBadge(cache, theme);
  if (detailedCache) stats.push(detailedCache);
  let modelText = model?.id ?? "no-model";
  if (model?.reasoning) modelText += ` • ${ctx.thinkingLevel ?? "off"}`;
  if (model && data.getAvailableProviderCount() > 1) {
    const withProvider = `(${model.provider}) ${modelText}`;
    if (visibleWidth(stats.join(" ")) + 2 + visibleWidth(withProvider) <= width) modelText = withProvider;
  }
  const lines = [
    pathWithTasks(path, statuses.get("bruv-tasks"), width, theme),
    columns(theme.fg("dim", stats.join(" ")), theme.fg("dim", singleLine(modelText)), width),
  ];
  // Keep statuses owned by other extensions visible on their own row.
  const others = [...statuses]
    .filter(([key]) => key !== "bruv-tasks" && key !== "bruv-live-cost")
    .sort(([a], [b]) => a.localeCompare(b));
  if (others.length) lines.push(truncateToWidth(others.map(([, value]) => singleLine(value)).join(" "), width));
  return lines;
}

export function renderCompactFooter(
  ctx: ExtensionContext,
  data: ReadonlyFooterDataProvider,
  theme: Theme,
  width: number,
  descendantCost = 0,
  cache?: CacheEstimate,
): string[] {
  if (width < 1) return [];
  const project = singleLine(basename(ctx.sessionManager.getCwd()) || "/");
  const branch = data.getGitBranch();
  const statuses = data.getExtensionStatuses();
  const task = singleLine(statuses.get("bruv-tasks") ?? "").replace(/^(\d+ tasks?) running$/, "$1");
  const shortTask = task.replace(/^(\d+) tasks?$/, "$1t");
  const questionStatus = singleLine(statuses.get("bruv-questions") ?? "");
  const questionCount = questionStatus.match(/^([0-9]+) questions?(?: pending)?/);
  const savedQuestions = questionStatus.match(/ · ([0-9]+) saved/)?.[1];
  const questionState = questionStatus.includes("follow-up blocked")
    ? [" · follow-up blocked", " blocked"]
    : questionStatus.includes("waiting on you")
      ? [" · waiting on you", " waiting"]
      : ["", ""];
  const questionLabel = (short: boolean) =>
    questionStatus
      ? questionCount
        ? questionCount[1] +
          " /questions" +
          questionState[short ? 1 : 0] +
          (savedQuestions ? (short ? " " : " · ") + savedQuestions + " saved" : "")
        : short
          ? "/questions unavailable"
          : questionStatus
      : "";
  const questions = questionLabel(false);
  const shortQuestions = questionLabel(true);
  const mode = singleLine(statuses.get("bruv-mode") ?? "");
  // The bolt reports the selected mode, like Codex; it is not delivery confirmation.
  const nativeFast = singleLine(statuses.get("bruv-native-fast") ?? "");
  const shortNativeFast = nativeFast ? (nativeFast.endsWith("off") ? "off" : "fast") : "";
  const live = singleLine(statuses.get("bruv-live") ?? "");
  const remote = singleLine(statuses.get("bruv-remote") ?? "");
  const otherCount = [...statuses.keys()].filter(
    (key) =>
      key !== "bruv-tasks" &&
      key !== "bruv-questions" &&
      key !== "bruv-remote" &&
      key !== "bruv-mode" &&
      key !== "bruv-native-fast" &&
      key !== "bruv-live" &&
      key !== "bruv-live-cost",
  ).length;
  const extra = otherCount ? `+${otherCount} status` : "";
  const history = readFooterHistory(ctx);
  // Pi supplies a token-price catalog estimate, not account usage.
  // Neither response tiers nor SDK pricing prove delivery or ChatGPT credits.
  const knownCost = "$" + (history.cost + descendantCost).toFixed(3) + (hasFastEstimate(history, statuses) ? "~" : "");
  const cost = history.unknownVoiceCost ? knownCost + "+?" : statuses.get("bruv-live") ? knownCost + "~" : knownCost;
  const percent = ctx.getContextUsage()?.percent;
  const percentText = percent == null ? "?" : `${percent.toFixed(1).replace(/\.0$/, "")}%`;
  const context = (label: string) =>
    theme.fg(
      percent != null && percent > 90 ? "error" : percent != null && percent > 70 ? "warning" : "dim",
      label + percentText,
    );
  const model = singleLine(ctx.model?.id ?? "no-model");
  const modelWithThinking = model + (ctx.model?.reasoning ? ` · ${ctx.thinkingLevel ?? "off"}` : "");
  const accent = (text: string) => (text ? theme.fg("accent", text) : "");
  const cacheText = cacheBadge(cache, theme) ?? "";
  const placement = [accent(live), accent(remote)];
  const full = [accent(task), questions, accent(mode), accent(nativeFast), cost, context("ctx "), cacheText, extra];
  const short = [accent(shortNativeFast), cost, context("C"), cacheText];
  const candidates: [string[], string, string][] = [
    [[...placement, branch ? `${project}:${singleLine(branch)}` : project, ...full], modelWithThinking, " · "],
    [[...placement, project, ...full], modelWithThinking, " · "],
    [[...placement, accent(shortTask), shortQuestions, ...short, project, extra], model, " "],
    [[shortQuestions, ...placement, accent(shortTask), ...short, extra], model, " "],
  ];
  for (const [parts, right, separator] of candidates) {
    const left = parts.filter(Boolean).join(separator);
    if (visibleWidth(left) + 2 + visibleWidth(right) <= width) {
      return [columns(theme.fg("dim", left), theme.fg("dim", right), width)];
    }
  }
  const [parts, right, separator] = candidates[candidates.length - 1]!;
  return [columns(theme.fg("dim", parts.filter(Boolean).join(separator)), theme.fg("dim", right), width)];
}

export function createCompactUI(pi: ExtensionAPI, cache?: CacheCountdown): (ctx: ExtensionContext) => void {
  let expanded = false;
  let tracker: SessionCostTracker | undefined;
  let disposeFooter: (() => void) | undefined;
  const install = (ctx: ExtensionContext) => {
    const root = sessionIdentity(ctx.sessionManager);
    if (!root) tracker = undefined;
    else if (tracker?.rootFile !== root.file) tracker = new SessionCostTracker(root.file, root.directory);
    disposeFooter?.();
    disposeFooter = installCompactFooter(ctx, () => expanded, tracker, cache);
  };
  pi.on("session_shutdown", () => {
    disposeFooter?.();
    disposeFooter = undefined;
    tracker = undefined;
  });
  pi.registerCommand("status", {
    description: "Toggle full path, token/cache usage, provider and extension statuses",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") return;
      expanded = !expanded;
      install(ctx);
    },
  });
  return (ctx) => {
    if (ctx.mode !== "tui") return;
    // Respect an editor already installed by another extension.
    if (!ctx.ui.getEditorComponent()) {
      ctx.ui.setEditorComponent(
        (tui, theme, bindings) => new CompactEditor(tui, theme, bindings, { paddingX: 0, embedWorkingStatus: true }),
      );
    }
    install(ctx);
  };
}

/** Disk-backed costs run on a coarse poll, with at most one refresh in flight. */
function pollDescendantCost(
  tracker: SessionCostTracker,
  isActive: () => boolean,
  requestRender: () => void,
): () => void {
  let busy = false;
  const refresh = async () => {
    if (!isActive() || busy) return;
    busy = true;
    const before = tracker.descendantCost;
    try {
      await tracker.refresh();
      if (isActive() && tracker.descendantCost !== before) requestRender();
    } catch {
      // A transient filesystem error must not interrupt the terminal.
    } finally {
      busy = false;
    }
  };
  const timer = isActive() ? setInterval(() => void refresh(), 2_000) : undefined;
  timer?.unref?.();
  void refresh();
  return () => {
    if (timer) clearInterval(timer);
  };
}

/** Cache changes and deadline ticks share one text-change/redraw path. */
function followCacheCountdown(
  ctx: ExtensionContext,
  cache: CacheCountdown,
  isActive: () => boolean,
  requestRender: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastText = cache.estimate(ctx).text;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    if (!isActive()) return;
    const estimate = cache.estimate(ctx);
    if (estimate.nextUpdateMs === undefined) return;
    timer = setTimeout(update, Math.min(60_000, Math.max(1, estimate.nextUpdateMs)));
    timer.unref?.();
  };
  const update = () => {
    if (!isActive()) return;
    const text = cache.estimate(ctx).text;
    if (text !== lastText) {
      lastText = text;
      requestRender();
    }
    schedule();
  };
  const unsubscribe = cache.subscribe(update);
  schedule();
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

export function installCompactFooter(
  ctx: ExtensionContext,
  expanded: () => boolean = () => false,
  tracker?: SessionCostTracker,
  cache?: CacheCountdown,
): () => void {
  if (ctx.mode !== "tui") return () => {};
  if (!tracker) {
    const root = sessionIdentity(ctx.sessionManager);
    if (root) tracker = new SessionCostTracker(root.file, root.directory);
  }
  let dispose = () => {};
  let stopped = false;
  ctx.ui.setFooter((tui, theme, data) => {
    // The component owns one lifetime; observers own their clocks/subscriptions.
    let active = !stopped;
    const isActive = () => active;
    const requestRender = () => tui.requestRender();
    const unsubscribeBranch = data.onBranchChange(requestRender);
    const stopCost = tracker ? pollDescendantCost(tracker, isActive, requestRender) : () => {};
    const stopCache = cache ? followCacheCountdown(ctx, cache, isActive, requestRender) : () => {};
    let disposed = false;
    dispose = () => {
      if (disposed) return;
      disposed = true;
      active = false;
      stopCost();
      stopCache();
      unsubscribeBranch();
    };
    return {
      render: (width) =>
        (expanded() ? renderDetailedFooter : renderCompactFooter)(
          ctx,
          data,
          theme,
          width,
          tracker?.descendantCost ?? 0,
          cache?.estimate(ctx),
        ),
      invalidate() {
        theme = ctx.ui.theme;
      },
      dispose,
    };
  });
  return () => {
    stopped = true;
    dispose();
  };
}
