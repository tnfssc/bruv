import type { Terminal } from "ghostty-web";

// Finger swipes use Ghostty's wheel path in the CLI and scrollLines in history.
export function installTerminalTouch(element: HTMLElement, term: Terminal) {
  let disposed = false;
  let gesture:
    | { id: number; y: number; startX: number; startY: number; lines: number; moved: boolean; scrolling: boolean }
    | undefined;
  const visible = () => !disposed && !element.hidden && element.isConnected;
  const cancel = () => {
    gesture = undefined;
  };
  const start = (event: TouchEvent) => {
    if (!visible() || event.touches.length !== 1) return cancel();
    const touch = event.touches[0];
    gesture = {
      id: touch.identifier,
      y: touch.clientY,
      startX: touch.clientX,
      startY: touch.clientY,
      lines: 0,
      moved: false,
      scrolling: false,
    };
  };
  const move = (event: TouchEvent) => {
    if (!visible() || !gesture || event.touches.length !== 1 || event.touches[0].identifier !== gesture.id)
      return cancel();
    const touch = event.touches[0];
    const delta = gesture.y - touch.clientY;
    const vertical = Math.abs(touch.clientY - gesture.startY);
    const horizontal = Math.abs(touch.clientX - gesture.startX);
    if (Math.max(vertical, horizontal) > 6) gesture.moved = true;
    if (!gesture.scrolling && vertical > 6 && vertical > horizontal) gesture.scrolling = true;
    gesture.y = touch.clientY;
    if (!gesture.scrolling) return;
    event.preventDefault();
    const screen = element.querySelector<HTMLCanvasElement>("canvas");
    if (!screen) return;
    const cellHeight = screen.clientHeight / term.rows;
    if (!cellHeight) return;
    gesture.lines += delta / cellHeight;
    const lines = Math.trunc(gesture.lines);
    if (!lines) return;
    gesture.lines -= lines;
    if (term.buffer.active.type === "alternate") {
      screen.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: lines,
          deltaMode: 1,
          clientX: touch.clientX,
          clientY: touch.clientY,
          bubbles: true,
          cancelable: true,
        }),
      );
    } else {
      term.scrollLines(lines);
    }
  };
  const end = (event: TouchEvent) => {
    // Ghostty 0.4.0 otherwise focuses unconditionally, even after cancellation.
    event.preventDefault();
    event.stopPropagation();
    const tap = visible() && gesture && !gesture.moved && event.touches.length === 0;
    cancel();
    if (tap) term.focus();
  };
  const canceled = (event: TouchEvent) => {
    event.stopPropagation();
    cancel();
  };
  element.addEventListener("touchstart", start, { passive: true, capture: true });
  element.addEventListener("touchmove", move, { passive: false, capture: true });
  element.addEventListener("touchend", end, { passive: false, capture: true });
  element.addEventListener("touchcancel", canceled, { capture: true });
  return {
    cancel,
    dispose() {
      disposed = true;
      cancel();
      element.removeEventListener("touchstart", start, true);
      element.removeEventListener("touchmove", move, true);
      element.removeEventListener("touchend", end, true);
      element.removeEventListener("touchcancel", canceled, true);
    },
  };
}
