import { stripTerminalSequences } from "@earendil-works/pi-tui";

// Labels describe attempts. Source/command is a fallback, never a success claim.
export function actionLabel(label: unknown, source: unknown, fallback = "Action"): string {
  const compact = (value: unknown) =>
    typeof value === "string"
      ? stripTerminalSequences(value)
          .replace(/\p{Cc}/gu, " ")
          .replace(/\s+/g, " ")
          .trim()
      : "";
  return compact(label) || compact(source) || compact(fallback) || "Action";
}

// Summarize actual execute error output, not stdout or model-authored status prose.
export function actionError(
  details:
    | { cancelled?: boolean; timedOut?: boolean; imageError?: unknown; stderr?: unknown; exitCode?: number }
    | undefined,
  full: string,
): string {
  if (details?.cancelled) return "cancelled";
  if (details?.timedOut) return "timed out";
  const fallback = /^Execution /.test(full) ? (full.split("\nstderr:\n")[1] ?? "") : full;
  const evidence =
    typeof details?.imageError === "string"
      ? details.imageError
      : typeof details?.stderr === "string" && details.stderr.trim()
        ? details.stderr
        : fallback;
  const lines = stripTerminalSequences(evidence)
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\p{Cc}/gu, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line && !/^(?:Execution (?:completed|failed)|stdout:|stderr:|at\s|\d+\s*\||[\s^|]+$)/.test(line));
  return (
    lines.find((line) => /^(?:\w*Error|error):/.test(line)) ??
    lines[0] ??
    (typeof details?.exitCode === "number" ? `exit ${details.exitCode}` : "failed")
  );
}
