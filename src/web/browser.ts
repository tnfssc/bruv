import { connectBrowserAudio } from "./browser-audio";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

type Tab = { id: string; name: string; pid?: number; exited?: boolean };
type Workspace = { id: string; name: string; cwd: string; tabs: Tab[] };
type WorkspaceState = {
  revision: number;
  voice: { tabId: string; ownerId: string } | null;
  workspaces: Workspace[];
  defaultCwd: string;
};
type Session = {
  id: string;
  term: Terminal;
  fit: FitAddon;
  element: HTMLElement;
  socket?: WebSocket;
  sequence: number;
  ready: boolean;
  halted: boolean;
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
const status = document.querySelector<HTMLElement>("#status")!;
const container = document.querySelector<HTMLElement>("#terminal")!;
const workspaceList = document.querySelector<HTMLElement>("#workspace-list")!;
const tabList = document.querySelector<HTMLElement>("#tab-list")!;
const notice = document.querySelector<HTMLElement>("#notice")!;
const syncStatus = document.querySelector<HTMLElement>("#sync-status")!;
const audioStatus = document.querySelector<HTMLElement>("#audio-status")!;
const empty = document.querySelector<HTMLElement>("#empty-terminal")!;
const connection = document.querySelector<HTMLElement>(".connection")!;
const voiceControl = document.querySelector<HTMLElement>(".voice-control")!;
const micLabel = document.querySelector<HTMLElement>(".mic-label")!;
const terminalStatus = document.querySelector<HTMLElement>("#terminal-status")!;
const action = (id: string) => document.querySelector<HTMLButtonElement>("#" + id)!;

// Menus keep destructive actions out of the working surface.
let openMenu: { menu: HTMLElement; trigger: HTMLButtonElement } | undefined;
function closeMenu(restoreFocus = false) {
  if (!openMenu) return;
  openMenu.menu.hidden = true;
  openMenu.trigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) openMenu.trigger.focus();
  openMenu = undefined;
}
for (const id of ["workspace", "tab"]) {
  const trigger = action(id + "-menu-toggle");
  const menu = document.querySelector<HTMLElement>("#" + id + "-menu")!;
  const items = () => Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
  trigger.addEventListener("click", () => {
    const wasOpen = openMenu?.menu === menu;
    closeMenu();
    if (wasOpen) return;
    const rect = trigger.getBoundingClientRect();
    menu.hidden = false;
    menu.style.top = rect.bottom + 5 + "px";
    menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)) + "px";
    trigger.setAttribute("aria-expanded", "true");
    openMenu = { menu, trigger };
    items()[0]?.focus();
  });
  menu.addEventListener("keydown", (event) => {
    const choices = items();
    const index = choices.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape" || event.key === "Tab") {
      closeMenu(true);
      return;
    }
    let next: number;
    if (event.key === "ArrowDown") next = (index + 1) % choices.length;
    else if (event.key === "ArrowUp") next = (index + choices.length - 1) % choices.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = choices.length - 1;
    else return;
    event.preventDefault();
    choices[next]?.focus();
  });
  menu.addEventListener("click", () => closeMenu(true));
}
document.addEventListener("pointerdown", (event) => {
  if (openMenu && !openMenu.menu.contains(event.target as Node) && !openMenu.trigger.contains(event.target as Node))
    closeMenu();
});
let drawerOpen = false;
function setDrawer(open: boolean) {
  if (drawerOpen === open) return;
  drawerOpen = open;
  document.body.setAttribute("data-drawer", open ? "open" : "closed");
  action("open-drawer").setAttribute("aria-expanded", String(open));
  action("drawer-backdrop").hidden = !open;
  document.querySelector<HTMLElement>("main")!.inert = open;
  closeMenu();
  action(open ? "close-drawer" : "open-drawer").focus();
}
action("open-drawer").addEventListener("click", () => setDrawer(true));
for (const id of ["close-drawer", "drawer-backdrop"]) action(id).addEventListener("click", () => setDrawer(false));
document.querySelector<HTMLElement>("#workspace-sidebar")!.addEventListener("keydown", (event) => {
  if (!drawerOpen) return;
  if (event.key === "Escape") {
    setDrawer(false);
    return;
  }
  if (event.key !== "Tab") return;
  const choices = Array.from(document.querySelectorAll<HTMLButtonElement>("#workspace-sidebar button:not(:disabled)"));
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
  closeMenu();
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
const dialog = document.querySelector<HTMLDialogElement>("#workspace-dialog")!;
const dialogInput = document.querySelector<HTMLInputElement>("#dialog-input")!;
let dialogResult: ((value: string | null) => void) | undefined;
function askDialog(options: DialogOptions): Promise<string | null> {
  closeMenu(true);
  document.querySelector<HTMLElement>("#dialog-title")!.textContent = options.title;
  document.querySelector<HTMLElement>("#dialog-description")!.textContent = options.description;
  document.querySelector<HTMLElement>("#dialog-label")!.textContent = options.label ?? "";
  document.querySelector<HTMLElement>("#dialog-field")!.hidden = !options.label;
  dialogInput.required = !!options.label;
  dialogInput.value = options.value ?? "";
  action("dialog-submit").textContent = options.submit;
  action("dialog-submit").className = options.destructive ? "danger" : "primary-button";
  dialog.returnValue = "";
  dialog.showModal();
  if (options.label) {
    dialogInput.focus();
    dialogInput.select();
  } else action("dialog-cancel").focus();
  return new Promise((resolve) => {
    dialogResult = resolve;
  });
}
document.querySelector<HTMLFormElement>("#dialog-form")!.addEventListener("submit", (event) => {
  event.preventDefault();
  if (dialogInput.required && !dialogInput.value.trim()) {
    dialogInput.focus();
    return;
  }
  dialog.close("save");
});
action("dialog-cancel").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => {
  dialogResult?.(dialog.returnValue === "save" ? dialogInput.value : null);
  dialogResult = undefined;
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
  voiceControl.hidden = !(voice || shared);
  micLabel.textContent = elsewhere ? "Voice elsewhere" : "Voice";
  voiceControl.setAttribute("data-active", String(!!(voice || shared)));
  voiceControl.setAttribute("data-elsewhere", String(!!elsewhere));
  audioStatus.textContent = elsewhere
    ? "Voice in another browser · " + voiceLabel(shared.tabId)
    : voice
      ? (voice.releasing ? "Releasing microphone…" : voice.state) + " · " + voiceLabel(voice.tabId)
      : shared
        ? "Releasing microphone… · " + voiceLabel(shared.tabId)
        : "Voice off";
  voiceControl.setAttribute("aria-label", audioStatus.textContent);
}
function renderStatus() {
  status.textContent =
    selected()?.status ??
    (token ? "Select or add a workspace." : "Open the full URL printed by bruv web (including its token).");
  connection.setAttribute("data-state", selected()?.ready ? "connected" : selected()?.halted ? "ended" : "connecting");
  connection.setAttribute("aria-label", status.textContent);
  terminalStatus.textContent = status.textContent;
  terminalStatus.hidden = !!selected()?.ready || (!selected() && !!token);
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
function render() {
  workspaceList.replaceChildren();
  for (const item of state.workspaces) {
    const entry = button("", "Open workspace " + item.name, () => selectWorkspace(item.id));
    entry.className = "workspace";
    entry.title = item.cwd;
    entry.setAttribute("aria-pressed", String(item.id === selectedWorkspace));
    const mark = document.createElement("span");
    mark.innerHTML =
      '<svg class="workspace-mark" viewBox="0 0 20 20" aria-hidden="true"><path d="M2 5a1 1 0 0 1 1-1h5l2 2h7a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg>';
    entry.append(mark);
    const copy = document.createElement("span");
    copy.className = "workspace-copy";
    const name = document.createElement("span");
    name.className = "workspace-name";
    name.textContent = item.name;
    copy.append(name);
    const cwd = document.createElement("small");
    cwd.textContent = item.cwd;
    copy.append(cwd);
    entry.append(copy);
    workspaceList.append(entry);
  }
  const current = workspace();
  tabList.replaceChildren();
  for (const tab of current?.tabs ?? []) {
    const entry = button(
      tab.name + (sessions.get(tab.id)?.halted || tab.exited ? " · ended" : ""),
      "Select tab " + tab.name,
      () => selectTab(tab.id),
    );
    const active = tab.id === selectedTabs[selectedWorkspace];
    entry.id = "tab-" + tab.id;
    entry.setAttribute("role", "tab");
    entry.setAttribute("aria-selected", String(active));
    entry.setAttribute("aria-controls", "terminal-" + tab.id);
    entry.title = tab.name;
    entry.tabIndex = active ? 0 : -1;
    tabList.append(entry);
  }
  requestAnimationFrame(() =>
    document
      .getElementById("tab-" + selectedTabs[selectedWorkspace])
      ?.scrollIntoView({ block: "nearest", inline: "nearest" }),
  );
  const active = selected();
  let selectionChanged = false;
  for (const session of sessions.values()) {
    const hidden = session !== active;
    if (session.element.hidden !== hidden) {
      selectionChanged = true;
      if (hidden) hideSession(session);
      session.element.hidden = hidden;
    }
  }
  empty.hidden = !!active;
  empty.querySelector("h1")!.textContent = current ? "Ready when you are." : "Your terminal, together.";
  empty.querySelector("p")!.textContent = current
    ? "Open a terminal in " + current.name + "."
    : "Add an existing folder to get started.";
  action("empty-action").textContent = current ? "New tab" : "Add workspace";
  action("empty-action").disabled = busy || !token;
  action("tab-menu-toggle").disabled = busy || !active;
  for (const id of ["add-workspace", "reload-workspaces"]) action(id).disabled = busy || !token;
  action("remove-workspace").disabled = busy || !current;
  action("new-tab").disabled = busy || !current;
  action("rename-tab").disabled = busy || !active;
  action("close-tab").disabled = busy || !active;
  persistSelection();
  renderStatus();
  if (selectionChanged) requestAnimationFrame(resizeSelected);
}
function send(session: Session, message: object) {
  if (session.ready && session.socket?.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify(message));
}
function hideSession(session: Session) {
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
  // Measure our available space without resizing xterm. Only the server chooses
  // shared geometry; its size messages must never cause a resize reply.
  const dimensions = session.fit.proposeDimensions();
  if (!dimensions || !Number.isFinite(dimensions.cols) || !Number.isFinite(dimensions.rows)) return;
  if (session.viewport?.cols === dimensions.cols && session.viewport.rows === dimensions.rows) return;
  session.viewport = dimensions;
  send(session, { type: "resize", ...dimensions });
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    for (const session of sessions.values()) hideSession(session);
  } else {
    requestAnimationFrame(resizeSelected);
  }
});
new ResizeObserver(resizeSelected).observe(container);
window.visualViewport?.addEventListener("resize", resizeSelected);
tabList.addEventListener("keydown", (event) => {
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
  notice.textContent = "";
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
            notice.textContent = message;
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
      notice.textContent = message;
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
  if (session.halted || unloading) return;
  if (voice?.tabId === session.id) void releaseVoice();
  session.ready = false;
  session.viewport = undefined;
  session.capability = undefined;
  session.ownerId = undefined;
  session.term.options.disableStdin = true;
  session.status = "Connecting…";
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
        halt(session, "Output gap; screen is incomplete. Close this tab and start a new one.");
        return;
      }
      session.term.write(Uint8Array.from(atob(message.data), (char) => char.charCodeAt(0)));
      session.sequence = message.seq;
    } else if (message.type === "exit") {
      halt(session, "Bruv exited (" + message.code + "). Open a new tab to continue.");
    } else if (message.type === "gap" || message.type === "error") {
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
        session.status = event.reason || "Terminal detached.";
      } else {
        session.status = "Disconnected · input disabled · reconnecting…";
        session.reconnect = setTimeout(() => connect(session), 1000);
      }
    }
    renderStatus();
  };
  socket.onerror = () => {
    if (session.socket !== socket) return;
    session.status = "Connection failed. Check the server and token URL.";
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
    cursorBlink: true,
    fontSize: 14,
    fontFamily: '"JetBrainsMono Nerd Font Mono", ui-monospace, monospace',
    scrollback: 5000,
    disableStdin: true,
    // Vesper sources and the pure-black override: wisdom/web/vesper-theme.md.
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
  term.open(element);
  const session: Session = {
    id: tab.id,
    term,
    fit,
    element,
    sequence: 0,
    ready: false,
    halted: false,
    status: "Connecting…",
  };
  sessions.set(tab.id, session);
  term.onData((data) => send(session, { type: "input", data }));
  term.onBinary((data) => send(session, { type: "input", data: btoa(data), encoding: "base64" }));
  connect(session);
}
function applyState(next: WorkspaceState) {
  if (next.revision <= state.revision) return;
  const ids = new Set(next.workspaces.flatMap((item) => item.tabs.map((tab) => tab.id)));
  for (const [id, session] of sessions) {
    if (ids.has(id)) continue;
    if (voice?.tabId === id) void releaseVoice();
    sessions.delete(id);
    session.halted = true;
    clearTimeout(session.reconnect);
    session.socket?.close();
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
async function request(path: string, method = "GET", body?: object): Promise<WorkspaceState> {
  const response = await fetch(path, {
    method,
    headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "Request failed (" + response.status + ").");
  }
  return response.json();
}
async function change(path: string, method = "GET", body?: object, choose?: (next: WorkspaceState) => void) {
  if (busy || !token) return;
  busy = true;
  notice.textContent = "";
  render();
  try {
    const next = await request(path, method, body);
    applyState(next);
    // Our own create may already have arrived over events. Choose from its REST
    // result, but reconcile against the newest snapshot, never the old response.
    if (choose) {
      choose(next);
      normalizeSelection();
    }
  } catch (error) {
    notice.textContent = error instanceof Error ? error.message : "Could not update workspaces.";
  } finally {
    busy = false;
    render();
  }
}
action("empty-action").addEventListener("click", () => action(workspace() ? "new-tab" : "add-workspace").click());
action("add-workspace").addEventListener("click", async () => {
  const cwd = await askDialog({
    title: "Add workspace",
    description: "Use an existing folder. Each workspace has its own terminals.",
    label: "Folder path",
    value: state.defaultCwd,
    submit: "Add workspace",
  });
  if (cwd === null) return;
  const before = new Set(state.workspaces.map((item) => item.id));
  void change("/api/workspaces", "POST", { cwd: cwd.trim() || state.defaultCwd }, (next) => {
    selectedWorkspace = next.workspaces.filter((item) => !before.has(item.id)).at(-1)?.id ?? selectedWorkspace;
  });
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
  });
});
action("rename-tab").addEventListener("click", async () => {
  const tab = workspace()?.tabs.find((tab) => tab.id === selected()?.id);
  if (!tab) return;
  const name = (
    await askDialog({
      title: "Rename tab",
      description: "Give this terminal a name.",
      label: "Tab name",
      value: tab.name,
      submit: "Save",
    })
  )?.trim();
  if (name) void change("/api/tabs/" + encodeURIComponent(tab.id), "PATCH", { name });
});
action("close-tab").addEventListener("click", async () => {
  const tab = workspace()?.tabs.find((tab) => tab.id === selected()?.id);
  if (
    tab &&
    (await askDialog({
      title: "Close “" + tab.name + "”?",
      description: "This terminal and its running work will stop for everyone.",
      submit: "Close tab",
      destructive: true,
    })) !== null
  )
    void change("/api/tabs/" + encodeURIComponent(tab.id), "DELETE", { confirm: true });
});
action("remove-workspace").addEventListener("click", async () => {
  const current = workspace();
  if (
    current &&
    (await askDialog({
      title: "Remove “" + current.name + "”?",
      description: "All its terminals will stop for everyone. The folder will not be deleted.",
      submit: "Remove workspace",
      destructive: true,
    })) !== null
  )
    void change("/api/workspaces/" + encodeURIComponent(current.id), "DELETE", { confirm: true });
});
action("reload-workspaces").addEventListener("click", () => void change("/api/workspaces"));
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
  if (unloading || !token) return;
  const socket = new WebSocket(socketOrigin + "/api/events", ["bruv-state", "bruv-token." + token]);
  eventsSocket = socket;
  syncStatus.textContent = "Connecting workspace updates…";
  socket.onmessage = (event) => {
    if (eventsSocket !== socket || unloading) return;
    const message = JSON.parse(event.data);
    if (message.type === "state") {
      applyState(message.state);
      syncStatus.textContent = "";
    }
  };
  socket.onclose = (event) => {
    if (eventsSocket !== socket || unloading) return;
    if (event.code === 1008) {
      syncStatus.textContent = event.reason || "Workspace updates denied. Open the full token URL.";
      return;
    }
    syncStatus.textContent = "Workspace updates disconnected · reconnecting…";
    eventsReconnect = setTimeout(connectEvents, 1000);
  };
}
render();
if (token) {
  // xterm measures cells when it opens. Load the face before attaching any tabs.
  void document.fonts
    .load('14px "JetBrainsMono Nerd Font Mono"')
    .catch((error) => console.warn("Terminal font could not load; using monospace.", error))
    .then(() => {
      connectEvents();
      void change("/api/workspaces");
    });
}
