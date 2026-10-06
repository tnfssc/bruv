import { actionError, actionLabel } from "./action-label";
import { formatTaskRow, taskRowColor, taskRowsFromDetails, taskSummaryRowsFromDetails } from "./task-rows";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
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
function wrappedRows(text: string, width: number): string[] {
  return width < 1 || !text ? [] : wrapTextWithAnsi(plain(text), width);
}
function component(render: (width: number) => string[], settled = false): Component {
  if (!settled) return { render, invalidate() {} };
  // A completed result is immutable until Pi replaces its component. Keep only
  // the last width; resize and native invalidation (including theme changes)
  // rerender it. Spinner/call previews must still observe their mutable state.
  let cached: { width: number; lines: string[] } | undefined;
  return {
    render(width) {
      if (!cached || cached.width !== width) cached = { width, lines: render(width) };
      return cached.lines;
    },
    invalidate() {
      cached = undefined;
    },
  };
}
function padded(component: Component, padding: number): Component {
  if (padding <= 0) return component;
  const box = new Box(padding, 0);
  box.addChild(component);
  return box;
}

export interface ExecutePreviewState {
  resultVisible?: boolean;
  spinnerFrame?: number;
  spinnerTimer?: ReturnType<typeof setInterval>;
}

const actionFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export function stopExecutePreviewAnimation(state: ExecutePreviewState): void {
  if (state.spinnerTimer) clearInterval(state.spinnerTimer);
  state.spinnerTimer = undefined;
}
function startExecutePreviewAnimation(state: ExecutePreviewState | undefined, invalidate?: () => void): void {
  if (!state || !invalidate || state.spinnerTimer || state.resultVisible) return;
  state.spinnerFrame ??= 0;
  state.spinnerTimer = setInterval(() => {
    state.spinnerFrame = ((state.spinnerFrame ?? 0) + 1) % actionFrames.length;
    invalidate();
  }, 80);
  state.spinnerTimer.unref?.();
}

export function executeInputPreview(
  code: unknown,
  expanded: boolean,
  theme: Theme,
  state?: ExecutePreviewState,
  padding = 0,
  label?: unknown,
  invalidate?: () => void,
): Component {
  startExecutePreviewAnimation(state, invalidate);
  const source = typeof code === "string" ? code : "";
  const summary = typeof label === "string" ? oneLine(label) : "";
  return padded(
    component((width) => {
      // Pi vertically composes call and result slots. Suppress the call slot once
      // the result renderer runs, leaving one settled physical row.
      if (state?.resultVisible || width < 1) return [];
      if (expanded)
        return [
          truncateToWidth(theme.fg("toolTitle", "Execute · TypeScript"), width),
          ...wrappedRows(source, width).map((line) => theme.fg("muted", line)),
        ];
      const line =
        theme.fg("accent", actionFrames[state?.spinnerFrame ?? 0]!) +
        (summary ? " " + theme.fg("toolTitle", summary) : "");
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
  isPartial = false,
): Component {
  if (state) {
    state.resultVisible = true;
    if (!isPartial) stopExecutePreviewAnimation(state);
  }
  const full = result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
  const details = result.details as ExecuteDetails | undefined;
  const status = statusSummary(details, isError);
  const source = typeof code === "string" ? code : "";
  const summary = actionLabel(label, "");
  const handoff = typeof details?.handoff === "string" ? details.handoff.trim() : "";
  return padded(
    component((width) => {
      if (width < 1) return [];
      if (!expanded && isPartial) {
        const caption = typeof label === "string" ? oneLine(label) : "";
        return [
          truncateToWidth(
            theme.fg("accent", actionFrames[state?.spinnerFrame ?? 0]!) +
              (caption ? " " + theme.fg("toolTitle", caption) : ""),
            width,
          ),
        ];
      }
      if (!expanded && handoff && status.color === "success") {
        const prefix = "↪ ";
        const rows = wrappedRows(handoff, Math.max(1, width - prefix.length)).map((line, index) =>
          truncateToWidth((index === 0 ? theme.fg("success", prefix) : " ".repeat(prefix.length)) + line, width),
        );
        return details?.outputArtifactErrors
          ? [
              truncateToWidth(
                theme.fg("success", "✓ " + summary) + theme.fg("warning", " — ⚠ couldn’t save full output"),
                width,
              ),
              ...rows,
            ]
          : rows;
      }
      if (expanded) {
        const lines = [
          theme.fg("toolTitle", "Execute · TypeScript"),
          ...wrappedRows(source, width).map((line) => theme.fg("muted", line)),
          "",
          ...wrappedRows(full, width),
        ];
        if (details?.outputArtifactErrors) lines.push(theme.fg("warning", "… execute could not save all output"));
        // Wrapping already fits almost every row. Native truncation still builds a
        // grapheme-by-grapheme prefix even when it ultimately returns the input.
        // Measure first: preserve native clipping for oversized graphemes at
        // narrow widths, titles and warnings, without rebuilding fitting rows.
        return lines.map((line) => (visibleWidth(line) <= width ? line : truncateToWidth(line, width)));
      }
      const failed = status.color === "error";
      const reason = failed ? actionError(details, full) : status.text;
      const row = theme.fg(
        failed ? "error" : status.color,
        (failed ? "✗" : status.color === "success" ? "✓" : "?") + " " + summary,
      );
      const warning = details?.outputArtifactErrors ? "⚠ couldn’t save full output" : "";
      const suffix = [reason, warning].filter(Boolean).join(" — ");
      return [truncateToWidth(row + (suffix ? " — " + theme.fg(failed ? "error" : "warning", suffix) : ""), width)];
    }, !isPartial),
    padding,
  );
}

export function completionPreview(
  content: string | Array<{ type: string; text?: string }>,
  expanded: boolean,
  theme: Theme,
  padding = 0,
  kind: "task-complete" | "task-attention" = "task-complete",
  rawDetails?: unknown,
): Component {
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
        return wrappedRows(text, width).map((line, index) =>
          index === 0 && kind !== "task-attention" ? theme.fg("accent", line) : line,
        );
      if (width < 1) return [];
      const tasks = taskRowsFromDetails(rawDetails);
      const summaries = taskSummaryRowsFromDetails(rawDetails);
      // Quiet/review checkpoints still reach the agent; they are not human rows.
      if (kind === "task-attention" && !tasks.length) return [];
      const pieces = [
        ...summaries.map((row) => ({ color: row.color, text: row.text })),
        ...tasks.map((row) => ({ color: taskRowColor(row), text: formatTaskRow(row) })),
      ];
      if (!pieces.length) pieces.push({ color: "warning", text: "? Task update — status unknown" });
      const line = pieces.map((row) => theme.fg(row.color, row.text)).join(", ");
      if (visibleWidth(line) <= width) return [line];
      const failed = pieces.some((row) => row.text.startsWith("✗"));
      const cancelled = pieces.some((row) => row.text.startsWith("⊘"));
      const uncertain = pieces.some((row) => row.color === "warning");
      const indicators =
        (failed ? theme.fg("error", "✗") : cancelled ? theme.fg("error", "⊘") : "") +
        (uncertain ? theme.fg("warning", "?") : "");
      if (indicators && width <= 1)
        return [failed ? theme.fg("error", "✗") : cancelled ? theme.fg("error", "⊘") : theme.fg("warning", "?")];
      if (indicators && visibleWidth(indicators) >= width) return [truncateToWidth(indicators, width)];
      return [truncateToWidth(indicators ? indicators + " " + line : line, width)];
    }),
  );
  return box;
}
