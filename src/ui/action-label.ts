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
