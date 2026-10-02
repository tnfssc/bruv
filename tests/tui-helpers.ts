import { run } from "./helpers";

export const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export function tmuxRunner(socket: string, config?: string, binary = "tmux") {
  return (...args: string[]) => run([binary, "-L", socket, ...(config ? ["-f", config] : []), ...args]);
}

type Tmux = ReturnType<typeof tmuxRunner>;

export function capturePane(tmux: Tmux, target: string, history = false) {
  return tmux("capture-pane", "-p", "-t", target, ...(history ? ["-S", "-"] : []));
}

// Return the last real frame on timeout so callers retain their own assertions.
export async function pollFrame(
  capture: () => Promise<string>,
  predicate: (frame: string) => boolean,
  attempts = 100,
  interval = 50,
): Promise<string> {
  let frame = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    frame = await capture();
    if (predicate(frame)) return frame;
    await Bun.sleep(interval);
  }
  return frame;
}

export async function frameContaining(
  capture: () => Promise<string>,
  expected: string | string[],
  attempts = 100,
  interval = 50,
): Promise<string> {
  const texts = Array.isArray(expected) ? expected : [expected];
  const matches = (frame: string) => texts.every((text) => frame.includes(text));
  const frame = await pollFrame(capture, matches, attempts, interval);
  if (!matches(frame)) throw new Error("Missing " + texts.join(", ") + " in frame:\n" + frame);
  return frame;
}
