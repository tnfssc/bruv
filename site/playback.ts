/** One clock for all demos; hidden/offscreen panels consume no playback time. */
export type Playback = { elapsed: number; paused: boolean; started?: boolean };
export function advance(playback: Playback, delta: number, duration: number, visible: boolean) {
  if (!playback.paused && visible && playback.elapsed < duration) {
    playback.started = true;
    playback.elapsed = Math.min(duration, playback.elapsed + delta);
  }
}
export function inView(y: number, height: number, top: number, bottom: number) {
  return (
    y + height <= bottom && Math.min(y + height, bottom) - Math.max(y, top) >= Math.min(height, bottom - top) * 0.75
  );
}
