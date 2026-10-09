import { connectBrowserAudio } from "./browser-audio";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

type Tab = { id: string; name: string; pid?: number; exited?: boolean };
type Workspace = { id: string; name: string; cwd: string; tabs: Tab[] };
type WorkspaceState = { workspaces: Workspace[]; defaultCwd: string };
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
  reconnect?: ReturnType<typeof setTimeout>;
  status: string;
};
type VoiceOwner = {
  tabId: string;
  capability: string;
  label: string;
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
const audioButton = document.querySelector<HTMLButtonElement>("#audio-toggle")!;
const audioStatus = document.querySelector<HTMLElement>("#audio-status")!;
const empty = document.querySelector<HTMLElement>("#empty-terminal")!;
const action = (id: string) => document.querySelector<HTMLButtonElement>("#" + id)!;

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
let state: WorkspaceState = { workspaces: [], defaultCwd: "" };
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
function voiceLabel(owner: VoiceOwner) {
  for (const item of state.workspaces) {
    const tab = item.tabs.find((tab) => tab.id === owner.tabId);
    if (tab) {
      owner.label = item.name + " / " + tab.name;
      return owner.label;
    }
  }
  return owner.label;
}
function renderAudio() {
  const session = selected();
  audioButton.textContent = voice ? "Disable microphone" : "Enable microphone";
  audioButton.disabled = voice ? voice.releasing : !session?.ready || !session.capability;
  audioStatus.textContent = voice
    ? (voice.releasing ? "Releasing microphone…" : voice.state) + " · " + voiceLabel(voice)
    : "Voice off";
}
function renderStatus() {
  status.textContent =
    selected()?.status ??
    (token ? "Select or add a workspace." : "Open the full URL printed by bruv web (including its token).");
  renderAudio();
}
function selectWorkspace(id: string) {
  selectedWorkspace = id;
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
    const entry = button(item.name, "Open workspace " + item.name, () => selectWorkspace(item.id));
    entry.className = "workspace";
    entry.title = item.cwd;
    entry.setAttribute("aria-pressed", String(item.id === selectedWorkspace));
    const cwd = document.createElement("small");
    cwd.textContent = item.cwd;
    entry.append(cwd);
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
    entry.tabIndex = active ? 0 : -1;
    tabList.append(entry);
  }
  const active = selected();
  for (const session of sessions.values()) session.element.hidden = session !== active;
  empty.hidden = !!active;
  empty.textContent = current
    ? "Open a new tab to start a terminal in this workspace."
    : "Add an existing folder to start a terminal. Removing a workspace never deletes its folder.";
  for (const id of ["add-workspace", "reload-workspaces"]) action(id).disabled = busy || !token;
  action("remove-workspace").disabled = busy || !current;
  action("new-tab").disabled = busy || !current;
  action("rename-tab").disabled = busy || !active;
  action("close-tab").disabled = busy || !active;
  persistSelection();
  renderStatus();
  requestAnimationFrame(resizeSelected);
}
function send(session: Session, message: object) {
  if (session.ready && session.socket?.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify(message));
}
function resizeSelected() {
  const session = selected();
  if (!session || session.element.hidden || container.clientWidth < 1 || container.clientHeight < 1) return;
  session.fit.fit();
  send(session, { type: "resize", cols: session.term.cols, rows: session.term.rows });
}
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

// Voice belongs to one attachment, not to the selected terminal. A second click
// is required to enable another owner after the first one has been released.
async function releaseVoice() {
  const owner = voice;
  if (!owner || owner.releasing) return;
  owner.releasing = true;
  ++voiceGeneration;
  renderAudio();
  try {
    await owner.device?.close();
  } finally {
    // A pending permission request cannot be cancelled. Its eventual device is
    // closed by the generation check below before another owner can start.
    if (!owner.pending && voice === owner) voice = undefined;
    renderAudio();
  }
}
audioButton.addEventListener("click", async () => {
  if (voice) {
    await releaseVoice();
    return;
  }
  const session = selected();
  if (!session?.ready || !session.capability || !token) return;
  const owner: VoiceOwner = {
    tabId: session.id,
    label: session.id,
    capability: session.capability,
    generation: ++voiceGeneration,
    state: "Requesting microphone…",
    pending: true,
    releasing: false,
  };
  voice = owner;
  renderAudio();
  try {
    const device = await connectBrowserAudio({
      url: socketOrigin + "/api/live/audio?role=browser&session=" + encodeURIComponent(owner.tabId),
      token,
      owner: owner.capability,
      onState(value) {
        if (voice !== owner || owner.generation !== voiceGeneration || owner.releasing) return;
        if (value === "closed" || value === "error") {
          void releaseVoice();
          return;
        }
        owner.state =
          value === "running" ? "Live" : value === "enabled" ? "Mic enabled · type /live" : "Requesting microphone…";
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
    selected()?.term.focus();
  } catch (error) {
    if (voice === owner && !owner.releasing)
      notice.textContent = error instanceof Error ? error.message : "Could not enable microphone.";
    owner.releasing = true;
  } finally {
    owner.pending = false;
    if (owner.releasing && voice === owner) voice = undefined;
    renderAudio();
  }
});

function connect(session: Session) {
  if (session.halted || unloading) return;
  if (voice?.tabId === session.id) void releaseVoice();
  session.ready = false;
  session.capability = undefined;
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
      session.ready = true;
      session.term.options.disableStdin = false;
      session.status = "Connected · real Bruv TUI";
      if (selected() === session) {
        resizeSelected();
        if (document.activeElement === document.body) session.term.focus();
      }
    } else if (message.type === "audio-owner") {
      if (voice?.tabId === session.id && voice.capability !== message.id) void releaseVoice();
      session.capability = message.id;
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
    scrollback: 5000,
    disableStdin: true,
    theme: { background: "#111318" },
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
  if (!workspace()) selectedWorkspace = state.workspaces[0]?.id ?? "";
  for (const item of state.workspaces) {
    if (!item.tabs.some((tab) => tab.id === selectedTabs[item.id])) selectedTabs[item.id] = item.tabs[0]?.id ?? "";
    for (const tab of item.tabs) if (!sessions.has(tab.id)) attach(tab);
  }
  render();
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
    choose?.(next);
    applyState(next);
  } catch (error) {
    notice.textContent = error instanceof Error ? error.message : "Could not update workspaces.";
  } finally {
    busy = false;
    render();
  }
}
action("add-workspace").addEventListener("click", () => {
  const cwd = prompt("Existing workspace directory (leave blank for launch directory):", state.defaultCwd);
  if (cwd === null) return;
  const before = new Set(state.workspaces.map((item) => item.id));
  void change("/api/workspaces", "POST", { cwd: cwd.trim() || state.defaultCwd }, (next) => {
    selectedWorkspace = next.workspaces.find((item) => !before.has(item.id))?.id ?? selectedWorkspace;
  });
});
action("new-tab").addEventListener("click", () => {
  const current = workspace();
  if (!current) return;
  const before = new Set(current.tabs.map((tab) => tab.id));
  void change("/api/workspaces/" + encodeURIComponent(current.id) + "/tabs", "POST", {}, (next) => {
    const tab = next.workspaces.find((item) => item.id === current.id)?.tabs.find((tab) => !before.has(tab.id));
    if (tab) {
      selectedWorkspace = current.id;
      selectedTabs[current.id] = tab.id;
    }
  });
});
action("rename-tab").addEventListener("click", () => {
  const tab = workspace()?.tabs.find((tab) => tab.id === selected()?.id);
  if (!tab) return;
  const name = prompt("Tab name:", tab.name)?.trim();
  if (name) void change("/api/tabs/" + encodeURIComponent(tab.id), "PATCH", { name });
});
action("close-tab").addEventListener("click", () => {
  const tab = workspace()?.tabs.find((tab) => tab.id === selected()?.id);
  if (tab && confirm('Close "' + tab.name + '"? Its terminal will stop.'))
    void change("/api/tabs/" + encodeURIComponent(tab.id), "DELETE", { confirm: true });
});
action("remove-workspace").addEventListener("click", () => {
  const current = workspace();
  if (current && confirm('Remove "' + current.name + '" and stop all its terminals? The folder will not be deleted.'))
    void change("/api/workspaces/" + encodeURIComponent(current.id), "DELETE", { confirm: true });
});
action("reload-workspaces").addEventListener("click", () => void change("/api/workspaces"));
window.addEventListener("beforeunload", () => {
  unloading = true;
  for (const session of sessions.values()) {
    session.halted = true;
    clearTimeout(session.reconnect);
    session.socket?.close();
  }
  void releaseVoice();
});
render();
if (token) void change("/api/workspaces");
