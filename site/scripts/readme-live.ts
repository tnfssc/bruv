import type { Cell } from "../demos";
import { compactLiveStatus } from "../../src/live/status";

// README-only UI mock. No microphone, credentials, or model calls.
// Transcript layout: src/live/conversation.ts. Status: src/live/status.ts.
export const liveDuration = 18000;
export const livePrompt = "Can you explain how the import cache works?";
export const liveReply = "It reuses parsed rows until the file changes. Then it invalidates the cache.";

export function liveFrame(elapsed: number): Cell[][] {
  const cols = 80;
  const bg = ";48;2;20;24;32";
  const normal = `38;2;222;224;225${bg}`;
  const dim = `38;2;126;136;142${bg}`;
  const accent = `38;2;167;152;215${bg}`;
  const rows: Cell[][] = Array.from({ length: 23 }, () => line("", normal));
  function line(text: string, style: string): Cell[] {
    const glyphs = [...text];
    return Array.from({ length: cols }, (_, x) => ({ text: glyphs[x] ?? " ", style }));
  }
  const started = elapsed >= 2200;
  const talking = elapsed >= 5000 && elapsed < 8000;
  const thinking = elapsed >= 8000 && elapsed < 10000;
  const speaking = elapsed >= 10000 && elapsed < 15500;
  if (!started) {
    rows[21] = line(` ${"/live start".slice(0, Math.floor(elapsed / 120))}`, normal);
  } else {
    const heard = livePrompt.slice(0, Math.floor(livePrompt.length * Math.min(1, (elapsed - 5000) / 3000)));
    if (elapsed >= 5000) rows[0] = line(` ${heard}`, "38;2;222;224;225;48;2;33;59;73");
    if (talking) rows[1] = line(" Partial transcript", dim);
    if (elapsed >= 10000) {
      const reply = liveReply.slice(0, Math.floor(liveReply.length * Math.min(1, (elapsed - 10000) / 5500)));
      rows[3] = line(` ${reply}`, normal);
      if (speaking) rows[4] = line(" Partial transcript", dim);
    }
    rows[21] = line(" ", normal);
    rows[20] = line("Hold Space to speak · tap to type", dim);
    rows[22] = line(
      compactLiveStatus({
        running: elapsed >= 3500,
        inputMode: "push-to-talk",
        talking,
        thinking,
        speaking,
        inputAvailable: true,
      }),
      accent,
    );
  }
  return rows;
}
