import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lazyStream, type Model } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { NATIVE_CODEX_SUMMARY, registerNativeCodexCompaction } from "../../src/agent/native-compaction";
import { NATIVE_FAST_ENTRY, registerNativeFastMode } from "../../src/agent/native-fast-mode";
import { DiskEntryStore } from "../../src/history/disk-entry-store";
import {
  disposeDiskBackedSessionManager,
  getDiskBackedEntryMetadata,
  installDiskBackedSessionManager,
} from "../../src/history/session-manager";

// Adapter prototypes are process-wide. Exercise the CLI's disk-before-shake
// installation order without inheriting another test file's earlier wrappers.
if (process.env.BRUV_TEST_NATIVE_REQUEST_HISTORY_CHILD !== "1") {
  test("native request-history regressions in an isolated SDK process", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, BRUV_TEST_NATIVE_REQUEST_HISTORY_CHILD: "1", HERDR_ENV: "0" },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stdout + stderr).toBe(0);
  });
} else {
  installDiskBackedSessionManager();
  const model: Model<any> = {
    id: "gpt-test",
    name: "test",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100000,
    maxTokens: 10000,
  };
  const roots: string[] = [];
  const managers: SessionManager[] = [];
  afterEach(async () => {
    for (const manager of managers.splice(0)) disposeDiskBackedSessionManager(manager);
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });
  async function history() {
    const root = await mkdtemp(join(tmpdir(), "bruv-native-request-index-"));
    roots.push(root);
    const manager = SessionManager.create(root, join(root, "sessions"));
    managers.push(manager);
    const first = manager.appendMessage({ role: "user", content: "first", timestamp: 1 });
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "answer" }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      stopReason: "stop",
      timestamp: 2,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    });
    for (let i = 0; i < 60; i++)
      manager.appendMessage({ role: "user", content: "unrelated body ".repeat(300), timestamp: i + 3 });
    manager.appendCustomEntry("unrelated-setting", { content: "unrelated custom body" });
    manager.appendLabelChange(first, "label");
    return { manager, first };
  }
  function reopen(manager: SessionManager) {
    const opened = SessionManager.open(manager.getSessionFile()!);
    managers.push(opened);
    expect(getDiskBackedEntryMetadata(opened)).toBeDefined();
    return opened;
  }
  function trackBodies() {
    const reads: { id: string; type: string }[] = [];
    const original = DiskEntryStore.prototype.materialize;
    const spy = spyOn(DiskEntryStore.prototype, "materialize").mockImplementation(function (
      this: DiskEntryStore,
      value,
    ) {
      const meta = typeof value === "string" ? this.byId.get(value)! : value;
      reads.push({ id: meta.id, type: meta.type });
      return original.call(this, value);
    });
    return { reads, restore: () => spy.mockRestore() };
  }
  function compactionHarness(manager: SessionManager, selectedModel = model) {
    const hooks = new Map<string, any>();
    let aborted = 0;
    registerNativeCodexCompaction({ on: (name: string, handler: any) => hooks.set(name, handler) } as any);
    const ctx: any = { model: selectedModel, sessionManager: manager, abort: () => aborted++, ui: { notify() {} } };
    return {
      hooks,
      ctx,
      get aborted() {
        return aborted;
      },
    };
  }
  const details = {
    strategy: "codex-native",
    version: 1,
    api: model.api,
    provider: model.provider,
    model: model.id,
    thinkingLevel: null,
    item: { type: "compaction", id: "cmp_disk", encrypted_content: "opaque" },
  };
  const summary = { role: "compactionSummary", summary: NATIVE_CODEX_SUMMARY, timestamp: 1 };

  test("disk compaction request hooks read zero bodies on unrelated histories, including unsupported providers", async () => {
    const { manager } = await history();
    const opened = reopen(manager);
    const tracking = trackBodies();
    try {
      for (const selected of [model, { ...model, api: "anthropic-messages", provider: "anthropic" }]) {
        const h = compactionHarness(opened, selected as any);
        expect(h.hooks.get("context")({ messages: [] }, h.ctx)).toEqual({ messages: [] });
        h.hooks.get("before_provider_request")({ payload: { input: [] } }, h.ctx);
        expect(h.aborted).toBe(0);
      }
      expect(tracking.reads).toEqual([]);
    } finally {
      tracking.restore();
    }
  });

  test("disk compaction context reads its checkpoint once and provider hook verifies opaque replay", async () => {
    const { manager, first } = await history();
    const checkpoint = manager.appendCompaction(NATIVE_CODEX_SUMMARY, first, 10, details, true);
    const opened = reopen(manager);
    const h = compactionHarness(opened, { ...model, id: "compatible-model-switch" });
    const tracking = trackBodies();
    try {
      const result = h.hooks.get("context")({ messages: [summary] }, h.ctx);
      expect(result.messages[0].content[0].thinkingSignature).toBe(JSON.stringify(details.item));
      expect(result.messages[0].model).toBe("compatible-model-switch");
      expect(tracking.reads).toEqual([{ id: checkpoint, type: "compaction" }]);
      h.hooks.get("before_provider_request")({ payload: { input: [details.item] } }, h.ctx);
      expect(tracking.reads).toEqual(Array(2).fill({ id: checkpoint, type: "compaction" }));
      expect(() => h.hooks.get("before_provider_request")({ payload: { input: [] } }, h.ctx)).toThrow(
        "request lost native Codex checkpoint",
      );
      expect(tracking.reads.every((read) => read.id === checkpoint)).toBe(true);
      expect(h.aborted).toBe(1);
    } finally {
      tracking.restore();
    }
  });

  test("disk malformed and incompatible checkpoints block even on unsupported providers", async () => {
    for (const record of [details, { ...details, version: 999 }, { ...details, item: { type: "compaction" } }]) {
      const { manager, first } = await history();
      const checkpoint = manager.appendCompaction(NATIVE_CODEX_SUMMARY, first, 10, record, true);
      const h = compactionHarness(reopen(manager), {
        ...model,
        api: "anthropic-messages",
        provider: "anthropic",
      } as any);
      const tracking = trackBodies();
      try {
        expect(h.hooks.get("context")({ messages: [summary] }, h.ctx).messages).toEqual([summary]);
        expect(h.aborted).toBe(1);
        expect(tracking.reads).toEqual([{ id: checkpoint, type: "compaction" }]);
        expect(() => h.hooks.get("before_provider_request")({ payload: { input: [] } }, h.ctx)).toThrow(
          record === details ? "needs its own API/provider" : "damaged or unsupported",
        );
        expect(tracking.reads).toHaveLength(1);
      } finally {
        tracking.restore();
      }
    }
  });

  test("disk compaction selection preserves newest-only context, kept archived checkpoints, branches and reset", async () => {
    const { manager, first } = await history();
    const damaged = manager.appendCompaction(NATIVE_CODEX_SUMMARY, first, 10, { ...details, version: 999 }, true);
    const newest = manager.appendCompaction("plaintext newest", damaged, 10);
    const opened = reopen(manager);
    const h = compactionHarness(opened, { ...model, provider: "anthropic", api: "anthropic-messages" } as any);
    const tracking = trackBodies();
    try {
      h.hooks.get("context")({ messages: [] }, h.ctx);
      expect(h.aborted).toBe(0);
      expect(tracking.reads).toEqual([{ id: newest, type: "compaction" }]);
      tracking.reads.length = 0;
      opened.branch(first);
      h.hooks.get("context")({ messages: [] }, h.ctx);
      expect(tracking.reads).toEqual([]);
      opened.resetLeaf();
      h.hooks.get("context")({ messages: [] }, h.ctx);
      expect(tracking.reads).toEqual([]);
      opened.branch(damaged);
      h.hooks.get("context")({ messages: [summary] }, h.ctx);
      expect(h.aborted).toBe(1);
      expect(tracking.reads).toEqual([{ id: damaged, type: "compaction" }]);
    } finally {
      tracking.restore();
    }
  });

  function fastHarness(manager: SessionManager, appendFails = false) {
    let command: any;
    const hooks = new Map<string, any>();
    let dispatched = 0;
    let tier: string | undefined;
    const runtime = {
      isUsingOAuth: () => true,
      async prepareRequest(selected: any, options: any) {
        tier = options.serviceTier;
        return {
          model: selected,
          options,
          provider: {
            id: selected.provider,
            streamSimple: (_model: any, _context: any, opts: any) =>
              lazyStream(selected, async () => {
                await opts.onPayload({ model: selected.id, service_tier: opts.serviceTier }, selected);
                dispatched++;
                throw new Error("offline test dispatch");
              }),
          },
        };
      },
      streamSimple: (selected: any, _context: any, _options: any) =>
        lazyStream(selected, async () => {
          dispatched++;
          throw new Error("offline test dispatch");
        }),
    };
    const ctx: any = {
      model,
      mode: "tui",
      sessionManager: manager,
      modelRegistry: { runtime, isUsingOAuth: () => true },
      ui: { setStatus() {}, notify() {} },
    };
    registerNativeFastMode({
      registerFlag() {},
      getFlag() {
        return false;
      },
      registerCommand(_name: string, value: any) {
        command = value;
      },
      appendEntry(type: string, data: any) {
        if (appendFails) throw new Error("offline checkpoint");
        manager.appendCustomEntry(type, data);
      },
      on: (name: string, handler: any) => hooks.set(name, handler),
    } as any);
    hooks.get("session_start")({}, ctx);
    return {
      ctx,
      runtime,
      hooks,
      command,
      get tier() {
        return tier;
      },
      get dispatched() {
        return dispatched;
      },
      async request() {
        return runtime.streamSimple(model, { messages: [] }, { sessionId: ctx.sessionManager.getSessionId() }).result();
      },
      close() {
        hooks.get("session_shutdown")({}, ctx);
      },
    };
  }
  function fastSetting(manager: SessionManager) {
    return {
      version: 2,
      oauth: true,
      sessionId: manager.getSessionId(),
      provider: model.provider,
      model: model.id,
      enabled: true,
      costAcknowledged: true,
      timestamp: 1,
    };
  }

  test("disk fast capture reads zero bodies without settings", async () => {
    const { manager } = await history();
    const h = fastHarness(reopen(manager));
    const tracking = trackBodies();
    try {
      await h.request();
      expect(h.dispatched).toBe(1);
      expect(tracking.reads).toEqual([]);
    } finally {
      tracking.restore();
      h.close();
    }
  });

  test("disk fast capture reads settings across compaction but excludes off-branch markers and resets", async () => {
    const { manager, first } = await history();
    const setting = manager.appendCustomEntry(NATIVE_FAST_ENTRY, fastSetting(manager));
    const compact = manager.appendCompaction("plain checkpoint", setting, 10);
    manager.appendCustomEntry(NATIVE_FAST_ENTRY, { sessionId: null });
    manager.branch(compact);
    manager.appendLabelChange(first, "after compaction");
    const opened = reopen(manager);
    // Reopen selects the last saved leaf (label), whose parent is the good branch.
    const h = fastHarness(opened);
    const tracking = trackBodies();
    try {
      await h.request();
      expect(h.tier).toBe("priority");
      expect(h.dispatched).toBe(1);
      expect(tracking.reads).toEqual([{ id: setting, type: "custom" }]);
      tracking.reads.length = 0;
      opened.branch(first);
      await h.request();
      expect(tracking.reads).toEqual([]);
      opened.resetLeaf();
      await h.request();
      expect(tracking.reads).toEqual([]);
    } finally {
      tracking.restore();
      h.close();
    }
  });

  test("disk fast capture retains malformed identity, schema and cost validation and skips only well-formed other scopes", async () => {
    for (const kind of ["identity", "version", "cost", "other-scope"] as const) {
      const { manager } = await history();
      const valid = manager.appendCustomEntry(NATIVE_FAST_ENTRY, fastSetting(manager));
      const data = { ...fastSetting(manager) } as any;
      if (kind === "identity") data.model = null;
      if (kind === "version") data.version = 999;
      if (kind === "cost") data.costAcknowledged = false;
      if (kind === "other-scope") {
        data.model = "other-model";
        data.version = 999;
      }
      const marker = manager.appendCustomEntry(NATIVE_FAST_ENTRY, data);
      const h = fastHarness(reopen(manager));
      const tracking = trackBodies();
      try {
        const result = await h.request();
        // Read newest first. A malformed authoritative marker stops the scan;
        // only a well-formed other scope permits reading the older setting.
        expect(tracking.reads).toEqual(
          kind === "other-scope"
            ? [
                { id: marker, type: "custom" },
                { id: valid, type: "custom" },
              ]
            : [{ id: marker, type: "custom" }],
        );
        expect(h.dispatched).toBe(kind === "other-scope" ? 1 : 0);
        if (kind !== "other-scope") expect(result.errorMessage).toContain("approval is damaged or unsupported");
        else expect(h.tier).toBe("priority");
      } finally {
        tracking.restore();
        h.close();
      }
    }
  });

  test("disk request readers follow a switched store without retaining old checkpoint or settings", async () => {
    const old = await history();
    old.manager.appendCustomEntry(NATIVE_FAST_ENTRY, fastSetting(old.manager));
    old.manager.appendCompaction(NATIVE_CODEX_SUMMARY, old.first, 10, details, true);
    const fresh = await history();
    const opened = reopen(old.manager);
    const compaction = compactionHarness(opened);
    const fast = fastHarness(opened);
    opened.setSessionFile(fresh.manager.getSessionFile()!);
    const tracking = trackBodies();
    try {
      compaction.hooks.get("context")({ messages: [] }, compaction.ctx);
      compaction.hooks.get("before_provider_request")({ payload: { input: [] } }, compaction.ctx);
      await fast.request();
      expect(compaction.aborted).toBe(0);
      expect(fast.dispatched).toBe(1);
      expect(fast.tier).toBeUndefined();
      expect(tracking.reads).toEqual([]);
    } finally {
      tracking.restore();
      fast.close();
    }
  });

  test("disk fast volatile opt-out still overrides persisted premium settings without reading bodies", async () => {
    const { manager } = await history();
    manager.appendCustomEntry(NATIVE_FAST_ENTRY, fastSetting(manager));
    const h = fastHarness(reopen(manager), true);
    await h.command.handler("off", h.ctx);
    const tracking = trackBodies();
    try {
      await h.request();
      expect(h.tier).toBe("default");
      expect(h.dispatched).toBe(1);
      expect(tracking.reads).toEqual([]);
    } finally {
      tracking.restore();
      h.close();
    }
  });
}
