import assert from "node:assert/strict";

// Receipts for visible draw calls, invalidated by paints and bitmap resets.
// No terminal internals or app test hook.
export async function watchRenderer(page) {
  await page.addInitScript(() => {
    window.terminalPaint = new WeakMap();
    const bounds = (ctx, x, y, w, h) => {
      const m = ctx.getTransform();
      const left = x * m.a + y * m.c + m.e;
      const top = x * m.b + y * m.d + m.f;
      return { left, top, right: left + w * m.a, bottom: top + h * m.d };
    };
    const invalidate = (ctx, area) => {
      const cells = window.terminalPaint.get(ctx.canvas);
      if (!cells) return;
      for (const [key, cell] of cells) {
        const b = cell.bounds;
        if (b.left < area.right && b.right > area.left && b.top < area.bottom && b.bottom > area.top) cells.delete(key);
      }
    };
    for (const method of ["clearRect", "fillRect"]) {
      const original = CanvasRenderingContext2D.prototype[method];
      CanvasRenderingContext2D.prototype[method] = function (x, y, w, h) {
        invalidate(this, bounds(this, x, y, w, h));
        return original.call(this, x, y, w, h);
      };
    }
    // Resizing resets the bitmap and context without a clearRect call.
    for (const property of ["width", "height"]) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property);
      Object.defineProperty(HTMLCanvasElement.prototype, property, {
        ...descriptor,
        set(value) {
          window.terminalPaint.delete(this);
          descriptor.set.call(this, value);
        },
      });
    }
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, ...rest) {
      if (this.canvas.closest?.(".terminal-pane")) {
        let cells = window.terminalPaint.get(this.canvas);
        if (!cells) {
          cells = new Map();
          window.terminalPaint.set(this.canvas, cells);
        }
        const metrics = this.measureText(text);
        const area = bounds(
          this,
          x - metrics.actualBoundingBoxLeft,
          y - metrics.actualBoundingBoxAscent,
          metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
          metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
        );
        if (area.right > 0 && area.bottom > 0 && area.left < this.canvas.width && area.top < this.canvas.height)
          cells.set(x + ":" + y, { text, x, y, font: this.font, color: this.fillStyle, bounds: area });
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
