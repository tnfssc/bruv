/** One clock for all demos; hidden/offscreen panels consume no playback time. */
export type Playback = { elapsed: number; paused: boolean; started?: boolean };
/** The script already holds its outcome briefly; give readers six more seconds. */
export const FINAL_HOLD = 6000;
export function advance(playback: Playback, delta: number, duration: number, visible: boolean) {
  if (!playback.paused && visible) {
    playback.started = true;
    playback.elapsed = (playback.elapsed + Math.max(0, delta)) % (duration + FINAL_HOLD);
  }
}
export function inView(y: number, height: number, top: number, bottom: number) {
  return Math.min(y + height, bottom) - Math.max(y, top) >= Math.min(height, bottom - top) * 0.75;
}
