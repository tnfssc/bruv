import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Input,
  SelectList,
  fuzzyFilter,
  truncateToWidth,
  type Component,
  type Focusable,
  type SelectItem,
  type KeybindingsManager,
} from "@earendil-works/pi-tui";
import {
  SUBAGENT_TYPES,
  THINKING_LEVELS,
  type Profiles,
  type SubagentType,
  type ThinkingLevel,
} from "../tasks/subagent-profiles";

export interface ProfileModel {
  provider: string;
  id: string;
  name?: string;
}
const INHERIT = "inherit";
type Screen = { kind: "profiles" } | { kind: "model" | "thinking"; type: SubagentType; returnRow: number };

/** One panel keeps the selected settings row while entering/leaving a picker. */
export class SubagentSettingsPanel implements Component, Focusable {
  private screen: Screen = { kind: "profiles" };
  private input = new Input({ placeholder: "Search models or providers…" });
  private list!: SelectList;
  private items: SelectItem[] = [];
  private selected = 0;
  private draft: Profiles;
  private models: ProfileModel[];
  private visible = 10;
  private hasFocus = false;
  get focused() {
    return this.hasFocus;
  }
  set focused(value: boolean) {
    this.hasFocus = value;
    this.input.focused = value && this.screen.kind === "model";
  }

  constructor(
    profiles: Profiles,
    models: ProfileModel[],
    private theme: Theme,
    private keys: KeybindingsManager,
    private done: (profiles?: Profiles) => void,
    private changed: () => void,
    private parentModel?: string,
    private parentThinking?: string,
  ) {
    this.draft = structuredClone(profiles);
    this.models = [...new Map(models.map((model) => [model.provider + "/" + model.id, model])).values()].sort((a, b) =>
      (a.provider + "/" + a.id).localeCompare(b.provider + "/" + b.id),
    );
    this.showProfiles(0);
  }
  private profileItems(): SelectItem[] {
    return SUBAGENT_TYPES.flatMap((type) => [
      {
        value: type + ":model",
        label: type + " model",
        description: this.draft[type].model ?? "Inherit from parent",
      },
      {
        value: type + ":thinking",
        label: type + " thinking",
        description: this.draft[type].thinking ?? "Inherit from parent",
      },
    ]).concat([
      { value: "save", label: "Save", description: "Apply to future sub-agents" },
      { value: "cancel", label: "Cancel", description: "Discard changes" },
    ]);
  }
  private thinkingItems(): SelectItem[] {
    return [
      {
        value: INHERIT,
        label: "Inherit from parent",
        description: this.parentThinking ?? "Calling agent's thinking level",
      },
      ...THINKING_LEVELS.map((value) => ({ value, label: value, description: "" })),
    ];
  }
  private modelItems(type: SubagentType): SelectItem[] {
    const current = this.draft[type].model;
    const models: SelectItem[] = this.models.map((model) => ({
      value: model.provider + "/" + model.id,
      label: model.id,
      description: model.provider + (model.name && model.name !== model.id ? " · " + model.name : ""),
    }));
    if (current && !models.some((model) => model.value === current))
      models.unshift({
        value: current,
        label: current,
        description: "Current setting · unavailable in this catalog",
      });
    const all = [
      { value: INHERIT, label: "Inherit from parent", description: this.parentModel ?? "Calling agent's model" },
      ...models,
    ];
    // Provider-first search avoids matching a model suffix against a later provider name.
    const query = this.input.getValue();
    const items = fuzzyFilter(all, query, (item) => item.value + " " + item.description + " " + item.label);
    const exact = query.trim().toLowerCase().replace(/\s+/g, "/");
    items.sort(
      (a, b) =>
        Number(b.value.toLowerCase() === exact || b.label.toLowerCase() === exact) -
        Number(a.value.toLowerCase() === exact || a.label.toLowerCase() === exact),
    );
    return items;
  }
  private showItems(items: SelectItem[], selected: number) {
    this.items = items;
    this.list = new SelectList(this.items, this.visible, {
      selectedPrefix: (t) => this.theme.fg("accent", t),
      selectedText: (t) => this.theme.fg("accent", t),
      description: (t) => this.theme.fg("muted", t),
      scrollInfo: (t) => this.theme.fg("dim", t),
      noMatch: (t) => this.theme.fg("warning", t),
    });
    this.selectIndex(selected);
    this.input.focused = this.hasFocus && this.screen.kind === "model";
  }
  private selectIndex(index: number) {
    this.selected = Math.max(0, Math.min(index, this.items.length - 1));
    this.list.setSelectedIndex(this.selected);
  }
  private showProfiles(row: number) {
    this.screen = { kind: "profiles" };
    this.input.setValue("");
    this.showItems(this.profileItems(), row);
  }
  private openPicker(type: SubagentType, kind: "model" | "thinking") {
    this.screen = { kind, type, returnRow: this.selected };
    const items = kind === "model" ? this.modelItems(type) : this.thinkingItems();
    const current = this.draft[type][kind] ?? INHERIT;
    this.showItems(
      items,
      items.findIndex((item) => item.value === current),
    );
  }
  private choose() {
    const item = this.items[this.selected];
    if (!item) return;
    const screen = this.screen;
    if (screen.kind === "profiles") {
      if (item.value === "save") {
        this.done(this.draft);
        return;
      }
      if (item.value === "cancel") {
        this.done();
        return;
      }
      const [type, field] = item.value.split(":");
      this.openPicker(type as SubagentType, field as "model" | "thinking");
    } else {
      const profile = this.draft[screen.type];
      if (screen.kind === "model") {
        if (item.value === INHERIT) delete profile.model;
        else profile.model = item.value;
      } else {
        if (item.value === INHERIT) delete profile.thinking;
        else profile.thinking = item.value as ThinkingLevel;
      }
      this.showProfiles(screen.returnRow);
    }
  }
  handleInput(data: string) {
    if (this.keys.matches(data, "tui.select.cancel")) {
      if (this.screen.kind === "profiles") this.done();
      else this.showProfiles(this.screen.returnRow);
    } else if (this.keys.matches(data, "tui.select.confirm")) this.choose();
    else {
      let move = 0;
      if (this.keys.matches(data, "tui.select.up")) move = -1;
      else if (this.keys.matches(data, "tui.select.down")) move = 1;
      else if (this.keys.matches(data, "tui.select.pageUp")) move = -this.visible;
      else if (this.keys.matches(data, "tui.select.pageDown")) move = this.visible;
      if (move) {
        this.selectIndex(this.selected + move);
      } else if (this.screen.kind === "model") {
        const before = this.input.getValue();
        this.input.handleInput(data);
        if (before !== this.input.getValue()) {
          this.showItems(this.modelItems(this.screen.type), 0);
        }
      }
    }
    this.changed();
  }
  render(width: number): string[] {
    if (width < 1) return [];
    const title = this.screen.kind === "profiles" ? "Sub-agent profiles" : this.screen.type + " · " + this.screen.kind;
    const selected = this.items[this.selected];
    const help =
      this.screen.kind === "profiles"
        ? "↑↓ navigate · Enter edit/select · Esc discard"
        : "↑↓ navigate · Enter select · Esc back";
    return [
      this.theme.fg("accent", "─".repeat(width)),
      this.theme.fg("accent", title),
      "",
      ...(this.screen.kind === "model" ? [...this.input.render(width), ""] : []),
      ...this.list.render(width),
      "",
      ...(this.screen.kind === "model" && !this.models.length
        ? ["No configured models. Use /login or configure providers."]
        : []),
      ...(selected && this.screen.kind === "model"
        ? [selected.value === INHERIT ? "Inherit from parent" : selected.value]
        : []),
      this.theme.fg("dim", help),
      this.theme.fg("accent", "─".repeat(width)),
    ].map((line) => truncateToWidth(line, width));
  }
  invalidate() {
    this.input.invalidate();
    this.list.invalidate();
  }
}
