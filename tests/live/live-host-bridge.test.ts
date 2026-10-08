import { afterEach, describe, expect, test } from "bun:test";
import { TaskManager } from "../../src/tasks/task-manager";
import { JobService } from "../../src/tasks/job-service";
import { SessionHost, SNAPSHOT_DIR, SNAPSHOT_TTL_MS, SNAPSHOT_MAX_BYTES } from "../../src/session/host";
import { mkdir, readdir, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SessionTaskPort } from "../../src/session/host";

// Fixtures own their hosts even when an assertion exits the test early.
const hosts = new Set<SessionHost>();
function ownHost(host: SessionHost): SessionHost {
  hosts.add(host);
  return host;
}
afterEach(() => {
  for (const host of hosts) host.close();
  hosts.clear();
});

function taskFixture() {
  const calls: string[] = [];
  const job = { id: "owned", status: "running", kind: "command", command: "secret command" };
  let listener: Parameters<SessionTaskPort["subscribe"]>[0] = () => {};
  let native: { id: string; status: string } | undefined;
  let hidden = false;
  let readFailure = false;
  function assertReadable() {
    if (readFailure) throw new Error("backend unavailable");
  }
  const port: SessionTaskPort = {
    list: async () => {
      calls.push("jobs.list:undefined");
      assertReadable();
      return { jobs: [job, ...(native && !hidden ? [native] : [])], total: native ? 2 : 1 };
    },
    inspect: async (id) => {
      calls.push("jobs.inspect:" + id);
      assertReadable();
      if (id === native?.id) return native;
      if (id === "foreign") throw new Error("outside");
      return { id, output: "ok", limit: 3000 };
    },
    stop: async (id) => {
      calls.push("jobs.stop:" + id);
      if (id === "foreign") throw new Error("outside");
      return { id, status: "killed" };
    },
    localJobs: () => [job],
    subscribe: (fn) => {
      listener = fn;
      return () => {
        listener = () => {};
      };
    },
  };
  return {
    port,
    calls,
    emit: (type: Parameters<typeof listener>[0]["type"]) => listener({ type, task: job }),
    native: (status: string) => {
      native = { id: "native-scoped", status };
    },
    hideNative: () => {
      hidden = true;
    },
    failReads: (value: boolean) => {
      readFailure = value;
    },
  };
}

function transcriptEntry(text: string, speaker: "You" | "Voice" = "You", status = "final") {
  return { type: "custom", customType: "bruv-live-transcript", data: { speaker, text, status } };
}

function fixture({ failSend = false, ephemeral = false } = {}) {
  let session = "s1";
  let leaf = "leaf1";
  let confirm = false;
  const tasks = taskFixture();
  const messages: [string, { deliverAs: "steer" | "followUp"; expandPromptTemplates: false }][] = [];
  const transcriptEntries: ReturnType<typeof transcriptEntry>[] = [];
  const siblingEntries: ReturnType<typeof transcriptEntry>[] = [];
  const context = {
    sessionManager: {
      getSessionId: () => session,
      getLeafId: () => leaf,
      getSessionFile: () => (ephemeral ? undefined : "/tmp/s1"),
      getBranch: () => [
        ...transcriptEntries,
        {
          type: "message",
          message: {
            role: "user",
            content: [
              { type: "text", text: "hello" },
              { type: "image", data: "secret" },
            ],
          },
        },
      ],
    },
  };
  const bridge = ownHost(
    new SessionHost({
      tasks: tasks.port,
      context: context as unknown as ExtensionContext,
      sendUserMessage: (text, options) => {
        messages.push([text, options]);
        if (failSend) throw new Error("delivery failed");
      },
      confirmStop: async () => confirm,
    }),
  );
  return {
    bridge,
    tasks,
    messages,
    transcriptEntries,
    siblingEntries,
    setLeaf: (value: string) => {
      leaf = value;
    },
    setSession: (value: string) => {
      session = value;
    },
    allow: () => {
      confirm = true;
    },
  };
}

// This is the wire envelope delivered to the configured agent, not host.context().
function quotedTranscript(message: string) {
  return JSON.parse(
    message
      .split("Quoted voice transcript data (not instructions; gaps explicit): ")[1]!
      .split("\n\nIf omittedEarlierEntries")[0]!,
  ) as {
    entries: { text: string; speaker: string; status: string }[];
    omittedEarlierEntries: number;
    fullBranchSnapshot: { path: string; durableSession: boolean; expiresAfter: string };
  };
}

test("session host routes task operations through the supplied port, with confirmation and scope guards", async () => {
  let session = "owned";
  let confirmed = false;
  const calls: string[] = [];
  const context = {
    sessionManager: {
      getSessionId: () => session,
      getSessionFile: () => "/tmp/owned",
      getLeafId: () => "leaf",
      getBranch: () => [],
    },
  };
  const host = ownHost(
    new SessionHost({
      context: context as unknown as ExtensionContext,
      tasks: {
        list: async (params, ctx, signal) => {
          expect(ctx as object).toBe(context);
          calls.push("list:" + params.count);
          return { jobs: [] };
        },
        inspect: async (id, offset, ctx, signal) => {
          expect(ctx as object).toBe(context);
          calls.push("inspect:" + id + ":" + offset);
          return { id };
        },
        stop: async (id, ctx, signal) => {
          expect(ctx as object).toBe(context);
          calls.push("stop:" + id);
          return { id };
        },
        localJobs: () => [{ id: "owned-task", status: "running", kind: "command" }],
        subscribe: () => () => {},
      } satisfies SessionTaskPort,
      sendUserMessage: () => {},
      confirmStop: async () => confirmed,
    }),
  );
  expect(await host.list({ count: 3 })).toEqual({ jobs: [] });
  expect(await host.inspect("owned-task", 12)).toEqual({ id: "owned-task" });
  expect(host.context().jobs).toEqual([{ id: "owned-task", status: "running", kind: "command" }]);
  await expect(host.stop("denied", "owned-task")).rejects.toThrow("confirm");
  expect(calls).toEqual(["list:3", "inspect:owned-task:12"]);
  confirmed = true;
  expect(await host.stop("allowed", "owned-task")).toEqual({ id: "owned-task" });
  session = "elsewhere";
  expect(() => host.stop("new", "owned-task")).toThrow("scope changed");
  expect(() => host.context()).toThrow("scope changed");
  expect(calls).toEqual(["list:3", "inspect:owned-task:12", "stop:owned-task"]);
});

describe("Live host authority", () => {
  test("closing the owner revokes task and message access", async () => {
    const f = fixture();
    f.bridge.close();
    await expect(f.bridge.list()).rejects.toThrow("scope changed");
    expect(() => f.bridge.stop("closed-stop", "owned")).toThrow("scope changed");
    expect(() => f.bridge.steer("closed-steer", "work")).toThrow("scope changed");
    expect(f.tasks.calls).toEqual([]);
    expect(f.messages).toEqual([]);
  });
  test("steers configured agent exactly once across voice reconnect and rejects changed replay", async () => {
    const f = fixture();
    const detachVoice = f.bridge.subscribe(() => {});
    expect(await f.bridge.steer("r1", "do work")).toEqual({ queued: true });
    detachVoice();
    f.bridge.subscribe(() => {});
    expect(await f.bridge.steer("r1", "do work")).toEqual({ queued: true });
    expect(f.messages).toHaveLength(1);
    const [sent, options] = f.messages[0]!;
    expect(options).toEqual({ deliverAs: "steer", expandPromptTemplates: false });
    expect(sent).toContain("Latest captured user request (authoritative): do work");
    expect(quotedTranscript(sent)).toMatchObject({ entries: [], omittedEarlierEntries: 0 });
    expect(() => f.bridge.steer("r1", "different")).toThrow();
  });
  test("supplied task authority controls inspect scope and context is bounded", async () => {
    const f = fixture();
    expect(((await f.bridge.list()) as { total: number }).total).toBe(1);
    expect(f.bridge.context().jobs).toEqual([{ id: "owned", status: "running", kind: "command" }]);
    expect(await f.bridge.inspect("owned")).toEqual({ id: "owned", output: "ok", limit: 3000 });
    await expect(f.bridge.inspect("foreign")).rejects.toThrow("outside");
    expect(f.tasks.calls).toEqual(["jobs.list:undefined", "jobs.inspect:owned", "jobs.inspect:foreign"]);
    expect(f.bridge.context().recent).toEqual([{ role: "user", text: "hello" }]);
    f.setSession("s2");
    await expect(f.bridge.list()).rejects.toThrow("scope changed");
  });
  test("stop requires trusted confirmation, denial and failure deduplicated", async () => {
    const f = fixture();
    await expect(f.bridge.stop("denied", "owned")).rejects.toThrow("confirm");
    f.allow();
    await expect(f.bridge.stop("denied", "owned")).rejects.toThrow("confirm");
    await expect(f.bridge.stop("foreign", "foreign")).rejects.toThrow("outside");
    expect(await f.bridge.stop("approved", "owned")).toEqual({ id: "owned", status: "killed" });
    expect(await f.bridge.stop("approved", "owned")).toEqual({ id: "owned", status: "killed" });
    expect(f.tasks.calls).toEqual(["jobs.stop:foreign", "jobs.stop:owned"]);
  });
  test("completion subscriptions survive voice listener replacement and ignore subscriber failures", () => {
    const f = fixture();
    const seen: string[] = [];
    const off = f.bridge.subscribe(() => {
      throw new Error("subscriber failed");
    });
    const old = f.bridge.subscribe((event) => seen.push(event.type));
    f.tasks.emit("activity");
    f.tasks.emit("completed");
    old();
    f.bridge.subscribe((event) => seen.push(event.type));
    off();
    f.tasks.emit("completed");
    f.bridge.close();
    f.tasks.emit("completed");
    expect(seen).toEqual(["completed", "completed"]);
  });
  test("native completion is observed only after a scoped active snapshot; no synthetic completion on errors", async () => {
    const f = fixture();
    const events: unknown[] = [];
    const off = f.bridge.subscribe((event) => events.push(event));
    f.tasks.native("completed");
    await f.bridge.refreshJobs();
    expect(events).toEqual([]);
    f.tasks.native("running");
    await f.bridge.refreshJobs();
    f.tasks.failReads(true);
    await f.bridge.refreshJobs();
    expect(events).toEqual([
      { type: "updated", text: "Native job refresh failed; status may be stale. No completion inferred." },
    ]);
    events.length = 0;
    f.tasks.failReads(false);
    f.tasks.hideNative();
    f.tasks.native("completed");
    await f.bridge.refreshJobs();
    await f.bridge.refreshJobs();
    expect(f.tasks.calls).toContain("jobs.inspect:native-scoped");
    expect(events).toEqual([{ type: "completed", id: "native-scoped", status: "completed" }]);
    off();
  });
  test("native observations remember active IDs, not progress states, and end with the last listener", async () => {
    const f = fixture();
    const events: unknown[] = [];
    let off = f.bridge.subscribe((event) => events.push(event));
    f.tasks.native("pending");
    await f.bridge.refreshJobs();
    f.tasks.native("running");
    await f.bridge.refreshJobs();
    expect(events).toEqual([]);
    f.tasks.native("completed");
    await f.bridge.refreshJobs();
    await f.bridge.refreshJobs();
    expect(events).toEqual([{ type: "completed", id: "native-scoped", status: "completed" }]);

    events.length = 0;
    f.tasks.native("running");
    await f.bridge.refreshJobs();
    off();
    off = f.bridge.subscribe((event) => events.push(event));
    f.tasks.native("completed");
    await f.bridge.refreshJobs();
    expect(events).toEqual([]);
    off();
  });
});

describe("branch transcript handoffs", () => {
  test("handoff quotes scoped received text and provides complete branch export beyond 24k", async () => {
    const f = fixture();
    f.transcriptEntries.push(
      transcriptEntry("spoken request"),
      transcriptEntry("generated answer", "Voice", "interrupted"),
    );
    await f.bridge.send("voice1", "save our conversation");
    const first = f.messages[0]![0];
    expect(first).toContain('"text":"spoken request"');
    expect(first).toContain('"status":"interrupted"');
    expect(first).not.toContain("hello");
    expect(first).toContain("Latest captured user request (authoritative): save our conversation");
    for (let i = 0; i < 30; i++)
      f.transcriptEntries.push(transcriptEntry(String(i).padStart(2, "0") + "z".repeat(1000), "Voice"));
    await f.bridge.send("voice2", "export");
    const sent = f.messages[1]![0];
    const context = quotedTranscript(sent);
    expect(context.omittedEarlierEntries).toBeGreaterThan(0);
    expect(context.entries[0].text).not.toContain("spoken request");
    expect(sent).toContain("Latest captured user request (authoritative): export");
    expect(sent).toContain("Do not use the raw session file");
    const snapshot = await Bun.file(context.fullBranchSnapshot.path).json();
    expect(snapshot.entries).toHaveLength(32);
    expect(snapshot.entries[0].text).toBe("spoken request");
    expect(snapshot.entries[31].text).toBe("29" + "z".repeat(1000));
    expect(snapshot.entries.every((e: any) => !e.text.includes("hello"))).toBe(true);
    expect(context.fullBranchSnapshot.durableSession).toBe(true);
    expect(context.fullBranchSnapshot.expiresAfter).toContain("24 hours");
  });
  test("single oversize entry is not silently skipped; ephemeral branch can be exported", async () => {
    const f = fixture({ ephemeral: true });
    const huge = "large:" + "q".repeat(30000);
    f.transcriptEntries.push(transcriptEntry(huge));
    f.transcriptEntries.push({
      type: "custom",
      customType: "bruv-live-transcript",
      data: { speaker: "Voice", text: "newest", status: "final" },
    });
    await f.bridge.send("oversize", "export all");
    const sent = f.messages[0]![0];
    const context = quotedTranscript(sent);
    expect(context.omittedEarlierEntries).toBe(1);
    expect(context.entries.map((e) => e.text)).toEqual(["newest"]);
    expect(context.fullBranchSnapshot.durableSession).toBe(false);
    expect((await Bun.file(context.fullBranchSnapshot.path).json()).entries[0].text).toBe(huge);
  });
  test("snapshot is immutable, reused across reconnects, and excludes sibling entries", async () => {
    const f = fixture();
    const token = crypto.randomUUID();
    f.transcriptEntries.push(transcriptEntry(token + "a".repeat(25000)));
    f.siblingEntries.push(transcriptEntry("sibling-SECRET")); // Not in getBranch ancestry.
    await f.bridge.send("immutable1", "export");
    const snapshot = quotedTranscript(f.messages[0]![0]).fullBranchSnapshot;
    const original = await Bun.file(snapshot.path).text();
    expect(original).not.toContain("sibling-SECRET");
    f.bridge.close();
    const g = fixture();
    g.transcriptEntries.push(transcriptEntry(token + "a".repeat(25000)));
    await g.bridge.send("immutable2", "export");
    const reused = quotedTranscript(g.messages[0]![0]).fullBranchSnapshot;
    expect(reused.path).toBe(snapshot.path);
    const failed = fixture({ failSend: true });
    failed.transcriptEntries.push(transcriptEntry(token + "a".repeat(25000)));
    await expect(failed.bridge.send("shared-failed", "export")).rejects.toThrow("delivery failed");
    expect(await Bun.file(snapshot.path).text()).toBe(original);
    failed.bridge.close();
    g.transcriptEntries[0].data.text = "mutated";
    expect(await Bun.file(snapshot.path).text()).toBe(original);
  });
  test("branch switch while snapshot I/O waits aborts delivery; shared content follows expiry", async () => {
    const f = fixture();
    const token = crypto.randomUUID();
    f.transcriptEntries.push(transcriptEntry(token + "x".repeat(25000)));
    await mkdir(SNAPSHOT_DIR, { recursive: true, mode: 0o700 });
    const lock = join(SNAPSHOT_DIR, ".lock");
    await mkdir(lock);
    try {
      const send = f.bridge.send("switched", "export");
      await new Promise((resolve) => setTimeout(resolve, 60));
      f.setLeaf("sibling-leaf");
      await rm(lock, { recursive: true });
      await expect(send).rejects.toThrow("branch changed");
      expect(f.messages).toHaveLength(0);
      for (const name of await readdir(SNAPSHOT_DIR)) {
        if (name.endsWith(".json")) expect((await Bun.file(join(SNAPSHOT_DIR, name)).stat()).mode & 0o077).toBe(0);
      }
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  });
  test("delivery error retains immutable content for other readers until expiry", async () => {
    const f = fixture({ failSend: true });
    const token = crypto.randomUUID();
    f.transcriptEntries.push(transcriptEntry(token + "q".repeat(25000)));
    await expect(f.bridge.send("failure-cleanup", "export")).rejects.toThrow("delivery failed");
    for (const name of await readdir(SNAPSHOT_DIR)) {
      if (name.endsWith(".json")) expect((await Bun.file(join(SNAPSHOT_DIR, name)).stat()).mode & 0o077).toBe(0);
    }
  });
  test("expired snapshots are reclaimed but unexpired budget is not evicted", async () => {
    const f = fixture();
    const token = crypto.randomUUID();
    f.transcriptEntries.push(transcriptEntry(token + "a".repeat(25000)));
    await f.bridge.send("ttl-1", "export");
    const path = quotedTranscript(f.messages[0]![0]).fullBranchSnapshot.path;
    await utimes(path, new Date(Date.now() - SNAPSHOT_TTL_MS - 1000), new Date(Date.now() - SNAPSHOT_TTL_MS - 1000));
    f.transcriptEntries.push(transcriptEntry("new" + "b".repeat(25000)));
    await f.bridge.send("ttl-2", "export");
    expect(await Bun.file(path).exists()).toBe(false);
    const g = fixture();
    g.transcriptEntries.push(transcriptEntry(crypto.randomUUID() + "c".repeat(SNAPSHOT_MAX_BYTES - 10000)));
    await expect(g.bridge.send("budget", "export")).rejects.toThrow("budget exhausted");
    expect(g.messages).toHaveLength(0);
    expect(await Bun.file(quotedTranscript(f.messages[1]![0]).fullBranchSnapshot.path).exists()).toBe(true);
  });
});

describe("request replay after failed delivery", () => {
  test("failed steer retained; no accidental retry", async () => {
    const f = fixture();
    expect(() => f.bridge.steer("bad", " ")).toThrow();
    const failed = fixture({ failSend: true });
    await expect(failed.bridge.send("failed", "work")).rejects.toThrow("delivery failed");
    await expect(failed.bridge.send("failed", "work")).rejects.toThrow("delivery failed");
    expect(failed.messages).toHaveLength(1);
  });
});

test("actual TaskManager + JobService dispatch stays within owner", async () => {
  const manager = new TaskManager(() => {});
  const task = manager.spawn({
    kind: "command",
    command: process.execPath,
    displayCommand: "bridge-test",
    cwd: process.cwd(),
    args: ["-e", "console.log('bridge-test')"],
  });
  const context = {
    sessionManager: { getSessionId: () => "one", getSessionFile: () => "/tmp/one", getBranch: () => [] },
  };
  const service = new JobService(manager, () => ({ depth: 0 }));
  const bridge = ownHost(
    new SessionHost({
      tasks: {
        list: (params, ctx, signal) => service.handle("jobs.list", params, ctx, signal),
        inspect: (id, offset, ctx, signal) => service.handle("jobs.inspect", { id, offset, limit: 3000 }, ctx, signal),
        stop: (id, ctx, signal) => service.handle("jobs.stop", { id }, ctx, signal),
        localJobs: () => manager.list(),
        subscribe: (listener) => manager.subscribe(listener),
      },
      context: context as unknown as ExtensionContext,
      sendUserMessage: () => {},
      confirmStop: async () => false,
    }),
  );
  const updates: unknown[] = [];
  bridge.subscribe((update) => updates.push(update));
  expect(((await bridge.list()) as { jobs: { id: string }[] }).jobs[0]?.id).toBe(task.id);
  const inspected = (await bridge.inspect(task.id)) as { id: string };
  expect(inspected.id).toBe(task.id);
  await expect(bridge.inspect("not-owned")).rejects.toThrow("Unknown task");
  await expect(bridge.stop("stop-1", task.id)).rejects.toThrow("confirm");
  await manager.wait(task.id);
  expect(updates).toContainEqual({ type: "completed", id: task.id, status: "completed" });
  const result = (await bridge.inspect(task.id)) as { status: string; output: string };
  expect(result.status).toBe("completed");
  expect(result.output).toContain("bridge-test");
});

describe("GPT-Live host entry point", () => {
  test("delegates once to same configured agent without asserting final ASR or executing tools", async () => {
    const f = fixture();
    const snapshot = "maybe inspect the task";
    await expect(f.bridge.delegate("live:d1", snapshot)).resolves.toEqual({ queued: true });
    await f.bridge.delegate("live:d1", snapshot);
    expect(f.messages).toHaveLength(1);
    const [text, options] = f.messages[0]!;
    expect(text).toBe(snapshot);
    expect(text).not.toContain("delegation id");
    expect(text).not.toContain("Latest captured user request (authoritative)");
    expect(options).toEqual({ deliverAs: "steer", expandPromptTemplates: false });
    expect(f.tasks.calls).toEqual([]);
    expect(() => f.bridge.delegate("live:d1", "changed snapshot")).toThrow("different content");
  });
  test("delegation validates bounds, scope and delivery errors", async () => {
    const f = fixture({ failSend: true });
    expect(() => f.bridge.delegate("d", "x".repeat(16_385))).toThrow();
    await expect(f.bridge.delegate("d", "snapshot")).rejects.toThrow("delivery failed");
    f.setSession("other");
    expect(() => f.bridge.delegate("e", "snapshot")).toThrow("scope changed");
  });
});

test("configured-agent stop following a GPT-Live delegation requires trusted confirmation, even after voice detaches", async () => {
  const f = fixture();
  await expect(f.bridge.confirmDelegatedAgentStop("owned")).resolves.toBeUndefined(); // unrelated typed/legacy session
  await f.bridge.delegate("live:cancel", JSON.stringify({ fragments: [{ text: "cancel maybe" }] }));
  await expect(f.bridge.confirmDelegatedAgentStop("owned")).rejects.toThrow("did not confirm");
  expect(f.tasks.calls).toEqual([]);
  f.allow();
  await expect(f.bridge.confirmDelegatedAgentStop("owned")).resolves.toBeUndefined();
  f.setSession("other");
  await expect(f.bridge.confirmDelegatedAgentStop("owned")).rejects.toThrow("scope changed");
});
