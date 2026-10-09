import { stripTerminalSequences } from "@earendil-works/pi-tui";

/** Human metadata only: a literal, bounded preview, never a claim about the result. */
export function taskTitle(value: unknown): string {
  return typeof value === "string"
    ? stripTerminalSequences(value)
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Remove terminal control bytes from task titles.
        .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}
export function launchTaskTitle(title: unknown, prompt: unknown): string {
  const explicit = taskTitle(title);
  if (explicit) return explicit;
  const preview = taskTitle(prompt);
  return preview.length > 120 ? `${preview.slice(0, 119).trimEnd()}…` : preview;
}
