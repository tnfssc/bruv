import { FitAddon, Ghostty, Terminal } from "ghostty-web";
import { installTerminalAccessibility } from "./browser-terminal-accessibility";
import { connectBrowserAudio } from "./browser-audio";
import { installTerminalTouch } from "./browser-terminal-touch";

type Tab = { id: string; name: string; pid?: number; exited?: boolean };
type Workspace = { id: string; name: string; cwd: string; tabs: Tab[] };
type WorkspaceState = {
  revision: number;
  voice: { tabId: string; ownerId: string } | null;
  workspaces: Workspace[];
  defaultCwd: string;
};
type OpenedWorkspace = WorkspaceState & { workspaceId: string; created: boolean };
type Session = {
  id: string;
  term: Terminal;
  fit: FitAddon;
  element: HTMLElement;
  touch: ReturnType<typeof installTerminalTouch>;
  accessibility: ReturnType<typeof installTerminalAccessibility>;
  socket?: WebSocket;
  sequence: number;
  ready: boolean;
  halted: boolean;
  loss?: "view" | "exit";
  capability?: string;
  ownerId?: string;
  reconnect?: ReturnType<typeof setTimeout>;
  status: string;
  viewport?: { cols: number; rows: number };
};
type VoiceOwner = {
  request: string;
  controller: AbortController;
  tabId: string;
  capability: string;
  ownerId: string;
  generation: number;
  state: string;
  pending: boolean;
  releasing: boolean;
  device?: Awaited<ReturnType<typeof connectBrowserAudio>>;
};
function requiredElement<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}
const status = requiredElement<HTMLElement>("#status");
const container = requiredElement<HTMLElement>("#terminal");
const workspaceList = requiredElement<HTMLElement>("#workspace-list");
const tabList = requiredElement<HTMLElement>("#tab-list");
const notice = requiredElement<HTMLElement>("#notice");
const syncStatus = requiredElement<HTMLElement>("#sync-status");
const audioStatus = requiredElement<HTMLElement>("#audio-status");
const empty = requiredElement<HTMLElement>("#empty-terminal");
const voiceControl = requiredElement<HTMLElement>("#voice-status");
const folderForm = requiredElement<HTMLFormElement>("#folder-form");
const folderInput = requiredElement<HTMLInputElement>("#folder-input");
const folderError = requiredElement<HTMLElement>("#folder-error");
const terminalStatus = requiredElement<HTMLElement>("#terminal-status");
const action = (id: string) => requiredElement<HTMLButtonElement>("#" + id);

let drawerOpen = false;
function setDrawer(open: boolean) {
  if (drawerOpen === open) return;
  drawerOpen = open;
  document.body.setAttribute("data-drawer", open ? "open" : "closed");
  action("open-drawer").setAttribute("aria-expanded", String(open));
  action("drawer-backdrop").hidden = !open;
  requiredElement<HTMLElement>("main").inert = open;
  action(open ? "close-drawer" : "open-drawer").focus();
}
action("open-drawer").addEventListener("click", () => setDrawer(true));
for (const id of ["close-drawer", "drawer-backdrop"]) action(id).addEventListener("click", () => setDrawer(false));
requiredElement<HTMLElement>("#workspace-sidebar").addEventListener("keydown", (event) => {
  if (!drawerOpen) return;
  if (event.key === "Escape") {
    setDrawer(false);
    return;
  }
  if (event.key !== "Tab") return;
  const choices = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      "#workspace-sidebar button:not(:disabled), #workspace-sidebar input:not(:disabled)",
    ),
  );
  const first = choices[0],
    last = choices.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
});
window.addEventListener("resize", () => {
  if (window.innerWidth > 700) setDrawer(false);
});

type DialogOptions = {
  title: string;
  description: string;
  label?: string;
  value?: string;
  submit: string;
  destructive?: boolean;
};
const dialog = requiredElement<HTMLDialogElement>("#workspace-dialog");
const dialogInput = requiredElement<HTMLInputElement>("#dialog-input");
let dialogResult: ((value: string | null) => void) | undefined;
function askDialog(options: DialogOptions): Promise<string | null> {
  requiredElement<HTMLElement>("#dialog-title").textContent = options.title;
  requiredElement<HTMLElement>("#dialog-description").textContent = options.description;
  requiredElement<HTMLElement>("#dialog-label").textContent = options.label ?? "";
  requiredElement<HTMLElement>("#dialog-field").hidden = !options.label;
  dialogInput.required = !!options.label;
  dialogInput.value = options.value ?? "";
  action("dialog-submit").textContent = options.submit;
  action("dialog-submit").className = options.destructive ? "btn btn-outline btn-error" : "btn btn-primary";
  dialog.showModal();
  if (options.label) {
    dialogInput.focus();
    dialogInput.select();
  } else action("dialog-cancel").focus();
  return new Promise((resolve) => {
    dialogResult = resolve;
  });
}
requiredElement<HTMLFormElement>("#dialog-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (dialogInput.required && !dialogInput.value.trim()) {
    dialogInput.focus();
    return;
  }
  finishDialog(dialogInput.value);
});
function finishDialog(value: string | null) {
  // Settle before closing: native focus returns before the queued close event.
  const resolve = dialogResult;
  dialogResult = undefined;
  dialog.close();
  resolve?.(value);
}
action("dialog-cancel").addEventListener("click", () => finishDialog(null));
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  finishDialog(null);
});

// Storage can be blocked by browser privacy settings. The full URL still works.
let token = new URLSearchParams(location.hash.slice(1)).get("token");
try {
  token ??= sessionStorage.getItem("bruv-terminal-token");
  if (token) sessionStorage.setItem("bruv-terminal-token", token);
} catch {}
// Keep the capability out of request URLs, history entries and referrers.
history.replaceState(null, "", location.pathname);
const storageKey = "bruv-workspace-selection:" + token;
let selectedWorkspace = "";
let selectedTabs: Record<string, string> = {};
try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
  if (saved) {
    selectedWorkspace = saved.workspaceId;
    selectedTabs = saved.tabs;
  }
} catch {}
let state: WorkspaceState = { revision: -1, voice: null, workspaces: [], defaultCwd: "" };
let eventsSocket: WebSocket | undefined;
let eventsReconnect: ReturnType<typeof setTimeout> | undefined;
const sessions = new Map<string, Session>();
let accessRequired = !token;
let listLoaded = false;
let listFailed = false;
let folderOpen = false;
let voiceError: { tabId: string; message: string } | undefined;
let busy = false;
let unloading = false;
let voice: VoiceOwner | undefined;
let voiceGeneration = 0;
const socketOrigin = location.origin.replace(/^http/, "ws");
const workspace = () => state.workspaces.find((item) => item.id === selectedWorkspace);
const selected = () => sessions.get(selectedTabs[selectedWorkspace]);
function persistSelection() {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify({ workspaceId: selectedWorkspace, tabs: selectedTabs }));
  } catch {}
}
function button(text: string, label: string, click: () => void) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  element.setAttribute("aria-label", label);
  element.addEventListener("click", click);
  return element;
}
function voiceLabel(tabId: string) {
  for (const item of state.workspaces) {
    const tab = item.tabs.find((tab) => tab.id === tabId);
    if (tab) {
      return item.name + " / " + tab.name;
    }
  }
  return tabId;
}
function renderAudio() {
  const shared = state.voice;
  const elsewhere = shared && sessions.get(shared.tabId)?.ownerId !== shared.ownerId;
  voiceControl.hidden = !(voice || shared || voiceError);
  audioStatus.textContent = voiceError
    ? voiceError.message + " · " + voiceLabel(voiceError.tabId)
    : voice
      ? (voice.releasing ? "Releasing microphone…" : voice.state) +
        (selected()?.id === voice.tabId ? "" : " · " + voiceLabel(voice.tabId))
      : shared
        ? (elsewhere ? "Voice in another browser · " : "Releasing microphone… · ") + voiceLabel(shared.tabId)
        : "";
  voiceControl.setAttribute("data-elsewhere", String(!!elsewhere));
  action("cancel-voice").hidden = !voice?.pending || voice.releasing;
  action("dismiss-voice").hidden = !voiceError;
}
action("cancel-voice").addEventListener("click", () => {
  const owner = voice;
  if (!owner?.pending || owner.releasing) return;
  const session = sessions.get(owner.tabId);
  if (session && session.capability === owner.capability && session.ownerId === owner.ownerId)
    send(session, { type: "audio-error", request: owner.request, message: "Microphone request cancelled." });
  void releaseVoice();
});
action("dismiss-voice").addEventListener("click", () => {
  voiceError = undefined;
  renderAudio();
});
function renderStatus() {
  const active = selected();
  status.textContent = active?.status ?? "";
  terminalStatus.hidden = !active || active.ready || accessRequired;
  action("lost-new-tab").hidden = active?.loss !== "view";
  renderAudio();
}
function selectWorkspace(id: string) {
  selectedWorkspace = id;
  setDrawer(false);
  render();
  selected()?.term.focus();
}
function selectTab(id: string) {
  selectedTabs[selectedWorkspace] = id;
  render();
  selected()?.term.focus();
}
function revealTabShell(shell: HTMLElement | null) {
  if (!shell) return;
  const rect = shell.getBoundingClientRect();
  const bounds = tabList.getBoundingClientRect();
  if (rect.left < bounds.left) tabList.scrollLeft += rect.left - bounds.left;
  else if (rect.right > bounds.right) tabList.scrollLeft += rect.right - bounds.right;
  updateTabOverflow();
}
function revealSelectedTab() {
  revealTabShell(document.getElementById("tab-" + selectedTabs[selectedWorkspace])?.parentElement ?? null);
}
function updateTabOverflow() {
  const bounds = tabList.getBoundingClientRect();
  for (const shell of Array.from(tabList.children)) {
    const rect = shell.getBoundingClientRect();
    const close = shell.querySelector<HTMLButtonElement>(".tab-close");
    if (close) close.style.visibility = rect.left < bounds.left - 1 || rect.right > bounds.right + 1 ? "hidden" : "";
  }
  tabList.setAttribute("data-start-clipped", String(tabList.scrollLeft > 1));
  tabList.setAttribute("data-end-clipped", String(tabList.scrollWidth - tabList.clientWidth - tabList.scrollLeft > 1));
}
tabList.addEventListener("scroll", updateTabOverflow);
// Keep the input node in place across shared snapshots. Only Enter submits.
let editingTab: { id: string; input: HTMLInputElement } | undefined;
let lastTouch: { id: string; time: number } | undefined;
function finishRename(save: boolean, restoreFocus = true) {
  const edit = editingTab;
  if (!edit) return;
  const name = edit.input.value.trim();
  const currentTab = workspace()?.tabs.find((tab) => tab.id === edit.id);
  if (save && name && currentTab && name !== currentTab.name) {
    if (busy) return;
    edit.input.readOnly = true;
    void change("/api/tabs/" + encodeURIComponent(edit.id), "PATCH", { name }).then((ok) => {
      if (editingTab !== edit) return;
      edit.input.readOnly = false;
      if (ok) {
        finishRename(false, false);
        if (restoreFocus) selected()?.term.focus();
      } else edit.input.focus({ preventScroll: true });
    });
    return;
  }
  editingTab = undefined;
  if (edit.input.parentElement) edit.input.parentElement.style.width = "";
  render();
  if (restoreFocus) {
    if (save) selected()?.term.focus();
    else document.getElementById("tab-" + edit.id)?.focus({ preventScroll: true });
  }
}
function startRename(id: string) {
  if (busy || editingTab || !token) return;
  const tab = workspace()?.tabs.find((tab) => tab.id === id);
  const entry = document.getElementById("tab-" + id);
  if (!tab || !entry) return;
  const input = document.createElement("input");
  input.className = "input tab-name-input";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.id = "tab-name-" + id;
  input.setAttribute("aria-label", "Tab name");
  input.title = "Enter to save · Escape or leave to cancel";
  input.value = tab.name;
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      finishRename(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishRename(false);
    }
  });
  input.addEventListener("blur", () => finishRename(false, false));
  editingTab = { id, input };
  const shell = entry.parentElement;
  if (!shell) throw new Error("Missing tab shell");
  shell.style.width = shell.getBoundingClientRect().width + "px";
  entry.replaceWith(input);
  input.focus({ preventScroll: true });
  input.select();
}
function tabButton(tab: Tab) {
  const entry = button("", "", () => {
    if (!editingTab) selectTab(tab.id);
  });
  entry.className = "btn btn-ghost tab-select";
  entry.id = "tab-" + tab.id;
  entry.setAttribute("role", "tab");
  entry.setAttribute("aria-controls", "terminal-" + tab.id);
  entry.setAttribute("aria-keyshortcuts", "F2");
  entry.addEventListener("dblclick", () => startRename(tab.id));
  entry.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      selectTab(tab.id);
    }
    if (event.key === "F2") {
      event.preventDefault();
      startRename(tab.id);
    }
  });
  entry.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "touch") return;
    const time = event.timeStamp;
    if (lastTouch?.id === tab.id && time - lastTouch.time < 450) {
      lastTouch = undefined;
      event.preventDefault();
      startRename(tab.id);
    } else lastTouch = { id: tab.id, time };
  });
  return entry;
}
let scrolledTab: string | undefined;
// Shared snapshots update rows, not their identity or local focus.
function renderWorkspaces() {
  const rows = new Map(Array.from(workspaceList.children).map((row) => [row.id, row]));
  for (const [id, row] of rows) {
    if (!state.workspaces.some((item) => "workspace-row-" + item.id === id)) {
      row.remove();
      rows.delete(id);
    }
  }
  let index = 0;
  for (const item of state.workspaces) {
    const id = "workspace-row-" + item.id;
    let row = rows.get(id);
    rows.delete(id);
    if (!row) {
      row = document.createElement("div");
      row.id = id;
      row.className = "workspace-row";
      const entry = button("", "", () => selectWorkspace(item.id));
      entry.id = "workspace-" + item.id;
      entry.className = "btn btn-ghost workspace";
      entry.innerHTML = '<span class="workspace-name"></span><small></small>';
      const remove = button("×", "", () => void removeWorkspace(item.id));
      remove.id = "workspace-remove-" + item.id;
      remove.className = "btn btn-ghost btn-square workspace-remove";
      row.append(entry, remove);
    }
    const entry = row.firstElementChild as HTMLButtonElement;
    entry.title = item.cwd;
    entry.setAttribute("aria-label", "Open workspace " + item.name + " · " + item.cwd);
    entry.setAttribute("aria-pressed", String(item.id === selectedWorkspace));
    requiredElement(".workspace-name", entry).textContent = item.name;
    const suffix = requiredElement("small", entry);
    const duplicates = state.workspaces.filter((other) => other.name === item.name);
    suffix.textContent = duplicates.length > 1 ? distinguishingPath(item, duplicates) : "";
    suffix.hidden = duplicates.length < 2;
    const remove = row.lastElementChild as HTMLButtonElement;
    remove.setAttribute("aria-label", "Remove workspace " + item.name + " · " + item.cwd);
    remove.title = "Remove workspace " + item.name;
    remove.disabled = busy;
    if (workspaceList.children[index] !== row) workspaceList.insertBefore(row, workspaceList.children[index] ?? null);
    index++;
  }
  for (const row of rows.values()) row.remove();
}
function distinguishingPath(item: Workspace, duplicates: Workspace[]) {
  const parts = item.cwd.split("/").filter(Boolean);
  for (let count = 2; count <= parts.length; count++) {
    const suffix = parts.slice(-count).join("/");
    if (duplicates.every((other) => other.id === item.id || !other.cwd.endsWith("/" + suffix))) return suffix;
  }
  return item.cwd;
}
function render() {
  const focusedTabControl = document.activeElement?.id;
  const tabScroll = tabList.scrollLeft;
  renderWorkspaces();
  const current = workspace();
  if (editingTab && !current?.tabs.some((tab) => tab.id === editingTab?.id)) editingTab = undefined;
  const previous = new Map(Array.from(tabList.children).map((shell) => [shell.id, shell]));
  for (const [id, shell] of previous) {
    if (!current?.tabs.some((tab) => "tab-shell-" + tab.id === id)) {
      shell.remove();
      previous.delete(id);
    }
  }
  let index = 0;
  for (const tab of current?.tabs ?? []) {
    const shellId = "tab-shell-" + tab.id;
    const shell = previous.get(shellId) ?? document.createElement("div");
    previous.delete(shellId);
    shell.id = shellId;
    shell.className = "terminal-tab";
    shell.setAttribute("role", "presentation");
    const active = tab.id === selectedTabs[selectedWorkspace];
    shell.setAttribute("data-active", String(active));
    if (editingTab?.id !== tab.id) {
      let entry = shell.firstElementChild as HTMLButtonElement | null;
      if (!entry?.classList.contains("tab-select")) {
        const replacement = tabButton(tab);
        if (entry) entry.replaceWith(replacement);
        else shell.append(replacement);
        entry = replacement;
      }
      entry.textContent =
        tab.name +
        (sessions.get(tab.id)?.loss === "view"
          ? " · view lost"
          : tab.exited || sessions.get(tab.id)?.loss === "exit"
            ? " · ended"
            : "");
      entry.setAttribute("aria-label", "Select tab " + entry.textContent);
      entry.setAttribute("aria-selected", String(active));
      entry.title = entry.textContent + " · Double-click or double-tap to rename (F2)";
      entry.tabIndex = active ? 0 : -1;
    }
    let close = shell.children[1] as HTMLButtonElement | undefined;
    if (!close) {
      close = button("×", "", () => {
        const currentTab = workspace()?.tabs.find((item) => item.id === tab.id);
        if (currentTab) void closeTab(currentTab);
      });
      close.id = "tab-close-" + tab.id;
      close.className = "btn btn-ghost btn-square tab-close";
      shell.append(close);
    }
    const closeLabel = (tab.exited || sessions.get(tab.id)?.loss === "exit" ? "Remove tab " : "Close tab ") + tab.name;
    close.setAttribute("aria-label", closeLabel);
    close.title = closeLabel;
    close.disabled = busy;
    if (tabList.children[index] !== shell) tabList.insertBefore(shell, tabList.children[index] ?? null);
    index++;
  }
  tabList.scrollLeft = tabScroll;
  if (focusedTabControl?.startsWith("tab-")) document.getElementById(focusedTabControl)?.focus({ preventScroll: true });
  const activeTabId = selectedTabs[selectedWorkspace];
  if (scrolledTab !== activeTabId) {
    scrolledTab = activeTabId;
    requestAnimationFrame(revealSelectedTab);
  }
  const active = selected();
  let selectionChanged = false;
  for (const session of sessions.values()) {
    const hidden = session !== active || accessRequired;
    if (session.element.hidden !== hidden) {
      selectionChanged = true;
      if (hidden) hideSession(session);
    }
    session.element.hidden = hidden;
    session.accessibility.setActive(!hidden && !document.hidden);
  }
  empty.hidden = !!active && !accessRequired;
  syncStatus.hidden = !listLoaded;
  notice.hidden = !listLoaded || accessRequired;
  requiredElement<HTMLElement>(".tab-bar").hidden = accessRequired || !state.workspaces.length;
  const awaiting = !accessRequired && !listLoaded;
  requiredElement("h1", empty).textContent = accessRequired
    ? "Access required"
    : awaiting
      ? listFailed
        ? "Workspace list unavailable"
        : "Loading workspaces…"
      : current
        ? "No terminals in " + current.name
        : "Open a folder";
  requiredElement("p", empty).textContent = accessRequired
    ? "Open the full URL printed by bruv web, including its token."
    : awaiting
      ? listFailed
        ? "Check the server connection, then retry."
        : ""
      : "";
  action("empty-action").textContent = awaiting ? "Retry" : "New terminal";
  action("empty-action").hidden = accessRequired || (!current && !listFailed);
  action("empty-action").disabled = busy;
  action("add-workspace").hidden = accessRequired || !listLoaded || !state.workspaces.length;
  action("new-tab").hidden = accessRequired || !current || !active;
  action("new-tab").disabled = busy;
  action("open-drawer").hidden = accessRequired || (!current && !state.workspaces.length);
  requiredElement<HTMLElement>("#current-workspace").textContent = current?.name ?? "Folders";
  action("open-drawer").title = current?.cwd ?? "Workspaces";
  action("open-drawer").setAttribute("aria-label", "Open workspaces" + (current ? " · " + current.name : ""));
  const showFolder = !accessRequired && listLoaded && (!current || folderOpen);
  folderForm.hidden = !showFolder;
  if (showFolder) {
    const host = requiredElement<HTMLElement>(current ? "#rail-entry" : "#empty-entry");
    if (folderForm.parentElement !== host) {
      const focused = document.activeElement === folderInput;
      const start = folderInput.selectionStart,
        end = folderInput.selectionEnd;
      host.append(folderForm);
      if (focused) {
        folderInput.focus();
        folderInput.setSelectionRange(start, end);
      }
    }
  }
  action("cancel-folder").hidden = !current;
  action("cancel-folder").disabled = busy;
  action("open-folder").disabled = busy;
  if (drawerOpen && !state.workspaces.length) {
    setDrawer(false);
    if (showFolder) folderInput.focus();
  }
  persistSelection();
  renderStatus();
  requestAnimationFrame(updateTabOverflow);
  if (selectionChanged) requestAnimationFrame(resizeSelected);
}
function send(session: Session, message: object) {
  if (session.ready && session.socket?.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify(message));
}
function sendInput(session: Session, data: string, binary = false) {
  // Each frame stays below the server's 64 KiB input bound, including UTF-8.
  for (let start = 0; start < data.length; ) {
    let end = Math.min(start + 16_384, data.length);
    const last = data.charCodeAt(end - 1);
    if (!binary && end < data.length && last >= 0xd800 && last <= 0xdbff) end--;
    const chunk = data.slice(start, end);
    send(session, {
      type: "input",
      data: binary ? btoa(chunk) : chunk,
      ...(binary ? { encoding: "base64" } : {}),
    });
    start = end;
  }
}
function hideSession(session: Session) {
  session.touch.cancel();
  session.term.blur();
  send(session, { type: "visibility", active: false });
  session.viewport = undefined;
}
function resizeSelected() {
  const session = selected();
  if (
    !session ||
    session.element.hidden ||
    document.hidden ||
    !session.ready ||
    container.clientWidth < 1 ||
    container.clientHeight < 1
  )
    return;
  // Measure our available space without resizing locally. Only the server chooses
  // shared geometry; its size messages must never cause a resize reply.
  const dimensions = session.fit.proposeDimensions();
  if (!dimensions || !Number.isFinite(dimensions.cols) || !Number.isFinite(dimensions.rows)) return;
  if (session.viewport?.cols === dimensions.cols && session.viewport.rows === dimensions.rows) return;
  session.viewport = dimensions;
  send(session, { type: "resize", ...dimensions });
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    for (const session of sessions.values()) {
      hideSession(session);
      session.accessibility.setActive(false);
    }
  } else {
    const session = selected();
    if (session) session.accessibility.setActive(!session.element.hidden);
    requestAnimationFrame(resizeSelected);
  }
});
new ResizeObserver(resizeSelected).observe(container);
new ResizeObserver(updateTabOverflow).observe(tabList);
window.visualViewport?.addEventListener("resize", resizeSelected);
window.addEventListener("resize", () => requestAnimationFrame(revealSelectedTab));
tabList.addEventListener("keydown", (event) => {
  if ((event.target as HTMLElement)?.getAttribute("role") !== "tab") return;
  const tabs = workspace()?.tabs ?? [];
  const index = tabs.findIndex((tab) => tab.id === selectedTabs[selectedWorkspace]);
  let next: number;
  if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
  else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = tabs.length - 1;
  else return;
  if (!tabs[next]) return;
  event.preventDefault();
  selectTab(tabs[next].id);
  document.getElementById("tab-" + tabs[next].id)?.focus();
});

// Only the CLI request can start voice. Selection and focus never move it.
async function releaseVoice() {
  const owner = voice;
  if (!owner || owner.releasing) return;
  owner.releasing = true;
  owner.controller.abort();
  ++voiceGeneration;
  renderAudio();
  try {
    await owner.device?.close();
  } finally {
    // Permission itself cannot be cancelled. Late tracks are stopped by the device.
    if (voice === owner) voice = undefined;
    renderAudio();
  }
}
async function requestVoice(session: Session, request: string) {
  if (voice || !session.ready || !session.capability || !session.ownerId || !token) {
    send(session, { type: "audio-error", request, message: "Voice is already active. Stop it before starting again." });
    return;
  }
  const owner: VoiceOwner = {
    request,
    controller: new AbortController(),
    tabId: session.id,
    capability: session.capability,
    ownerId: session.ownerId,
    generation: ++voiceGeneration,
    state: "Requesting microphone…",
    pending: true,
    releasing: false,
  };
  voice = owner;
  voiceError = undefined;
  renderAudio();
  try {
    const device = await connectBrowserAudio({
      url:
        socketOrigin +
        "/api/live/audio?role=browser&session=" +
        encodeURIComponent(owner.tabId) +
        "&request=" +
        encodeURIComponent(request),
      signal: owner.controller.signal,
      token,
      owner: owner.capability,
      onState(value) {
        if (voice !== owner || owner.generation !== voiceGeneration || owner.releasing) return;
        if (value === "closed" || value === "error") {
          if (value === "error") {
            const message = "Browser audio failed. Check microphone access and connection, then type /live to retry.";
            voiceError = { tabId: owner.tabId, message };
            send(session, { type: "audio-error", request, message });
          }
          void releaseVoice();
          return;
        }
        owner.state = value === "running" ? "Live" : value === "enabled" ? "Starting voice…" : "Requesting microphone…";
        renderAudio();
      },
    });
    if (
      voice !== owner ||
      owner.generation !== voiceGeneration ||
      !session.ready ||
      session.capability !== owner.capability
    ) {
      await device.close();
      return;
    }
    owner.device = device;
  } catch (error) {
    if (!owner.controller.signal.aborted && session.capability === owner.capability) {
      const message = error instanceof Error ? error.message : "Could not open microphone. Type /live to retry.";
      voiceError = { tabId: owner.tabId, message };
      send(session, { type: "audio-error", request, message });
    }
    owner.releasing = true;
  } finally {
    owner.pending = false;
    if (owner.releasing && voice === owner) voice = undefined;
    renderAudio();
  }
}

function connect(session: Session) {
  if (session.halted || unloading || accessRequired) return;
  if (voice?.tabId === session.id) void releaseVoice();
  session.ready = false;
  session.viewport = undefined;
  session.capability = undefined;
  session.ownerId = undefined;
  session.term.options.disableStdin = true;
  session.status = session.socket ? "Terminal disconnected · input paused · retrying…" : "Connecting terminal…";
  const socket = new WebSocket(
    socketOrigin + "/api/terminal?tab=" + encodeURIComponent(session.id) + "&after=" + session.sequence,
    ["bruv", "bruv-token." + token],
  );
  session.socket = socket;
  renderStatus();
  socket.onmessage = (event) => {
    if (session.socket !== socket || !sessions.has(session.id)) return;
    const message = JSON.parse(event.data);
    if (message.type === "ready") {
      session.term.resize(message.cols, message.rows);
      session.ready = true;
      session.term.options.disableStdin = false;
      session.status = "Connected";
      if (selected() === session) {
        resizeSelected();
        if (document.activeElement === document.body) session.term.focus();
      }
    } else if (message.type === "size") {
      session.term.resize(message.cols, message.rows);
    } else if (message.type === "audio-request" && typeof message.request === "string") {
      void requestVoice(session, message.request);
    } else if (message.type === "audio-cancel") {
      if (voice?.tabId === session.id && voice.request === message.request) void releaseVoice();
    } else if (message.type === "audio-owner") {
      if (voice?.tabId === session.id && voice.capability !== message.id) void releaseVoice();
      session.capability = message.id;
      session.ownerId = message.ownerId;
    } else if (message.type === "output") {
      if (message.seq <= session.sequence) return;
      if (message.seq !== session.sequence + 1) {
        session.loss = "view";
        halt(
          session,
          "View lost · this screen is incomplete. The original work still runs. Open a new terminal without closing this one.",
        );
        return;
      }
      session.term.write(Uint8Array.from(atob(message.data), (char) => char.charCodeAt(0)));
      session.accessibility.refresh();
      session.sequence = message.seq;
    } else if (message.type === "exit") {
      session.loss = "exit";
      halt(session, "CLI ended (exit " + message.code + "). Output is kept here. Use + for a new terminal.");
    } else if (message.type === "gap" || message.type === "error") {
      if (message.type === "gap") session.loss = "view";
      halt(session, message.message);
    }
    renderStatus();
  };
  socket.onclose = (event) => {
    if (session.socket !== socket || !sessions.has(session.id)) return;
    session.ready = false;
    session.capability = undefined;
    session.ownerId = undefined;
    session.term.options.disableStdin = true;
    if (voice?.tabId === session.id) void releaseVoice();
    if (!session.halted) {
      if (event.code === 1000 || event.code === 1008) {
        session.halted = true;
        session.status = event.reason || "Terminal unavailable.";
      } else {
        session.status = "Terminal disconnected · input paused · retrying…";
        session.reconnect = setTimeout(() => connect(session), 1000);
      }
    }
    renderStatus();
  };
  socket.onerror = () => {
    if (session.socket !== socket) return;
    session.status = "Terminal disconnected · input paused · retrying…";
    renderStatus();
  };
}
function halt(session: Session, message: string) {
  session.halted = true;
  session.ready = false;
  session.capability = undefined;
  session.ownerId = undefined;
  session.status = message;
  session.term.options.disableStdin = true;
  if (voice?.tabId === session.id) void releaseVoice();
  session.socket?.close();
  render();
}
function attach(tab: Tab) {
  const element = document.createElement("div");
  element.id = "terminal-" + tab.id;
  element.className = "terminal-pane";
  element.hidden = true;
  element.setAttribute("role", "tabpanel");
  element.setAttribute("aria-labelledby", "tab-" + tab.id);
  container.append(element);
  const term = new Terminal({
    ghostty,
    cursorBlink: true,
    fontSize: 14,
    fontFamily: '"JetBrainsMono Nerd Font Mono", ui-monospace, monospace',
    scrollback: 5000,
    disableStdin: true,
    // Vesper sources and the pure-black override: wisdom/web/surface-rethink.md.
    theme: {
      background: "#000000",
      foreground: "#ffffff",
      cursor: "#ffc799",
      cursorAccent: "#000000",
      selectionBackground: "#ffffff25",
      selectionForeground: "#ffffff",
      black: "#101010",
      red: "#f5a191",
      green: "#90b99f",
      yellow: "#e6b99d",
      blue: "#aca1cf",
      magenta: "#e29eca",
      cyan: "#ea83a5",
      white: "#a0a0a0",
      brightBlack: "#7e7e7e",
      brightRed: "#ff8080",
      brightGreen: "#99ffe4",
      brightYellow: "#ffc799",
      brightBlue: "#b9aeda",
      brightMagenta: "#ecaad6",
      brightCyan: "#f591b2",
      brightWhite: "#ffffff",
    },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // Ghostty makes its host editable. Keep the tabpanel and output region outside it.
  const renderer = document.createElement("div");
  renderer.className = "terminal-renderer";
  element.append(renderer);
  term.open(renderer);
  // Ghostty 0.4.0's native input handler skips bracketed paste; its public API does not.
  renderer.addEventListener(
    "paste",
    (event) => {
      const text = event.clipboardData?.getData("text/plain");
      if (text === undefined) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      term.paste(text);
    },
    { capture: true },
  );
  const touch = installTerminalTouch(element, term);
  const accessibility = installTerminalAccessibility(element, term);
  const session: Session = {
    id: tab.id,
    term,
    fit,
    element,
    touch,
    accessibility,
    sequence: 0,
    ready: false,
    halted: false,
    status: "Connecting…",
  };
  sessions.set(tab.id, session);
  term.onData((data) => sendInput(session, data));
  term.onBinary((data) => sendInput(session, data, true));
  connect(session);
}
function applyState(next: WorkspaceState) {
  listLoaded = true;
  listFailed = false;
  if (next.revision <= state.revision) return;
  const ids = new Set(next.workspaces.flatMap((item) => item.tabs.map((tab) => tab.id)));
  for (const [id, session] of sessions) {
    if (ids.has(id)) continue;
    if (voice?.tabId === id) void releaseVoice();
    sessions.delete(id);
    session.halted = true;
    clearTimeout(session.reconnect);
    session.socket?.close();
    session.touch.dispose();
    session.accessibility.dispose();
    session.term.dispose();
    session.element.remove();
  }
  state = next;
  normalizeSelection();
  for (const item of state.workspaces) {
    for (const tab of item.tabs) if (!sessions.has(tab.id)) attach(tab);
  }
  render();
}
function normalizeSelection() {
  if (!workspace()) selectedWorkspace = state.workspaces[0]?.id ?? "";
  for (const item of state.workspaces) {
    if (!item.tabs.some((tab) => tab.id === selectedTabs[item.id])) selectedTabs[item.id] = item.tabs[0]?.id ?? "";
  }
}
class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function request(path: string, method = "GET", body?: object): Promise<WorkspaceState> {
  const response = await fetch(path, {
    method,
    headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 401 || response.status === 403) {
      accessRequired = true;
      syncStatus.textContent = "";
      clearTimeout(eventsReconnect);
      eventsSocket?.close();
      for (const session of sessions.values()) {
        clearTimeout(session.reconnect);
        halt(session, "Access required");
      }
      render();
    }
    throw new RequestError(detail || "Request failed (" + response.status + ").", response.status);
  }
  return response.json();
}
async function change(path: string, method = "GET", body?: object, choose?: (next: WorkspaceState) => void) {
  if (busy || accessRequired) return false;
  busy = true;
  notice.textContent = "";
  render();
  let ok = false;
  try {
    const next = await request(path, method, body);
    applyState(next);
    // Events may win the race; select from the response but keep the newest state.
    if (choose) {
      choose(next);
      normalizeSelection();
    }
    ok = true;
  } catch (error) {
    if (method === "GET") listFailed = true;
    notice.textContent =
      accessRequired || !listLoaded ? "" : error instanceof Error ? error.message : "Could not update workspaces.";
  } finally {
    busy = false;
    render();
  }
  return ok;
}
action("empty-action").addEventListener("click", () => {
  if (!listLoaded) void change("/api/workspaces");
  else action("new-tab").click();
});
action("lost-new-tab").addEventListener("click", () => action("new-tab").click());
action("add-workspace").addEventListener("click", () => {
  folderOpen = true;
  render();
  folderInput.focus();
});
action("cancel-folder").addEventListener("click", () => {
  folderOpen = false;
  render();
  action("add-workspace").focus();
});
folderForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void openFolder();
});
async function openFolder() {
  if (busy || accessRequired || !folderInput.value.trim()) return;
  busy = true;
  folderError.textContent = "";
  render();
  try {
    const next = (await request("/api/workspaces", "POST", { cwd: folderInput.value.trim() })) as OpenedWorkspace;
    applyState(next);
    selectedWorkspace = next.workspaceId;
    normalizeSelection();
    folderOpen = false;
    folderInput.value = "";
    folderInput.removeAttribute("aria-invalid");
    setDrawer(false);
    render();
    selected()?.term.focus();
  } catch (error) {
    folderError.textContent = error instanceof Error ? error.message : "Could not open folder. Try again.";
    folderInput.setAttribute("aria-invalid", "true");
    if (!accessRequired) {
      folderOpen = true;
      render();
      if (workspace() && window.innerWidth <= 700) setDrawer(true);
      folderInput.focus();
    }
  } finally {
    busy = false;
    render();
  }
}
folderInput.addEventListener("input", () => {
  folderError.textContent = "";
  folderInput.removeAttribute("aria-invalid");
});
action("new-tab").addEventListener("click", () => {
  const current = workspace();
  if (!current) return;
  const before = new Set(current.tabs.map((tab) => tab.id));
  void change("/api/workspaces/" + encodeURIComponent(current.id) + "/tabs", "POST", {}, (next) => {
    const tab = next.workspaces
      .find((item) => item.id === current.id)
      ?.tabs.filter((tab) => !before.has(tab.id))
      .at(-1);
    if (tab) {
      selectedWorkspace = current.id;
      selectedTabs[current.id] = tab.id;
    }
  }).then((ok) => {
    if (ok) selected()?.term.focus();
  });
});
async function closeTab(tab: Tab) {
  const ended = tab.exited || sessions.get(tab.id)?.loss === "exit";
  const focused = document.activeElement?.id;
  const origin = focused;
  const confirmed = await askDialog({
    title: (ended ? "Remove “" : "Close “") + tab.name + "”?",
    description: ended
      ? "This CLI has ended. Removing its terminal stops any remaining work for everyone."
      : "This terminal and its running work will stop for everyone.",
    submit: ended ? "Remove tab" : "Close tab",
    destructive: true,
  });
  if (confirmed === null) {
    const invoker =
      document.getElementById(origin ?? "") ??
      document.getElementById("tab-" + selected()?.id) ??
      (workspace() ? action("empty-action") : folderInput);
    if (invoker.classList.contains("tab-close")) {
      revealTabShell(invoker.parentElement);
    }
    invoker.focus();
    return;
  }
  const ok = await change("/api/tabs/" + encodeURIComponent(tab.id), "DELETE", { confirm: true });
  if (!ok) {
    document.getElementById(origin ?? "")?.focus();
    return;
  }
  const remaining = selected();
  if (remaining) remaining.term.focus();
  else action("empty-action").focus();
}
async function removeWorkspace(id: string) {
  const current = state.workspaces.find((item) => item.id === id);
  if (!current) return;
  const invoker = document.getElementById("workspace-remove-" + id);
  const confirmed = await askDialog({
    title: "Remove “" + current.name + "”?",
    description:
      current.cwd +
      "\nAll its terminals and any remaining work will stop for everyone. The folder will not be deleted.",
    submit: "Remove workspace",
    destructive: true,
  });
  if (confirmed === null) {
    invoker?.focus();
    return;
  }
  const ok = await change("/api/workspaces/" + encodeURIComponent(id), "DELETE", { confirm: true });
  if (ok && !drawerOpen) {
    const active = selected();
    if (active) active.term.focus();
    else if (!workspace()) folderInput.focus();
    else action("empty-action").focus();
  }
}
window.addEventListener("beforeunload", () => {
  unloading = true;
  clearTimeout(eventsReconnect);
  eventsSocket?.close();
  for (const session of sessions.values()) {
    session.halted = true;
    clearTimeout(session.reconnect);
    session.socket?.close();
  }
  void releaseVoice();
});
function connectEvents() {
  if (unloading || accessRequired) return;
  const socket = new WebSocket(socketOrigin + "/api/events", ["bruv-state", "bruv-token." + token]);
  if (!eventsSocket) syncStatus.textContent = "Connecting workspace updates…";
  eventsSocket = socket;
  socket.onmessage = (event) => {
    if (eventsSocket !== socket || unloading) return;
    const message = JSON.parse(event.data);
    if (message.type === "state") {
      applyState(message.state);
      syncStatus.textContent = "";
    }
  };
  socket.onclose = () => {
    if (eventsSocket !== socket || unloading) return;
    if (accessRequired) return;
    syncStatus.textContent = "Workspace list may be out of date · retrying…";
    eventsReconnect = setTimeout(async () => {
      // Browsers hide a rejected WebSocket upgrade's HTTP status. Check it here.
      try {
        const next = await request("/api/workspaces");
        if (eventsSocket !== socket || unloading || accessRequired) return;
        applyState(next);
      } catch {
        // A network failure still retries; request() stops on confirmed lost access.
      }
      if (eventsSocket === socket && !unloading && !accessRequired) connectEvents();
    }, 1000);
  };
}
let ghostty: Ghostty;
render();
if (token) {
  // Load the face and one WASM instance before Ghostty measures any cells.
  void document.fonts
    .load('14px "JetBrainsMono Nerd Font Mono"')
    .catch((error) => console.warn("Terminal font could not load; using monospace.", error))
    .then(() => Ghostty.load("/ghostty-vt.wasm"))
    .then((loaded) => {
      ghostty = loaded;
      connectEvents();
      void change("/api/workspaces");
    })
    .catch((error) => {
      console.error("Terminal renderer could not load.", error);
      listLoaded = true;
      listFailed = true;
      requiredElement("h1", empty).textContent = "Terminal unavailable";
      requiredElement("p", empty).textContent = "Reload to try again.";
    });
}
