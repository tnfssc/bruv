import type { Terminal } from "@xterm/xterm";

// xterm handles wheel input, but not finger swipes. Keep CLI history in its
// existing wheel path; normal scrollback uses xterm's public scrolling API.
export function installTerminalTouch(element: HTMLElement, term: Terminal) {
  let gesture: { y: number; startX: number; startY: number; lines: number; scrolling: boolean } | undefined;
  element.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1) {
        gesture = undefined;
        return;
      }
      const touch = event.touches[0];
      gesture = {
        y: touch.clientY,
        startX: touch.clientX,
        startY: touch.clientY,
        lines: 0,
        scrolling: false,
      };
    },
    { passive: true },
  );
  element.addEventListener(
    "touchmove",
    (event) => {
      if (!gesture || event.touches.length !== 1) {
        gesture = undefined;
        return;
      }
      const touch = event.touches[0];
      const delta = gesture.y - touch.clientY;
      const vertical = Math.abs(touch.clientY - gesture.startY);
      if (!gesture.scrolling && vertical > 6 && vertical > Math.abs(touch.clientX - gesture.startX))
        gesture.scrolling = true;
      gesture.y = touch.clientY;
      if (!gesture.scrolling) return;
      event.preventDefault();
      const screen = element.querySelector<HTMLElement>(".xterm-screen");
      if (!screen) return;
      if (term.buffer.active.type === "alternate") {
        screen.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: delta,
            deltaMode: 0,
            clientX: touch.clientX,
            clientY: touch.clientY,
            bubbles: true,
            cancelable: true,
          }),
        );
      } else {
        const cellHeight = screen.clientHeight / term.rows;
        if (!cellHeight) return;
        gesture.lines += delta / cellHeight;
        const lines = Math.trunc(gesture.lines);
        if (lines) {
          term.scrollLines(lines);
          gesture.lines -= lines;
        }
      }
    },
    { passive: false },
  );
  const end = () => {
    gesture = undefined;
  };
  element.addEventListener("touchend", end);
  element.addEventListener("touchcancel", end);
}
