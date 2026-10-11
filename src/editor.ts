import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type TuiMouseEvent, type TuiMouseEventResult, truncateToWidth } from "@earendil-works/pi-tui";

type Indicator = Parameters<CustomEditor["setWorkingStatusIndicator"]>[0];
const PROMPT = ""; // Nerd Font chevron
const TOP = "\u0000bruv-top";
const BOTTOM = "\u0000bruv-bottom";

/** Borderless input. The prompt mark turns into the working spinner; Pi keeps all editing and keys. */
export class CompactEditor extends CustomEditor {
  private indicator: Indicator;
  private gutter = 2;
  private rows = 1;
  private top = 0;
  private above = 0;
  private below = 0;

  override setWorkingStatusIndicator(indicator: Indicator): void {
    super.setWorkingStatusIndicator(indicator);
    this.indicator = indicator;
  }

  override setPaddingX(_padding: number): void {
    super.setPaddingX(0);
  }

  protected override renderTopBorder(_width: number, hidden: number): string {
    this.above = hidden;
    return TOP;
  }

  protected override renderBottomBorder(_width: number, hidden: number): string {
    this.below = hidden;
    return BOTTOM;
  }

  override render(width: number): string[] {
    if (width < 1) return [];
    this.gutter = width > 2 ? 2 : 0;
    const lines = super.render(width - this.gutter);
    const bottom = lines.indexOf(BOTTOM);
    this.rows = bottom - 1;
    const input = lines.slice(1, bottom).map((line, index) => {
      let mark = " ";
      if (index === 0)
        mark =
          this.indicator?.renderSpinnerInBorder(1) || this.borderColor(this.above ? (this.below ? "↕" : "↑") : PROMPT);
      else if (index === this.rows - 1 && this.below) mark = this.borderColor("↓");
      return truncateToWidth((this.gutter ? `${mark} ` : "") + line, width, "");
    });
    // Retries and compaction say what they are doing; plain work only shows the spinner.
    const status =
      this.indicator && this.indicator.kind !== "working"
        ? [truncateToWidth(this.indicator.renderInBorder(width), width)]
        : [];
    // Pi gives the input at least three rows. Fill from the top so the input sits on the footer.
    const fill = Array<string>(Math.max(0, 3 - status.length - input.length - (lines.length - bottom - 1))).fill("");
    this.top = fill.length + status.length;
    return [...fill, ...status, ...input, ...lines.slice(bottom + 1)];
  }

  override handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const y = event.y - this.top;
    if (y < 0) return undefined;
    return super.handleMouse({
      ...event,
      x: Math.max(0, event.x - this.gutter),
      y: y + (y < this.rows ? 1 : 2),
      width: Math.max(1, event.width - this.gutter),
      height: event.height - this.top + 2,
    });
  }
}

export function registerEditor(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    // Keep an editor another extension installed.
    if (ctx.mode !== "tui" || ctx.ui.getEditorComponent()) return;
    ctx.ui.setEditorComponent(
      (tui, theme, keybindings) =>
        new CompactEditor(tui, theme, keybindings, { paddingX: 0, embedWorkingStatus: true }),
    );
  });
}
