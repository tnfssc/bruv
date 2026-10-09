import { BROWSER_INPUT_MARKER } from "./browser-protocol";

/** The relay inserts a private, one-use ticket before submission. Never render it. */
export function createBrowserRequestInput() {
  let ticket: string | undefined;
  return {
    observe(data: string) {
      if (!data.startsWith(BROWSER_INPUT_MARKER)) return;
      const value = data.slice(BROWSER_INPUT_MARKER.length, -1);
      ticket = /^[a-f0-9]{32}$/.test(value) && data.endsWith("\x07") ? value : undefined;
      return { consume: true };
    },
    take(): string | undefined {
      const submitted = ticket;
      ticket = undefined;
      return submitted;
    },
  };
}
