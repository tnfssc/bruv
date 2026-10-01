import { actionLabel } from "./action-label";
import { sshJobId } from "../remote/jobs";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  getKeybindings,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

function plain(text: string): string {
  return stripTerminalSequences(text)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/\p{Cc}/gu, (character) => (character === "\n" ? "\n" : ""));
}
function oneLine(text: string): string {
  return plain(text).replace(/\s+/g, " ").trim();
}
function expandHint(): string {
  const keys = getKeybindings().getKeys("app.tools.expand");
  return keys.length ? keys.join("/") + " to expand" : "expand for more";
}
export function foldedRows(text: string, width: number, head: number, tail: number, expanded: boolean): string[] {
  if (width < 1 || !text) return [];
  const rows = wrapTextWithAnsi(plain(text), width);
  if (expanded || rows.length <= head + tail) return rows;
  const hidden = rows.length - head - tail;
  return [
    ...rows.slice(0, head),
    truncateToWidth("… (" + hidden + " lines hidden; " + expandHint() + ")", width),
    ...(tail ? rows.slice(-tail) : []),
  ];
}
function component(render: (width: number) => string[]): Component {
  return { render, invalidate() {} };
}
function padded(component: Component, padding: number): Component {
  if (padding <= 0) return component;
  const box = new Box(padding, 0);
  box.addChild(component);
  return box;
}

export interface ExecutePreviewState {
  resultVisible?: boolean;
}

export function executeInputPreview(
  code: unknown,
  expanded: boolean,
  theme: Theme,
  state?: ExecutePreviewState,
  _executionStarted = true,
  padding = 0,
  label?: unknown,
): Component {
  const source = typeof code === "string" ? code : "";
  const summary = actionLabel(label, source);
  return padded(
    component((width) => {
      // Pi vertically composes call and result slots. Suppress the call slot once
      // the result renderer runs, leaving one settled physical row.
      if (state?.resultVisible || width < 1) return [];
      if (expanded)
        return [
          truncateToWidth(theme.fg("toolTitle", "Execute · TypeScript"), width),
          ...foldedRows(source, width, 0, 0, true).map((line) => theme.fg("muted", line)),
        ];
      const line = theme.fg("toolTitle", summary);
      return [truncateToWidth(line, width)];
    }),
    padding,
  );
}

type TextResult = { content: Array<{ type: string; text?: string }>; details?: unknown };
type ExecuteDetails = {
  exitCode?: number;
  signal?: string;
  timedOut?: boolean;
  cancelled?: boolean;
  imageError?: string;
  stdout?: unknown;
  stderr?: unknown;
  stdoutLost?: boolean;
  stderrLost?: boolean;
  stdoutPath?: string;
  stderrPath?: string;
  outputArtifactErrors?: unknown;
  images?: unknown[];
  handoff?: string;
  backgroundJobs?: string[];
};
function statusSummary(
  details: ExecuteDetails | undefined,
  isError: boolean,
): { icon: string; color: "success" | "error" | "warning"; text: string } {
  // Structured outcomes, not model-facing prose, determine failure notices.
  if (details?.cancelled) return { icon: "✗", color: "error", text: "Cancelled" };
  if (details?.timedOut) return { icon: "✗", color: "error", text: "Timed out" };
  if (isError || details?.imageError || (typeof details?.exitCode === "number" && details.exitCode !== 0))
    return { icon: "✗", color: "error", text: "Failed" };
  if (details?.handoff || details?.exitCode === 0) return { icon: "", color: "success", text: "" };
  return { icon: "?", color: "warning", text: "Outcome unknown" };
}

export function executeOutputPreview(
  result: TextResult,
  expanded: boolean,
  isError: boolean,
  theme: Theme,
  code?: unknown,
  state?: ExecutePreviewState,
  padding = 0,
  label?: unknown,
): Component {
  if (state) state.resultVisible = true;
  const full = result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
  const details = result.details as ExecuteDetails | undefined;
  const status = statusSummary(details, isError);
  const source = typeof code === "string" ? code : "";
  const summary = actionLabel(label, code);
  const imageCount = Array.isArray(details?.images)
    ? details.images.length
    : result.content.filter((part) => part.type === "image").length;
  const truncated = details?.stdoutLost === true || details?.stderrLost === true;
  const backgroundCount =
    !details?.handoff && Array.isArray(details?.backgroundJobs) ? details.backgroundJobs.length : 0;
  const diagnostic = [
    truncated ? "truncated" : "",
    details?.outputArtifactErrors ? "⚠ output save error" : "",
    imageCount ? imageCount + " image" + (imageCount === 1 ? "" : "s") : "",
    backgroundCount ? backgroundCount + " background" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const handoff = typeof details?.handoff === "string" ? details.handoff.trim() : "";
  return padded(
    component((width) => {
      if (width < 1) return [];
      if (!expanded && handoff && status.color === "success") {
        const prefix = "↪ ";
        const rows = foldedRows(handoff, Math.max(1, width - prefix.length), 0, 0, true).map((line, index) =>
          truncateToWidth((index === 0 ? theme.fg("success", prefix) : " ".repeat(prefix.length)) + line, width),
        );
        return truncated || details?.outputArtifactErrors
          ? [truncateToWidth(theme.fg("warning", diagnostic), width), ...rows]
          : rows;
      }
      if (expanded) {
        const lines = [
          theme.fg("toolTitle", "Execute · TypeScript"),
          ...foldedRows(source, width, 0, 0, true).map((line) => theme.fg("muted", line)),
          "",
          ...foldedRows(full, width, 0, 0, true),
        ];
        if (details?.outputArtifactErrors) lines.push(theme.fg("warning", "… execute could not save all output"));
        return lines.map((line) => truncateToWidth(line, width));
      }
      const suffix = [diagnostic, summary].filter(Boolean).join(" · ");
      const line = status.text
        ? theme.fg(status.color, status.icon + " " + status.text) + theme.fg("muted", " · " + suffix)
        : theme.fg("toolTitle", suffix);
      return [truncateToWidth(line, width)];
    }),
    padding,
  );
}

interface CompletionDetails {
  tasks?: Array<{
    id?: unknown;
    title?: unknown;
    status?: unknown;
    exitCode?: unknown;
    signal?: unknown;
    timedOut?: unknown;
  }>;
  attention?: Array<{ id?: unknown; reasons?: unknown; elapsedMs?: unknown; quietForMs?: unknown }>;
  taskStatusCounts?: Partial<Record<"completed" | "failed" | "killed" | "running" | "unknown", unknown>>;
  remote?: Array<{ taskId?: unknown; title?: unknown; target?: unknown; state?: unknown; actionable?: unknown }>;
  taskCount?: unknown;
  attentionCount?: unknown;
  omittedTasks?: unknown;
  omittedAttention?: unknown;
}
function attentionSummary(notice: NonNullable<CompletionDetails["attention"]>[number]): string {
  const id = safeMetadata(notice?.id) || "task";
  const reasons = Array.isArray(notice?.reasons) ? notice.reasons : [];
  const duration = (ms: unknown) =>
    typeof ms === "number" && Number.isFinite(ms) && ms >= 0 ? Math.floor(ms / 60_000) + "m" : "";
  const quiet = reasons.includes("quiet") ? ["quiet", duration(notice.quietForMs)].filter(Boolean).join(" ") : "";
  const review = reasons.includes("review") ? ["review", duration(notice.elapsedMs)].filter(Boolean).join(" ") : "";
  return [id, quiet, review].filter(Boolean).join(" · ");
}
function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function safeMetadata(value: unknown): string {
  return typeof value === "string" ? oneLine(value) : "";
}
export function completionPreview(
  content: string | Array<{ type: string; text?: string }>,
  expanded: boolean,
  theme: Theme,
  padding = 0,
  kind: "task-complete" | "task-attention" = "task-complete",
  rawDetails?: unknown,
): Component {
  const details = rawDetails as CompletionDetails | undefined;
  const text =
    typeof content === "string"
      ? content
      : content
          .filter((part) => part.type === "text")
          .map((part) => part.text ?? "")
          .join("\n");
  const box = new Box(padding, 0);
  box.addChild(
    component((width) => {
      if (expanded)
        return foldedRows(text, width, 0, 0, true).map((line, index) =>
          index === 0 && kind !== "task-attention" ? theme.fg("accent", line) : line,
        );
      if (width < 1) return [];
      const tasks = Array.isArray(details?.tasks) ? details.tasks : [];
      const omittedTasks = count(details?.omittedTasks);
      const attention = Array.isArray(details?.attention) ? details.attention : [];
      const omittedAttention = count(details?.omittedAttention);
      const first = oneLine(text.split("\n")[0] ?? "");

      const remote = Array.isArray(details?.remote) ? details.remote : [];
      if (kind === "task-attention" && !remote.length) {
        const summaries = attention.map(attentionSummary);
        if (omittedAttention) summaries.push(omittedAttention + " more checks");
        return [truncateToWidth("Task check · " + (summaries.join(", ") || "update; expand for details"), width)];
      }

      const aggregate = details?.taskStatusCounts;
      const hasAggregate =
        !!aggregate &&
        ["completed", "failed", "killed", "running", "unknown"].every(
          (status) => typeof aggregate[status as keyof typeof aggregate] === "number",
        );
      const knownCounts = { completed: 0, failed: 0, killed: 0, running: 0, unknown: 0 };
      for (const task of tasks) {
        const status = safeMetadata(task?.status);
        if (status in knownCounts) knownCounts[status as keyof typeof knownCounts]++;
        else knownCounts.unknown++;
      }

      const pieces: string[] = [];
      let hasFailure = false;
      let hasUncertainty = false;
      const add = (color: "success" | "error" | "warning" | "normal", value: string) => {
        if (!value) return;
        if (color === "error") hasFailure = true;
        if (color === "warning") hasUncertainty = true;
        pieces.push(color === "normal" ? value : theme.fg(color, value));
      };

      // Metadata can be capped for large batches. Surface an omitted failure
      // before the ID sequence so narrow terminals cannot make the batch look
      // successful merely because the failed task was outside the cap.
      if (hasAggregate) {
        const omittedFailed = count(aggregate?.failed) - knownCounts.failed;
        const omittedKilled = count(aggregate?.killed) - knownCounts.killed;
        if (omittedFailed > 0)
          add("error", "✗ " + omittedFailed + " omitted task" + (omittedFailed === 1 ? "" : "s") + " failed");
        if (omittedKilled > 0)
          add("error", "✗ " + omittedKilled + " omitted task" + (omittedKilled === 1 ? "" : "s") + " cancelled");
        const omittedUncertain =
          count(aggregate?.running) + count(aggregate?.unknown) - knownCounts.running - knownCounts.unknown;
        if (omittedUncertain > 0)
          add(
            "warning",
            "? " + omittedUncertain + " omitted task" + (omittedUncertain === 1 ? "" : "s") + " unresolved",
          );
      }

      for (const task of tasks) {
        const id = safeMetadata(task?.title) || safeMetadata(task?.id) || "task";
        const status = safeMetadata(task?.status);
        if (task?.timedOut === true) add("error", "✗ " + id + " timed out");
        else if (status === "completed") add("success", "✓ " + id + " finished");
        else if (status === "killed") add("error", "✗ " + id + " cancelled");
        else if (status === "failed") add("error", "✗ " + id + " failed");
        else add("warning", "? " + id + (status ? " " + status : " status unknown"));
      }

      for (const row of remote) {
        const taskId = safeMetadata(row?.taskId);
        const title = safeMetadata(row?.title);
        const target = safeMetadata(row?.target);
        const id = title
          ? title + (target ? " · " + target : "")
          : /^[a-zA-Z0-9_-]{1,128}$/.test(taskId)
            ? sshJobId(taskId)
            : "SSH task";
        const state = safeMetadata(row?.state);
        if (row?.actionable) add("warning", "? " + id + " needs human action");
        else if (state === "cancelled") add("error", "✗ " + id + " cancelled");
        // SSH "done" is a terminal observation, not proof of feature success.
        else if (state === "done") add("normal", id + " finished");
        else add("warning", "? " + id + (state ? " " + state : " status unknown"));
      }

      for (const notice of attention) {
        add("normal", "Task check · " + attentionSummary(notice));
      }
      if (omittedAttention) add("normal", omittedAttention + " more checks");

      if (omittedTasks && !hasAggregate) add("warning", "? " + omittedTasks + " task details omitted");
      if (!pieces.length) add("warning", "? Task completion · " + (first || "unknown task update"));
      const row = pieces.join(", ");
      if (visibleWidth(row) <= width) return [row];

      // Keep compact risk cues ahead of truncatable descriptions. Failure wins
      // at tiny widths; otherwise both failure and uncertainty stay visible.
      let indicators = "";
      if (hasFailure) indicators += theme.fg("error", "✗");
      if (hasUncertainty) indicators += theme.fg("warning", "?");
      if (indicators && width <= 1) return [hasFailure ? theme.fg("error", "✗") : theme.fg("warning", "?")];
      if (indicators && visibleWidth(indicators) >= width) return [truncateToWidth(indicators, width)];
      if (indicators) return [truncateToWidth(indicators + " " + row, width)];
      return [truncateToWidth(row, width)];
    }),
  );
  return box;
}
