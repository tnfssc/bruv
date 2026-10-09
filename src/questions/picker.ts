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

/** Searchable native TUI list. PgUp/PgDn scroll the full title and selected label. */
export class QuestionPicker implements Component, Focusable {
  focused = false;
  private input = new Input({ placeholder: "Filter…" });
  private list: SelectList;
  private filtered: SelectItem[];
  private detailOffset = 0;
  private detailPage = 1;
  private listSize: number;
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
    this.listSize = this.visibleItems();
    this.list = this.createList();
  }
  private visibleItems(): number {
    // Reserve borders, input, help, possible list scroll indicator and two detail rows.
    return Math.max(1, Math.min(8, this.rows() - 7));
  }
  private createList(): SelectList {
    return new SelectList(
      this.filtered,
      this.listSize,
      {
        selectedPrefix: (s) => this.theme.fg("accent", s),
        selectedText: (s) => this.theme.fg("accent", s),
        description: (s) => this.theme.fg("muted", s),
        scrollInfo: (s) => this.theme.fg("dim", s),
        noMatch: (s) => this.theme.fg("warning", s),
      },
      { maxPrimaryColumnWidth: 80 },
    );
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
    if (this.keys.matches(data, "tui.select.pageUp") || this.keys.matches(data, "tui.select.pageDown")) {
      this.detailOffset = Math.max(
        0,
        this.detailOffset + (this.keys.matches(data, "tui.select.pageDown") ? this.detailPage : -this.detailPage),
      );
    } else if (this.keys.matches(data, "tui.select.up") || this.keys.matches(data, "tui.select.down")) {
      this.list.handleInput(data);
      this.detailOffset = 0;
    } else {
      const before = this.input.getValue();
      this.input.handleInput(data);
      if (before !== this.input.getValue()) {
        const words = this.input.getValue().toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        this.filtered = this.items.filter((item) =>
          words.every((word) => `${item.label} ${item.description ?? ""}`.toLocaleLowerCase().includes(word)),
        );
        this.list = this.createList();
        this.detailOffset = 0;
      }
    }
    this.changed();
  }
  render(width: number): string[] {
    if (width < 1) return [];
    const size = this.visibleItems();
    if (size !== this.listSize) {
      const selected = this.list.getSelectedItem();
      this.listSize = size;
      this.list = this.createList();
      if (selected) this.list.setSelectedIndex(this.filtered.indexOf(selected));
    }
    const selected = this.list.getSelectedItem();
    const input = this.input.render(width);
    const list = this.list.render(width);
    const detail = [
      ...wrapTextWithAnsi(this.title, width),
      ...(selected ? ["", ...wrapTextWithAnsi(selected.label, width)] : []),
      ...(selected?.description ? ["", ...wrapTextWithAnsi(selected.description, width)] : []),
    ];
    const height = Math.max(1, this.rows());
    const room = Math.max(0, height - 3 - input.length - list.length);
    this.detailPage = Math.max(1, room);
    this.detailOffset = Math.min(this.detailOffset, Math.max(0, detail.length - room));
    // Tiny terminals cannot fit the chrome; keep the active choice visible first.
    if (height < 6) {
      return [...list.slice(0, 1), ...input, this.theme.fg("dim", "↑↓ · Enter · Esc")]
        .slice(0, height)
        .map((line) => truncateToWidth(line, width));
    }
    const lines = [
      this.theme.fg("accent", "─".repeat(width)),
      ...detail.slice(this.detailOffset, this.detailOffset + room),
      ...input,
      ...list,
      this.theme.fg("dim", "↑↓ · PgUp/PgDn details · type · Enter · Esc"),
      this.theme.fg("accent", "─".repeat(width)),
    ];
    return lines.slice(0, height).map((line) => truncateToWidth(line, width));
  }
  invalidate(): void {
    this.input.invalidate();
    this.list.invalidate();
  }
}
