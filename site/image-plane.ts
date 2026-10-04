import { captures } from "./gallery";
import type { layout } from "./layout";
/** A raster-only canvas over Ghostty. No marketing text or controls live in this plane.
 * Ghostty 0.4.0's browser renderer does not expose image drawing; this compositor
 * consumes the same cell frame and clipping bounds as our ANSI layout.
 */
export class CellImagePlane {
  readonly canvas = document.createElement("canvas");
  private images = new Map<string, HTMLImageElement>();
  constructor(
    private host: HTMLElement,
    private terminalCanvas: HTMLCanvasElement,
  ) {
    this.canvas.className = "terminal-image-plane";
    this.canvas.setAttribute("aria-hidden", "true");
    host.append(this.canvas);
  }
  async load() {
    await Promise.all(
      captures.map(async (capture) => {
        const img = new Image();
        img.src = new URL("./assets/" + capture.file, document.baseURI).href;
        await img.decode();
        this.images.set(capture.id, img);
      }),
    );
    this.canvas.dataset.decoded = [...this.images.keys()].join(",");
  }
  render(frame: ReturnType<typeof layout>, cw: number, ch: number) {
    const rect = this.terminalCanvas.getBoundingClientRect(),
      hostRect = this.host.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.left = rect.left - hostRect.left + "px";
    this.canvas.style.top = rect.top - hostRect.top + "px";
    this.canvas.style.width = rect.width + "px";
    this.canvas.style.height = rect.height + "px";
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    const ctx = this.canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, frame.clip.top * ch, rect.width, (frame.clip.bottom - frame.clip.top) * ch);
    ctx.clip();
    for (const placement of frame.images) {
      const img = this.images.get(placement.id)!;
      // Narrow settings view is a left crop of the unmodified real capture.
      // It keeps the option names and values legible; full PNG remains one click away.
      const sw = placement.crop ? 660 : img.naturalWidth;
      const w = placement.width * cw,
        h = (w * img.naturalHeight) / sw;
      ctx.drawImage(img, 0, 0, sw, img.naturalHeight, placement.x * cw, placement.y * ch, w, h);
    }
    ctx.restore();
    this.canvas.dataset.visible = frame.images.map((p) => p.id).join(",");
    this.canvas.dataset.placements = JSON.stringify(frame.images);
  }
}
