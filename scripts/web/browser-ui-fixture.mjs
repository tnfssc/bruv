import { basename } from "node:path";

// Short server state, not a browser/terminal model. Chromium runs the shipped app.
export function initialState() {
  return {
    revision: 1,
    voice: null,
    defaultCwd: "/alpha",
    workspaces: [
      {
        id: "w1",
        name: "alpha",
        cwd: "/alpha",
        tabs: [
          { id: "t1", name: "One" },
          { id: "t2", name: "Two" },
        ],
      },
      { id: "w2", name: "beta", cwd: "/beta", tabs: [{ id: "t3", name: "Three" }] },
    ],
  };
}

export function startFixture(assets) {
  let state = initialState(),
    fault,
    missingControl = false,
    eventsMuted = false,
    nextId = 4;
  const sockets = new Set(),
    requests = [],
    messages = [];
  const files = {
    "/": ["index.html.asset", "text/html"],
    "/terminal.js": ["terminal.js.asset", "application/javascript"],
    "/terminal.css": ["terminal.css.asset", "text/css"],
    "/ghostty-vt.wasm": ["ghostty-vt.wasm.asset", "application/wasm"],
    "/JetBrainsMonoNerdFontMono-Regular.woff2": ["JetBrainsMonoNerdFontMono-Regular.woff2.asset", "font/woff2"],
  };
  const send = (socket, message) => socket.send(JSON.stringify(message));
  const publish = () => {
    if (eventsMuted) return;
    for (const socket of sockets) if (socket.data.path === "/api/events") send(socket, { type: "state", state });
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, server) {
      const url = new URL(request.url),
        path = url.pathname;
      if (request.headers.get("upgrade") === "websocket") {
        return server.upgrade(request, {
          data: { path, tab: url.searchParams.get("tab"), after: Number(url.searchParams.get("after")) },
        })
          ? undefined
          : new Response("upgrade failed", { status: 400 });
      }
      if (files[path]) {
        const [name, type] = files[path];
        let content = assets.get(name);
        if (path === "/" && missingControl)
          content = content.replace(/<button[^>]*id="new-tab"[^>]*>.*?<\/button>/, "");
        return new Response(content, { headers: { "content-type": type } });
      }
      if (!path.startsWith("/api/")) return new Response("not found", { status: 404 });
      const body = request.method === "GET" ? undefined : await request.json();
      requests.push({ path, method: request.method, body });
      if (fault?.path === path) {
        const pending = fault;
        fault = undefined;
        await pending.wait;
        return new Response(pending.message, { status: pending.status });
      }
      if (path === "/api/workspaces" && request.method === "GET") return Response.json(state);
      const workspace = state.workspaces.find((item) => item.id === path.split("/")[3]);
      const tab = state.workspaces.flatMap((item) => item.tabs).find((item) => item.id === path.split("/")[3]);
      let workspaceId;
      if (request.method === "PATCH" && tab) tab.name = body.name;
      else if (request.method === "DELETE" && tab) {
        for (const item of state.workspaces) item.tabs = item.tabs.filter((entry) => entry !== tab);
      } else if (request.method === "DELETE" && workspace)
        state.workspaces = state.workspaces.filter((item) => item !== workspace);
      else if (request.method === "POST" && path === "/api/workspaces") {
        const existing = state.workspaces.find((item) => item.cwd === body.cwd);
        workspaceId = existing?.id;
        if (!existing) {
          workspaceId = "w" + nextId++;
          state.workspaces.push({ id: workspaceId, name: basename(body.cwd), cwd: body.cwd, tabs: [] });
        }
      } else if (request.method === "POST" && workspace && path.endsWith("/tabs")) {
        workspace.tabs.push({ id: "t" + nextId++, name: "New terminal" });
      } else return Response.json({ error: "unknown fixture request" }, { status: 404 });
      state.revision++;
      publish();
      return Response.json(workspaceId ? { ...state, workspaceId } : state);
    },
    websocket: {
      open(socket) {
        sockets.add(socket);
        if (socket.data.path === "/api/events") {
          if (!eventsMuted) send(socket, { type: "state", state });
        } else {
          send(socket, { type: "ready", cols: 80, rows: 24 });
          send(socket, { type: "audio-owner", id: "cap-" + socket.data.tab, ownerId: "owner-" + socket.data.tab });
          if (!socket.data.after)
            send(socket, {
              type: "output",
              seq: 1,
              data: Buffer.from("READY " + socket.data.tab + "\r\nActual Ghostty viewport").toString("base64"),
            });
        }
      },
      message(socket, data) {
        messages.push({ tab: socket.data.tab, data: JSON.parse(String(data)) });
      },
      close(socket) {
        sockets.delete(socket);
      },
    },
  });
  return {
    origin: server.url.origin,
    get state() {
      return state;
    },
    requests,
    messages,
    set eventsMuted(value) {
      eventsMuted = value;
    },
    get missingControl() {
      return missingControl;
    },
    set missingControl(value) {
      missingControl = value;
    },
    reset(next = initialState()) {
      state = structuredClone(next);
      nextId = 4;
      requests.length = messages.length = 0;
      fault = undefined;
    },
    update(edit) {
      edit(state);
      state.revision++;
      publish();
    },
    stale() {
      for (const socket of sockets)
        if (socket.data.path === "/api/events") send(socket, { type: "state", state: initialState() });
    },
    fail(path, message, status = 500, wait) {
      fault = { path, message, status, wait };
    },
    terminal(tab, message) {
      for (const socket of sockets) if (socket.data.tab === tab) send(socket, message);
    },
    disconnect(path) {
      for (const socket of sockets) if (socket.data.path === path) socket.close(4001, "fixture disconnect");
    },
    stop() {
      server.stop(true);
    },
  };
}
