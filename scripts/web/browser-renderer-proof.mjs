import assert from "node:assert/strict";

// Observe the renderer's actual draw calls. No terminal internals or app test hook.
export async function watchRenderer(page) {
  await page.addInitScript(() => {
    window.terminalPaint = new WeakMap();
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
      if (this.canvas.closest?.(".terminal-pane")) {
        let cells = window.terminalPaint.get(this.canvas);
        if (!cells) {
          cells = new Map();
          window.terminalPaint.set(this.canvas, cells);
        }
        cells.set(x + ":" + y, { text, x, y, font: this.font, color: this.fillStyle });
      }
      return fillText.call(this, text, x, y, ...rest);
    };
  });
}

export async function paintedTerminal(page) {
  const handle = await page.waitForFunction(() => {
    const canvas = document.querySelector(".terminal-pane:not([hidden]) canvas");
    if (!canvas?.width || !canvas.height) return null;
    const ctx = canvas.getContext("2d"),
      pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) ink++;
    const cells = [...(window.terminalPaint?.get(canvas)?.values() || [])];
    if (ink <= 100 || !cells.some((cell) => /[^\s]/u.test(cell.text))) return null;
    return { width: canvas.width, height: canvas.height, css: canvas.getBoundingClientRect().toJSON(), ink, cells };
  });
  const paint = await handle.jsonValue();
  await handle.dispose();
  assert(paint && paint.width > 0 && paint.height > 0, "Terminal canvas has no size");
  assert(paint.ink > 100, "Terminal canvas is blank");
  assert(
    paint.cells.some((cell) => /[^\s]/u.test(cell.text)),
    "Renderer did not draw glyphs",
  );
  return paint;
}
