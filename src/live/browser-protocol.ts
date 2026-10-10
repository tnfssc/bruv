export const BROWSER_INPUT_MARKER = "\x1b]777;bruv-input;";
/** Reports describe the terminal, not an editor action. */
export function browserInputReport(packet: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Terminal protocol bytes.
  return /^(?:\x1b\[[IO]|\x1b\[(?:[?>][0-9;]*c|[0-9;]+[tR]|\?[0-9;]+u|0n|\??[0-9;]+\$y)|\x1bP[01]\$r[0-9;: ]*[a-z]\x1b\\|\x1b\](?:10|11|4;[0-9]+);rgb:[a-fA-F0-9/]+(?:\x07|\x1b\\))+$/.test(
    packet,
  );
}
/** Device transport only: no provider keys, transcripts, tools, or job operations. */
export const AUDIO_MAX_MESSAGE = 16_000;
export const AUDIO_MAX_BUFFER = 64 * 1024;
export type AudioCommand =
  | { type: "start" | "stop" }
  | { type: "play"; data: string; generation: number }
  | { type: "flush"; generation: number }
  | { type: "capture_gate"; epoch: number | null };
export type AudioEvent =
  | { type: "ready" | "stopped" }
  | { type: "capture"; data: string; epoch?: number }
  | { type: "played"; queuedMs: number }
  | { type: "error" };
export const audioEpoch = (n: unknown): n is number => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 0x7fffffff;
export function pcmBytes(data: unknown, max: number): number {
  if (
    typeof data !== "string" ||
    !data.length ||
    data.length > Math.ceil(max / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
  )
    return 0;
  const bytes = (data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
  return bytes > 0 && bytes <= max && bytes % 2 === 0 ? bytes : 0;
}
export function parseAudio(text: string, side: "cli" | "browser"): AudioCommand | AudioEvent | undefined {
  if (text.length > AUDIO_MAX_MESSAGE) return;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return;
  }
  if (!value || typeof value !== "object") return;
  const m = value as Record<string, unknown>;
  if (side === "cli") {
    if (m.type === "start" || m.type === "stop") return { type: m.type };
    if (m.type === "play" && audioEpoch(m.generation) && typeof m.data === "string" && pcmBytes(m.data, 9600))
      return { type: "play", data: m.data, generation: m.generation };
    if (m.type === "flush" && audioEpoch(m.generation)) return { type: "flush", generation: m.generation };
    if (m.type === "capture_gate" && (m.epoch === null || audioEpoch(m.epoch)))
      return { type: "capture_gate", epoch: m.epoch };
  } else {
    if (m.type === "ready" || m.type === "stopped" || m.type === "error") return { type: m.type };
    if (
      m.type === "capture" &&
      typeof m.data === "string" &&
      pcmBytes(m.data, 640) &&
      (m.epoch === undefined || audioEpoch(m.epoch))
    )
      return { type: "capture", data: m.data, ...(m.epoch === undefined ? {} : { epoch: m.epoch }) };
    if (
      m.type === "played" &&
      typeof m.queuedMs === "number" &&
      Number.isFinite(m.queuedMs) &&
      m.queuedMs >= 0 &&
      m.queuedMs <= 1200
    )
      return { type: "played", queuedMs: m.queuedMs };
  }
}
