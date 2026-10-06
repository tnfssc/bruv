import { getKeybindings, setKeybindings } from "@earendil-works/pi-tui";
import { KeybindingsManager } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { createHash } from "node:crypto";

/** Local deterministic branching fixture, independent of the shared navigation harness. */
export function selectorBehavior(Selector: any) {
  const previousKeybindings = getKeybindings();
  setKeybindings(new KeybindingsManager());
  const stamp = "2026-01-01T00:00:00.000Z";
  const user = (content: string) => ({ role: "user", content, timestamp: 0 });
  const assistant = (content: any[]) => ({ role: "assistant", content, stopReason: "stop", timestamp: 0 });
  const text = (value: string) => ({ type: "text", text: value });
  const records: any[] = [
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
  const nodes = new Map<string, any>();
  for (const [id, parentId, type, extra] of records)
    nodes.set(id, { entry: { id, parentId, type, timestamp: stamp, ...extra }, children: [] });
  nodes.get("alternate").label = "named branch";
  nodes.get("alternate").labelTimestamp = stamp;
  const roots: any[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(node.entry.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
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
  const list = component.getTreeList();
  const snapshots: any[] = [];
  const capture = (name: string) =>
    snapshots.push({
      name,
      selected: list.getSelectedNode()?.entry.id,
      visible: list.filteredNodes.map((flat: any) => ({
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
  for (const mode of ["user-only", "no-tools", "labeled-only", "all", "default"]) {
    list.filterMode = mode;
    list.applyFilter();
    capture(mode);
  }
  for (const letter of "needle") list.handleInput(letter);
  capture("search");
  list.handleInput("\x1b");
  capture("clear-search");
  list.updateNodeLabel("main", "edited label", stamp);
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
    "setting",
    "no-tools",
  ).getTreeList();
  snapshots.push({
    name: "hidden-ancestor-and-tool-leaf",
    selected: leafOnly.getSelectedNode()?.entry.id,
    ids: leafOnly.filteredNodes.map((flat: any) => flat.node.entry.id),
  });
  setKeybindings(previousKeybindings);
  return { snapshots, accepted, cancelled, hash: createHash("sha256").update(JSON.stringify(snapshots)).digest("hex") };
}
