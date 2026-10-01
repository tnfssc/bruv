import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { captureRepository } from "../src/remote/repository";
import { tmpdir } from "node:os";
import { RootStore } from "../src/remote/root-store";
import { handleRootRequest, runRootOwner, type RootSessionPort } from "../src/remote/root-owner";
import type {
  RootIntent,
  RootRequest,
  RootRecord,
  RootCommandReceipt,
  RootObservation,
} from "../src/remote/root-contract";
import type { RootFacet } from "../src/remote/root-runtime";
const identity = { ownerId: "installed-owner", epoch: "boot-epoch" };
const root = (repo: string, id = "session"): RootIntent => ({
  ...identity,
  sessionId: id,
  role: "root",
  depth: 0,
  repoPath: repo,
});
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await Bun.sleep(10);
  }
  throw Error("Test wait expired");
}
class FakeInference implements RootSessionPort {
  ui?: RootSessionPort["ui"];
  listeners = new Set<(event: unknown) => void>();
  calls: Array<{ id: string; command: Record<string, unknown> }> = [];
  facets: RootFacet[] = [];
  endCount = 0;
  failPrompt = false;
  settled = true;
  model = { provider: "destination", id: "configured-default" };
  resolveExit!: (exit: { code: number | null; signal: string | null }) => void;
  exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => (this.resolveExit = resolve));
  async rpc(id: string, command: Record<string, unknown>) {
    this.calls.push({ id, command });
    if (command.type === "get_state")
      return { model: this.model, thinkingLevel: "off", sessionFile: "server-session.jsonl" };
    if (command.type === "prompt") {
      if (this.failPrompt) throw Error("Lost write acknowledgement");
      this.emit({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "server inferred: " + command.message }] },
      });
    }
    return { disposition: "accepted" };
  }
  async facet(command: RootFacet) {
    this.facets.push(command);
    if (command.kind === "close")
      return {
        settled: this.settled,
        report: { discoveryComplete: true, outcome: this.settled ? "acknowledged" : "pending" },
      };
    return { sessionFile: "server-session.jsonl", idle: true, pendingMessages: false, questions: [], jobs: [] };
  }
  emit(event: unknown) {
    for (const listener of this.listeners) listener(event);
  }
  onEvent(listener: (event: unknown) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  end() {
    this.endCount++;
    this.resolveExit({ code: 0, signal: null });
  }
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "root-owner-test-")),
    store = new RootStore(join(dir, "durable"));
  const options = { directory: store.directory, hello: async () => identity };
  return {
    dir,
    store,
    options,
    cleanup() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("create resolves exact persisted request/intent and never launches twice after lost acknowledgement", async () => {
  const f = fixture();
  let launches = 0;
  try {
    const request: RootRequest = { op: "create", requestId: "create-1", intent: root(f.dir) };
    const opts = {
      ...f.options,
      launch: () => {
        launches++;
      },
    };
    const first = (await handleRootRequest(request, opts)) as RootRecord;
    expect(first.state).toBe("accepted");
    expect(launches).toBe(1);
    expect(await handleRootRequest(request, opts)).toEqual(first);
    expect(launches).toBe(1);
    await expect(
      handleRootRequest({ ...request, intent: { ...request.intent, thinking: "high" } }, opts),
    ).rejects.toThrow("intent conflict");
    await expect(
      handleRootRequest({ ...request, intent: { ...request.intent, sessionId: "second" } }, opts),
    ).rejects.toThrow("intent conflict");
    await expect(handleRootRequest({ ...request, requestId: "different" }, opts)).rejects.toThrow("intent conflict");
    expect(launches).toBe(1);
  } finally {
    f.cleanup();
  }
});
test("ordinary root fake inference, observe, detach, exact command replay, child settlement and successful close", async () => {
  const f = fixture(),
    port = new FakeInference();
  Object.assign(port.model, {
    headers: { Authorization: "fixture-secret-never-project" },
    apiKey: "fixture-secret-never-project",
  });
  let owner: Promise<void> | undefined;
  try {
    await handleRootRequest(
      { op: "create", requestId: "create", intent: root(f.dir) },
      {
        ...f.options,
        launch: (id) => {
          owner = runRootOwner(id, { directory: f.store.directory, port: () => port });
        },
      },
    );
    await until(() => f.store.get("session").record.state === "running");
    port.emit({ type: "response", id: "private", data: { model: port.model } });
    const command: RootRequest = {
      op: "command",
      ...identity,
      sessionId: "session",
      commandId: "prompt-1",
      command: { kind: "prompt", text: "hello" },
    };
    await handleRootRequest(command, f.options);
    await until(() => f.store.receipt("session", "prompt-1").state === "completed");
    await handleRootRequest(command, f.options);
    expect(port.calls.filter((c) => c.command.type === "prompt")).toHaveLength(1);
    await expect(
      handleRootRequest({ ...command, command: { kind: "prompt", text: "other" } }, f.options),
    ).rejects.toThrow("intent conflict");
    const before = port.calls.length;
    expect(await handleRootRequest({ op: "detach", ...identity, sessionId: "session" }, f.options)).toEqual({
      detached: true,
    });
    expect(port.endCount).toBe(0);
    expect(port.calls.length).toBe(before);
    const view = (await handleRootRequest(
      { op: "observe", ...identity, sessionId: "session", cursor: 0 },
      f.options,
    )) as RootObservation;
    expect(view.record.model).toEqual({ provider: port.model.provider, id: port.model.id });
    expect(JSON.stringify(view)).not.toContain("fixture-secret-never-project");
    expect(view.events.some((e) => (e.event as { type: string }).type === "message_end")).toBe(true);
    expect(view.events.map((e) => e.seq)).toEqual(view.events.map((_, i) => i + 1));
    port.settled = false;
    await handleRootRequest(
      { op: "command", ...identity, sessionId: "session", commandId: "close-pending", command: { kind: "close" } },
      f.options,
    );
    await until(() => f.store.receipt("session", "close-pending").state === "completed");
    expect(f.store.get("session").record.state).toBe("running");
    expect(port.endCount).toBe(0);
    port.settled = true;
    await handleRootRequest(
      { op: "command", ...identity, sessionId: "session", commandId: "close-final", command: { kind: "close" } },
      f.options,
    );
    await owner;
    expect(f.store.get("session").record).toMatchObject({ state: "closed", exitCode: 0 });
    expect(f.store.receipt("session", "close-final")).toMatchObject({
      state: "completed",
      result: { settled: true, exitCode: 0 },
    });
    expect(port.endCount).toBe(1);
    await expect(handleRootRequest({ ...command, commandId: "new-prompt" }, f.options)).rejects.toThrow(
      "not accepting",
    );
  } finally {
    port.end();
    await owner;
    f.cleanup();
  }
});
test("unknown runtime write never replays and owner death does not start a replacement", async () => {
  const f = fixture(),
    port = new FakeInference();
  port.failPrompt = true;
  let owner: Promise<void> | undefined,
    launches = 0;
  try {
    const create: RootRequest = { op: "create", intent: root(f.dir), requestId: "create" };
    const opts = {
      ...f.options,
      launch: (id: string) => {
        launches++;
        owner = runRootOwner(id, { directory: f.store.directory, port: () => port });
      },
    };
    await handleRootRequest(create, opts);
    await until(() => f.store.get("session").record.state === "running");
    const request: RootRequest = {
      op: "command",
      ...identity,
      sessionId: "session",
      commandId: "uncertain",
      command: { kind: "prompt", text: "possibly delivered" },
    };
    await handleRootRequest(request, f.options);
    await until(() => f.store.receipt("session", "uncertain").state === "unknown");
    expect(((await handleRootRequest(request, f.options)) as RootCommandReceipt).state).toBe("unknown");
    expect(port.calls.filter((c) => c.command.type === "prompt")).toHaveLength(1);
    const r = f.store.get("session");
    r.ownerPid = 999999999;
    r.ownerStart = "not-existing";
    f.store.save(r);
    await handleRootRequest(create, opts);
    expect(f.store.get("session").record.state).toBe("unknown");
    expect(launches).toBe(1);
  } finally {
    port.end();
    await owner;
    f.cleanup();
  }
});
test("crash reconciliation changes dispatching to unknown, exact retry never queues again", async () => {
  const f = fixture();
  try {
    f.store.accept(root(f.dir), "create");
    f.store.enqueue("session", "c1", { kind: "prompt", text: "accepted" });
    f.store.claimCommand("session");
    const r = f.store.get("session");
    r.ownerClaim = "claimed";
    r.ownerPid = 999999999;
    r.ownerStart = "missing";
    f.store.save(r);
    await handleRootRequest({ op: "observe", ...identity, sessionId: "session", cursor: 0 }, f.options);
    expect(f.store.receipt("session", "c1").state).toBe("unknown");
    expect(f.store.enqueue("session", "c1", { kind: "prompt", text: "accepted" }).state).toBe("unknown");
    expect(f.store.claimCommand("session")).toBeUndefined();
  } finally {
    f.cleanup();
  }
});
test("bounded event journal reports retained cursor gaps rather than silently skipping", () => {
  const dir = mkdtempSync(join(tmpdir(), "root-gap-")),
    store = new RootStore(dir, 80);
  try {
    store.accept(root(dir), "request");
    for (let i = 0; i < 8; i++) store.append("session", { text: "abcdefghijklmnop", i });
    expect(() => store.observe("session", 0)).toThrow("gap");
    expect(store.observe("session", 7).events[0]?.seq).toBe(8);
    expect(() => store.observe("session", 100)).toThrow("gap");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("rejects child role, stale owner epoch, unknown command fields and nonexact model overrides", async () => {
  const f = fixture();
  try {
    for (const intent of [
      { ...root(f.dir), depth: 1 },
      { ...root(f.dir), role: "normal" },
      { ...root(f.dir), epoch: "new" },
      { ...root(f.dir), model: "fuzzy-default" },
    ])
      await expect(
        handleRootRequest(
          { op: "create", intent: intent as RootIntent, requestId: "create" },
          {
            ...f.options,
            launch: () => {
              throw Error("must never launch");
            },
          },
        ),
      ).rejects.toThrow();
    await handleRootRequest(
      { op: "create", intent: root(f.dir), requestId: "create" },
      { ...f.options, launch: () => {} },
    );
    await expect(
      handleRootRequest(
        {
          op: "command",
          ...identity,
          epoch: "wrong",
          sessionId: "session",
          commandId: "c1",
          command: { kind: "abort" },
        },
        f.options,
      ),
    ).rejects.toThrow("identity");
    await expect(
      handleRootRequest(
        {
          op: "command",
          ...identity,
          sessionId: "session",
          commandId: "c1",
          command: { kind: "abort", text: "extra" },
        } as unknown as RootRequest,
        f.options,
      ),
    ).rejects.toThrow("field");
  } finally {
    f.cleanup();
  }
});
test("destination explicit model mismatch rejects without a root-profile fallback", async () => {
  const f = fixture(),
    port = new FakeInference();
  try {
    f.store.accept({ ...root(f.dir), model: "destination/not-installed" }, "create");
    await runRootOwner("session", { directory: f.store.directory, port: () => port });
    expect(f.store.get("session").record).toMatchObject({ state: "unknown" });
    expect(f.store.get("session").record.error).toContain("fallback forbidden");
    expect(port.calls.filter((c) => c.command.type === "prompt")).toHaveLength(0);
  } finally {
    port.end();
    f.cleanup();
  }
});
test("duplicate owner invocation rejects without corrupting the existing root", async () => {
  const f = fixture(),
    port = new FakeInference();
  let owner: Promise<void> | undefined;
  try {
    f.store.accept(root(f.dir), "create");
    owner = runRootOwner("session", { directory: f.store.directory, port: () => port });
    await until(() => f.store.get("session").record.state === "running");
    await expect(
      runRootOwner("session", { directory: f.store.directory, port: () => new FakeInference() }),
    ).rejects.toThrow("claimed");
    expect(f.store.get("session").record.state).toBe("running");
  } finally {
    port.end();
    await owner;
    f.cleanup();
  }
});

test("root-owned tracked snapshot upload is replay-safe and result export requires confirmed successful close", async () => {
  const f = fixture();
  function git(repo: string, ...args: string[]) {
    const r = Bun.spawnSync(["git", "-C", repo, ...args], {
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    if (r.exitCode) throw Error(r.stderr.toString());
    return r.stdout.toString().trim();
  }
  try {
    const repo = join(f.dir, "source");
    mkdirSync(repo);
    git(repo, "init", "-q");
    writeFileSync(join(repo, "tracked"), "committed baseline\n");
    git(repo, "add", ".");
    git(repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@invalid", "commit", "-qm", "baseline");
    writeFileSync(join(repo, "tracked"), "current dirty tracked state\n");
    writeFileSync(join(repo, "unapproved"), "do not transfer\n");
    const manifest = captureRepository(repo, join(f.dir, "capture"));
    const bytes = readFileSync(manifest.bundle);
    let checkout = "";
    for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
      const request: RootRequest = {
        op: "repository-upload",
        ...identity,
        sessionId: "session",
        snapshot: manifest.snapshot,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        total: bytes.length,
        offset,
        data: bytes.subarray(offset, offset + 256 * 1024).toString("base64"),
      };
      const first = (await handleRootRequest(request, f.options)) as { checkout?: string };
      expect(await handleRootRequest(request, f.options)).toEqual(first);
      checkout = first.checkout ?? checkout;
    }
    expect(checkout).toBe(join(f.store.path("session"), "checkout"));
    expect(readFileSync(join(checkout, "tracked"), "utf8")).toBe("current dirty tracked state\n");
    expect(git(checkout, "rev-list", "--count", "HEAD")).toBe("1");
    expect(git(checkout, "ls-files")).toBe("tracked");
    const result: RootRequest = { op: "repository-result", ...identity, sessionId: "session", offset: 0 };
    await expect(handleRootRequest(result, f.options)).rejects.toThrow("confirmed successful");
    await handleRootRequest(
      { op: "create", requestId: "create", intent: root(checkout) },
      { ...f.options, launch: () => {} },
    );
    await expect(handleRootRequest(result, f.options)).rejects.toThrow("confirmed successful");
    writeFileSync(join(checkout, "tracked"), "server result change\n");
    let saved = f.store.get("session");
    saved.record = { ...saved.record, state: "unknown" };
    f.store.save(saved);
    await expect(handleRootRequest(result, f.options)).rejects.toThrow("confirmed successful");
    saved = f.store.get("session");
    saved.record = { ...saved.record, state: "closed", exitCode: 1 };
    f.store.save(saved);
    await expect(handleRootRequest(result, f.options)).rejects.toThrow("confirmed successful");
    saved = f.store.get("session");
    saved.record = { ...saved.record, state: "closed", exitCode: 0 };
    f.store.save(saved);
    const returned = (await handleRootRequest(result, f.options)) as {
      data: string;
      result: { snapshot: string; sha256: string };
    };
    expect(returned.result.snapshot).toBe(manifest.snapshot);
    expect(Buffer.from(returned.data, "base64").toString()).toContain("server result change");
    expect(createHash("sha256").update(Buffer.from(returned.data, "base64")).digest("hex")).toBe(
      returned.result.sha256,
    );
  } finally {
    f.cleanup();
  }
});

test("typed UI dialog response is ledgered and retried by command ID without resending", async () => {
  const f = fixture(),
    port = new FakeInference();
  let owner: Promise<void> | undefined,
    responses = 0;
  port.ui = async () => {
    responses++;
    return { delivery: "written", applied: "unknown" };
  };
  try {
    f.store.accept(root(f.dir), "create");
    owner = runRootOwner("session", { directory: f.store.directory, port: () => port });
    await until(() => f.store.get("session").record.state === "running");
    port.emit({ type: "extension_ui_request", method: "confirm", id: "dialog", title: "Cancel?" });
    const request: RootRequest = {
      op: "command",
      ...identity,
      sessionId: "session",
      commandId: "human-response",
      command: { kind: "ui.respond", id: "dialog", confirmed: true },
    };
    await handleRootRequest(request, f.options);
    await until(() => f.store.receipt("session", "human-response").state === "completed");
    expect(((await handleRootRequest(request, f.options)) as RootCommandReceipt).result).toEqual({
      delivery: "written",
      applied: "unknown",
    });
    expect(responses).toBe(1);
    await expect(
      handleRootRequest(
        {
          ...request,
          commandId: "invalid",
          command: { kind: "ui.respond", id: "dialog", confirmed: true, value: "bad" },
        },
        f.options,
      ),
    ).rejects.toThrow("exactly one");
  } finally {
    port.end();
    await owner;
    f.cleanup();
  }
});

test("pending SDK dialogs survive presentation reconnect and claimed responses are never solicited twice", () => {
  const dir = mkdtempSync(join(tmpdir(), "root-dialog-store-"));
  try {
    let store = new RootStore(dir);
    store.accept(root(dir), "request");
    store.append("session", { type: "extension_ui_request", id: "human", method: "confirm", title: "Stop work?" });
    store.close();
    store = new RootStore(dir);
    expect(store.observe("session", 1).record.dialogs).toEqual([
      { type: "extension_ui_request", id: "human", method: "confirm", title: "Stop work?" },
    ]);
    store.append("session", { type: "root_ui_response", id: "human" });
    expect(store.observe("session", 2).record.dialogs).toEqual([]);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
