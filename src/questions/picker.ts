import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Input,
  SelectList,
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
  type KeybindingsManager,
  type SelectItem,
} from "@earendil-works/pi-tui";

/** Searchable native TUI list; the full selected label remains visible below the list. */
export class QuestionPicker implements Component, Focusable {
  focused = false;
  private input = new Input({ placeholder: "Filter…" });
  private list: SelectList;
  private filtered: SelectItem[];
  constructor(
    private title: string,
    private items: SelectItem[],
    private theme: Theme,
    private keys: KeybindingsManager,
    private done: (value?: string) => void,
    private changed: () => void,
    private rows: () => number,
  ) {
    this.filtered = items;
    this.list = this.createList();
  }
  private createList(): SelectList {
    return new SelectList(this.filtered, Math.max(2, Math.min(8, this.rows() - 12)), {
      selectedPrefix: (s) => this.theme.fg("accent", s),
      selectedText: (s) => this.theme.fg("accent", s),
      description: (s) => this.theme.fg("muted", s),
      scrollInfo: (s) => this.theme.fg("dim", s),
      noMatch: (s) => this.theme.fg("warning", s),
    });
  }
  handleInput(data: string): void {
    if (this.keys.matches(data, "tui.select.cancel")) {
      this.done();
      return;
    }
    if (this.keys.matches(data, "tui.select.confirm")) {
      const item = this.list.getSelectedItem();
      if (item) this.done(item.value);
      return;
    }
    if (
      this.keys.matches(data, "tui.select.up") ||
      this.keys.matches(data, "tui.select.down") ||
      this.keys.matches(data, "tui.select.pageUp") ||
      this.keys.matches(data, "tui.select.pageDown")
    )
      this.list.handleInput(data);
    else {
      const before = this.input.getValue();
      this.input.handleInput(data);
      if (before !== this.input.getValue()) {
        const words = this.input.getValue().toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        this.filtered = this.items.filter((item) =>
          words.every((word) => (item.label + " " + (item.description ?? "")).toLocaleLowerCase().includes(word)),
        );
        this.list = this.createList();
      }
    }
    this.changed();
  }
  render(width: number): string[] {
    if (width < 1) return [];
    const selected = this.list.getSelectedItem();
    const lines = [
      this.theme.fg("accent", "─".repeat(width)),
      ...wrapTextWithAnsi(this.title, width),
      ...this.input.render(width),
      ...this.list.render(width),
      ...(selected ? ["", ...wrapTextWithAnsi(selected.label, width).slice(0, Math.max(1, this.rows() - 15))] : []),
      this.theme.fg("dim", "↑↓ move · type filter · Enter · Esc"),
      this.theme.fg("accent", "─".repeat(width)),
    ];
    return lines.map((line) => truncateToWidth(line, width));
  }
  invalidate(): void {
    this.input.invalidate();
    this.list.invalidate();
  }
}
