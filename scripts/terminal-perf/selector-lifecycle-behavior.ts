import { requireValue } from "../lib/require-value";
import type { SessionTreeNode } from "@earendil-works/pi-coding-agent";
import type { FilterMode } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tree-selector.js";
import { getKeybindings, setKeybindings } from "@earendil-works/pi-tui";
import { KeybindingsManager } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import type { TreeSelectorComponent } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tree-selector.js";

const fixtureTimestamp = "2026-01-01T00:00:00.000Z";

/** Local deterministic branching fixture, independent of the shared navigation harness. */
export function selectorBehavior(Selector: typeof TreeSelectorComponent) {
  const previousKeybindings = getKeybindings();
  try {
    setKeybindings(new KeybindingsManager());
    return replaySelectorBehavior(Selector, createBranchingTree());
  } finally {
    setKeybindings(previousKeybindings);
  }
}

function createBranchingTree() {
  const user = (content: string) => ({ role: "user", content, timestamp: 0 });
  const assistant = (content: object[]) => ({ role: "assistant", content, stopReason: "stop", timestamp: 0 });
  const text = (value: string) => ({ type: "text", text: value });
  const records: [string, string | null, string, object][] = [
    ["root", null, "message", { message: user("root needle request") }],
    ["setting", "root", "model_change", { provider: "offline", modelId: "model" }],
    ["main", "setting", "message", { message: assistant([text("primary needle answer")]) }],
    [
      "call",
      "main",
      "message",
      { message: assistant([{ type: "toolCall", id: "tc", name: "read", arguments: { path: "x" } }]) },
    ],
    [
      "result",
      "call",
      "message",
      {
        message: {
          role: "toolResult",
          toolCallId: "tc",
          toolName: "read",
          content: [text("tool needle")],
          isError: false,
          timestamp: 0,
        },
      },
    ],
    ["leaf", "result", "message", { message: assistant([text("long primary leaf 你好 needle text")]) }],
    ["alternate", "root", "message", { message: assistant([text("alternate branch")]) }],
    ["alt-leaf", "alternate", "message", { message: user("another needle request") }],
    ["second-root", null, "custom", { customType: "metadata", data: {} }],
    ["second-leaf", "second-root", "message", { message: user("independent branch") }],
  ];
  const nodes = new Map<string, SessionTreeNode>();
  for (const [id, parentId, type, extra] of records)
    nodes.set(id, {
      entry: { id, parentId, type, timestamp: fixtureTimestamp, ...extra } as SessionTreeNode["entry"],
      children: [],
    });
  requireValue(nodes.get("alternate")).label = "named branch";
  requireValue(nodes.get("alternate")).labelTimestamp = fixtureTimestamp;
  const roots: SessionTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.entry.parentId ? nodes.get(node.entry.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function replaySelectorBehavior(Selector: typeof TreeSelectorComponent, roots: SessionTreeNode[]) {
  let accepted: string | undefined;
  let cancelled = 0;
  const component = new Selector(
    roots,
    "leaf",
    24,
    (id: string) => {
      accepted = id;
    },
    () => {
      cancelled++;
    },
  );
  // The replay deliberately inspects and drives private projection state.
  type TreeListState = {
    filteredNodes: {
      node: SessionTreeNode;
      indent: number;
      showConnector: boolean;
      isLast: boolean;
      gutters: boolean[];
      isVirtualRootChild: boolean;
    }[];
    selectedIndex: number;
    filterMode: FilterMode;
    searchQuery: string;
    findNearestVisibleIndex(id: string): number;
    applyFilter(): void;
  } & Pick<ReturnType<TreeSelectorComponent["getTreeList"]>, "getSelectedNode" | "handleInput" | "updateNodeLabel">;
  const list = component.getTreeList() as unknown as TreeListState;
  const snapshots: Array<{
    name: string;
    selected: string | undefined;
    visible?: Array<{
      id: string;
      indent: number;
      connector: boolean;
      last: boolean;
      gutters: boolean[];
      virtual: boolean;
    }>;
    screen80?: string[];
    screen20?: string[];
    ids?: string[];
  }> = [];
  const capture = (name: string) =>
    snapshots.push({
      name,
      selected: list.getSelectedNode()?.entry.id,
      visible: list.filteredNodes.map((flat) => ({
        id: flat.node.entry.id,
        indent: flat.indent,
        connector: flat.showConnector,
        last: flat.isLast,
        gutters: flat.gutters,
        virtual: flat.isVirtualRootChild,
      })),
      screen80: component.render(80),
      screen20: component.render(20),
    });
  capture("initial");
  // Exercise keyboard branch fold/unfold on a branching parent.
  list.selectedIndex = list.findNearestVisibleIndex("root");
  list.handleInput("\x1b[1;5D");
  capture("fold");
  list.handleInput("\x1b[1;5C");
  capture("unfold");
  for (const mode of ["user-only", "no-tools", "labeled-only", "all", "default"] as const) {
    list.filterMode = mode;
    list.applyFilter();
    capture(mode);
  }
  for (const letter of "needle") list.handleInput(letter);
  capture("search");
  list.handleInput("\x1b");
  capture("clear-search");
  list.updateNodeLabel("main", "edited label", fixtureTimestamp);
  list.filterMode = "labeled-only";
  list.applyFilter();
  capture("edited-label");
  list.searchQuery = "not present";
  list.applyFilter();
  capture("empty-search");
  list.handleInput("\x1b");
  capture("restore-selection");
  list.handleInput("\r");
  list.handleInput("\x1b");
  const leafOnly = new Selector(
    roots,
    "call",
    24,
    () => {},
    () => {},
    undefined, // No label-change callback; selection and filter occupy the next slots.
    "setting",
    "no-tools",
  ).getTreeList() as unknown as TreeListState;
  snapshots.push({
    name: "hidden-ancestor-and-tool-leaf",
    selected: leafOnly.getSelectedNode()?.entry.id,
    ids: leafOnly.filteredNodes.map((flat) => flat.node.entry.id),
  });
  return { snapshots, accepted, cancelled };
}
