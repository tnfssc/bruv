import { stripVTControlCharacters } from "node:util";

/** Keep prose and line breaks. Provider text must not control the terminal. */
export function terminalTranscriptText(text: string): string {
  return (
    stripVTControlCharacters(text)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip terminal escape sequences from untrusted transcript text.
      .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))?/g, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip terminal and bidi controls while keeping normal whitespace.
      .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "")
  );
}
