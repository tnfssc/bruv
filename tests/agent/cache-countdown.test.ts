import { describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  CACHE_CALL_ENTRY,
  CacheCountdown,
  DEFAULT_CACHE_TTL_MS,
  loadCacheSettings,
  parseCacheSettings,
  parseCacheTtl,
  registerCacheCountdown,
} from "../../src/agent/cache-countdown";
import { reportProviderAttempt, subscribeProviderAttempts } from "../../src/agent/provider-attempts";
import { inspectDiagnostics } from "../../src/diagnostics";

function context(provider = "openai", id = "alpha", entries: any[] = []) {
  return {
    model: { provider, id },
    sessionManager: { getEntries: () => entries },
    ui: { notify() {} },
  } as unknown as ExtensionContext;
}

// Capture the real extension registration; scenarios invoke its shipped hooks directly.
function captureCacheExtension(
  countdown = new CacheCountdown(),
  path = join(tmpdir(), "missing-cache-settings-" + crypto.randomUUID()),
) {
  const handlers: Record<string, (event: any, ctx: ExtensionContext) => void | Promise<void>> = {};
  const commands: Record<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }> = {};
  const appended: Array<{ type: string; data: { timestamp: number; provider: string; model: string } }> = [];
  const pi = {
    on: (name: string, handler: (event: any, ctx: ExtensionContext) => void | Promise<void>) => {
      handlers[name] = handler;
    },
    registerCommand: (name: string, command: (typeof commands)[string]) => {
      commands[name] = command;
    },
    appendEntry: (type: string, data: (typeof appended)[number]["data"]) => appended.push({ type, data }),
  } as unknown as ExtensionAPI;
  registerCacheCountdown(pi, countdown, path);
  return { handlers, commands, appended };
}

const discardEntries = { appendEntry() {} } as unknown as ExtensionAPI;

describe("cache countdown estimates and replay", () => {
  test("is per-agent/model, coarse, warning-colored state, expired, and unknown", () => {
    let now = 1_000_000;
    const a = new CacheCountdown(() => now);
    const b = new CacheCountdown(() => now);
    const ctx = context();
    expect(a.estimate(ctx)).toEqual({ state: "unknown", text: "cache est ?" });
    a.record(discardEntries, ctx.model!);
    expect(a.estimate(ctx)).toMatchObject({ state: "active", text: "cache est 60m" });
    now += 45 * 60_000;
    expect(a.estimate(ctx)).toMatchObject({ state: "warning", text: "cache est 15m" });
    now += 10 * 60_000;
    expect(a.estimate(ctx)).toMatchObject({ state: "urgent", text: "cache est 5m" });
    now += 5 * 60_000;
    expect(a.estimate(ctx)).toEqual({ state: "expired", text: "cache est expired" });
    expect(b.estimate(ctx).state).toBe("unknown");
    expect(a.estimate(context("openai", "beta")).state).toBe("unknown");
  });

  test("restores durable exact-model calls without allowing descendant resets", () => {
    const parent = new CacheCountdown(() => 9000);
    const entries = [
      { type: "custom", customType: CACHE_CALL_ENTRY, data: { timestamp: 1000, provider: "p", model: "m" } },
    ];
    parent.restore(context("p", "m", entries));
    const child = new CacheCountdown(() => 9000);
    child.record(discardEntries, context("p", "m").model!, 8000);
    expect(parent.estimate(context("p", "m"), 9000).text).toBe("cache est 60m");
    expect(child.estimate(context("p", "m"), 9000).text).toBe("cache est 60m");
    expect(parent.estimate(context("p", "other"), 9000).state).toBe("unknown");
    // At the next minute boundary the independent timestamps become visible.
    expect(parent.estimate(context("p", "m"), 61000).text).toBe("cache est 59m");
    expect(child.estimate(context("p", "m"), 61000).text).toBe("cache est 60m");
  });

  test("a branch-local shake invalidates only earlier cache observations", () => {
    const countdown = new CacheCountdown(() => 3000);
    countdown.restore(
      context("p", "m", [
        { type: "custom", customType: CACHE_CALL_ENTRY, data: { timestamp: 1000, provider: "p", model: "m" } },
        { type: "custom", customType: "bruv-manual-shake", data: {} },
      ]),
    );
    expect(countdown.estimate(context("p", "m"), 3000).state).toBe("unknown");
    countdown.restore(
      context("p", "m", [
        { type: "custom", customType: "bruv-manual-shake", data: {} },
        { type: "custom", customType: CACHE_CALL_ENTRY, data: { timestamp: 2000, provider: "p", model: "m" } },
      ]),
    );
    expect(countdown.estimate(context("p", "m"), 3000).state).toBe("active");
  });

  test("replays the selected branch rather than calls from other branches", () => {
    const countdown = new CacheCountdown(() => 61000);
    const ctx = context("p", "m", [
      { type: "custom", customType: CACHE_CALL_ENTRY, data: { timestamp: 61000, provider: "p", model: "m" } },
    ]);
    ctx.sessionManager.getBranch = () =>
      [
        { type: "custom", customType: CACHE_CALL_ENTRY, data: { timestamp: 1000, provider: "p", model: "m" } },
      ] as ReturnType<typeof ctx.sessionManager.getBranch>;
    countdown.restore(ctx);
    expect(countdown.estimate(ctx).text).toBe("cache est 59m");
  });

  test("append failure leaves both the old model and the failed model estimates unchanged", () => {
    const countdown = new CacheCountdown(() => 2000);
    countdown.record(discardEntries, { provider: "p", id: "stable" }, 1000);
    expect(() =>
      countdown.record(
        {
          appendEntry() {
            throw new Error("disk full");
          },
        } as unknown as ExtensionAPI,
        { provider: "p", id: "drift" },
        1500,
      ),
    ).toThrow("disk full");
    expect(countdown.estimate(context("p", "stable"), 2000).state).toBe("active");
    expect(countdown.estimate(context("p", "drift"), 2000).state).toBe("unknown");
  });
});

describe("cache request evidence", () => {
  test("records native responses and retries, but not dispatch or rejected HTTP responses", async () => {
    const { handlers, appended } = captureCacheExtension(new CacheCountdown(() => 123456));
    const ctx = context();
    await handlers.session_start({}, ctx);
    reportProviderAttempt(ctx.sessionManager, ctx.model!, "dispatch", 123455);
    handlers.before_provider_request({}, ctx);
    handlers.after_provider_response({ status: 401, model: { provider: "openai", id: "alpha" } }, ctx);
    expect(appended).toHaveLength(0);
    reportProviderAttempt(ctx.sessionManager, ctx.model!, "response", 123456);
    reportProviderAttempt(ctx.sessionManager, ctx.model!, "response", 123457); // response-backed retry
    expect(appended).toHaveLength(2);
    expect(appended[0].type).toBe(CACHE_CALL_ENTRY);
    expect(appended.map((entry) => entry.data.timestamp)).toEqual([123456, 123457]);
  });

  test("model-less SDK responses use the sole request snapshot and reject unsuccessful statuses", async () => {
    const { handlers, appended } = captureCacheExtension();
    const ctx = context("p", "actual");
    await handlers.session_start({}, ctx);
    for (const status of [401, 429, 500]) {
      handlers.before_provider_request({ payload: {} }, ctx);
      ctx.model = { ...ctx.model!, id: "selected-later" };
      handlers.after_provider_response({ status, headers: {} }, ctx);
      ctx.model = { ...ctx.model!, id: "actual" };
    }
    expect(appended).toHaveLength(0);
    handlers.before_provider_request({ payload: {} }, ctx);
    ctx.model = { ...ctx.model!, id: "selected-later" };
    handlers.after_provider_response({ status: 200, headers: {} }, ctx);
    ctx.model = { ...ctx.model!, id: "actual-ws" };
    handlers.before_provider_request({ payload: {} }, ctx);
    ctx.model = { ...ctx.model!, id: "selected-after-dispatch" };
    handlers.message_end(
      { message: { role: "assistant", provider: "p", model: "actual-ws", stopReason: "stop" } },
      ctx,
    );
    handlers.message_end(
      { message: { role: "assistant", provider: "p", model: "duplicate", stopReason: "stop" } },
      ctx,
    );
    expect(appended.map((entry) => entry.data.model)).toEqual(["actual", "actual-ws"]);
  });

  test("correlates distinguishable HTTP responses even when they finish out of order", async () => {
    const { handlers, appended } = captureCacheExtension();
    const ctx = context("p", "one");
    await handlers.session_start({}, ctx);
    handlers.before_provider_request({}, ctx);
    ctx.model = { ...ctx.model!, id: "two" };
    handlers.before_provider_request({}, ctx);
    handlers.after_provider_response({ status: 200, model: { provider: "p", id: "two" } }, ctx);
    handlers.after_provider_response({ status: 200, model: { provider: "p", id: "one" } }, ctx);
    expect(appended.map((entry) => entry.data.model)).toEqual(["two", "one"]);
  });

  test("an HTTP terminal event pays its own debt without consuming another model's request", async () => {
    const { handlers, appended } = captureCacheExtension();
    const ctx = context("p", "http-a");
    await handlers.session_start({}, ctx);
    handlers.before_provider_request({}, ctx);
    ctx.model = { ...ctx.model!, id: "ws-b" };
    handlers.before_provider_request({}, ctx);
    handlers.after_provider_response({ status: 200, model: { provider: "p", id: "http-a" } }, ctx);
    handlers.message_end({ message: { role: "assistant", provider: "p", model: "http-a", stopReason: "stop" } }, ctx);
    handlers.message_end({ message: { role: "assistant", provider: "p", model: "ws-b", stopReason: "stop" } }, ctx);
    expect(appended.map((entry) => entry.data.model)).toEqual(["http-a", "ws-b"]);
  });

  test("HTTP terminal debt blocks a newly overlapping request for the same model", async () => {
    const { handlers, appended } = captureCacheExtension();
    const ctx = context("p", "overlap");
    await handlers.session_start({}, ctx);
    handlers.before_provider_request({}, ctx);
    handlers.after_provider_response({ status: 200, model: { provider: "p", id: "overlap" } }, ctx);
    handlers.before_provider_request({}, ctx);
    handlers.message_end({ message: { role: "assistant", provider: "p", model: "overlap", stopReason: "stop" } }, ctx);
    handlers.message_end({ message: { role: "assistant", provider: "p", model: "overlap", stopReason: "stop" } }, ctx);
    expect(appended.map((entry) => entry.data.model)).toEqual(["overlap"]);
  });

  test("a model-less SDK response blocks all ambiguous snapshots, including their later endings", async () => {
    const { handlers, appended } = captureCacheExtension();
    const ctx = context("p", "missing-a");
    await handlers.session_start({}, ctx);
    handlers.before_provider_request({}, ctx);
    ctx.model = { ...ctx.model!, id: "missing-b" };
    handlers.before_provider_request({}, ctx);
    // The shipped SDK response carries status and headers only, not model identity.
    handlers.after_provider_response({ status: 200, headers: {} }, ctx);
    handlers.message_end(
      { message: { role: "assistant", provider: "p", model: "missing-a", stopReason: "stop" } },
      ctx,
    );
    handlers.message_end(
      { message: { role: "assistant", provider: "p", model: "missing-b", stopReason: "stop" } },
      ctx,
    );
    expect(appended).toHaveLength(0);
  });

  test("failed assistant endings consume the request without recording an observation", async () => {
    const { handlers, appended } = captureCacheExtension();
    const ctx = context("p", "m");
    await handlers.session_start({}, ctx);
    for (const stopReason of ["error", "aborted"]) {
      handlers.before_provider_request({}, ctx);
      handlers.message_end({ message: { role: "assistant", provider: "p", model: "m", stopReason } }, ctx);
      handlers.message_end({ message: { role: "assistant", provider: "p", model: "m", stopReason: "stop" } }, ctx);
      expect(appended).toHaveLength(0);
    }
  });

  test("stream endings use request-start time, while HTTP observations use response time", async () => {
    const { handlers, appended } = captureCacheExtension();
    const ctx = context("p", "stream");
    await handlers.session_start({}, ctx);
    const clock = spyOn(Date, "now").mockReturnValue(1000);
    try {
      handlers.before_provider_request({}, ctx);
      clock.mockReturnValue(40000);
      handlers.message_end({ message: { role: "assistant", provider: "p", model: "stream", stopReason: "stop" } }, ctx);
      ctx.model = { ...ctx.model!, id: "http" };
      handlers.before_provider_request({}, ctx);
      clock.mockReturnValue(50000);
      handlers.after_provider_response({ status: 200, headers: {} }, ctx);
      expect(appended.map((entry) => entry.data)).toEqual([
        { timestamp: 1000, provider: "p", model: "stream" },
        { timestamp: 50000, provider: "p", model: "http" },
      ]);
    } finally {
      clock.mockRestore();
    }
  });

  test("session replacement clears request evidence and owns exactly one provider subscription", async () => {
    const countdown = new CacheCountdown();
    const { handlers, appended } = captureCacheExtension(countdown);
    const first = context("p", "same-model");
    const second = context("p", "same-model");
    await handlers.session_start({}, first);
    handlers.before_provider_request({}, first);
    handlers.after_provider_response({ status: 200 }, first);
    handlers.before_provider_request({}, context("p", "unfinished"));
    expect(appended).toHaveLength(1);

    await handlers.session_start({}, second);
    expect(countdown.estimate(second).state).toBe("unknown");
    reportProviderAttempt(first.sessionManager, first.model!, "response");
    handlers.message_end(
      { message: { role: "assistant", provider: "p", model: "unfinished", stopReason: "stop" } },
      second,
    );
    expect(appended).toHaveLength(1);
    // The first session's HTTP-terminal debt must not block this new request.
    handlers.before_provider_request({}, second);
    handlers.message_end(
      { message: { role: "assistant", provider: "p", model: "same-model", stopReason: "stop" } },
      second,
    );
    expect(appended).toHaveLength(2);

    // Starting again with the same manager must replace, not duplicate, the subscription.
    await handlers.session_start({}, second);
    reportProviderAttempt(second.sessionManager, second.model!, "dispatch");
    expect(appended).toHaveLength(2);
    reportProviderAttempt(second.sessionManager, second.model!, "response");
    expect(appended).toHaveLength(3);

    handlers.before_provider_request({}, second);
    handlers.session_shutdown({}, second);
    handlers.message_end(
      { message: { role: "assistant", provider: "p", model: "same-model", stopReason: "stop" } },
      second,
    );
    reportProviderAttempt(second.sessionManager, second.model!, "response");
    expect(appended).toHaveLength(3);
  });
});

describe("cache settings", () => {
  test("validates durations and strict persisted settings", () => {
    expect(parseCacheTtl("30m")).toBe(1_800_000);
    expect(parseCacheTtl("1h")).toBe(DEFAULT_CACHE_TTL_MS);
    expect(parseCacheTtl("1.5h")).toBe(5_400_000);
    expect(parseCacheTtl("2")).toBe(120_000);
    for (const bad of ["", "zero", "0m", "8d", "1.001m"]) expect(() => parseCacheTtl(bad)).toThrow();
    expect(() => parseCacheSettings({ cacheTtlMs: 60000, extra: true })).toThrow("unknown setting");
  });

  test("the public command persists separately from unrelated user settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-cache-"));
    const path = join(dir, "cache-settings.json");
    const userPath = join(dir, "settings.json");
    try {
      await writeFile(userPath, JSON.stringify({ theme: "custom", unrelated: { keep: true } }));
      const { handlers, commands } = captureCacheExtension(new CacheCountdown(), path);
      const ctx = context();
      let note = "";
      let kind = "";
      ctx.ui.notify = (message, k) => {
        note = message;
        kind = k!;
      };
      await handlers.session_start({}, ctx);
      expect(Object.keys(commands)).toEqual(["cache-ttl"]);
      await commands["cache-ttl"].handler("90m", ctx);
      expect(kind).toBe("info");
      expect(note).toContain("does not guarantee");
      expect((await loadCacheSettings(path)).ttlMs).toBe(5_400_000);
      await commands["cache-ttl"].handler("nonsense", ctx);
      expect(kind).toBe("error");
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ cacheTtlMs: 5_400_000 });
      expect(JSON.parse(await readFile(userPath, "utf8"))).toEqual({ theme: "custom", unrelated: { keep: true } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("warns about corrupt cache settings without changing them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-cache-corrupt-"));
    const path = join(dir, "cache-settings.json");
    try {
      const corrupt = "{ definitely not json";
      await writeFile(path, corrupt);
      const { handlers } = captureCacheExtension(new CacheCountdown(), path);
      const ctx = context();
      let warning = "";
      let kind = "";
      ctx.ui.notify = (message, k) => {
        warning = message;
        kind = k!;
      };
      await handlers.session_start({}, ctx);
      expect(kind).toBe("warning");
      expect(warning).toContain("left unchanged");
      expect(await readFile(path, "utf8")).toBe(corrupt);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("provider observation isolation", () => {
  test("attempt IDs are unique and observer diagnostics contain no private failure data", () => {
    const owner = {};
    const ids: string[] = [];
    subscribeProviderAttempts(owner, (event) => ids.push(event.operationId));
    subscribeProviderAttempts(owner, () => {
      throw new Error("secret payload and credential");
    });
    reportProviderAttempt(owner, { provider: "p", id: "m" }, "dispatch", 1);
    reportProviderAttempt(owner, { provider: "p", id: "m" }, "dispatch", 2);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const records = inspectDiagnostics(owner).records;
    expect(records.filter((record) => record.code === "observer_failed")).toHaveLength(2);
    expect(JSON.stringify(records)).not.toContain("secret");
    expect(
      records.every(
        (record) => !Object.keys(record).some((key) => ["error", "payload", "headers", "usage"].includes(key)),
      ),
    ).toBe(true);
  });

  test("a failed optional observer neither throws nor prevents the next observer's delivery", () => {
    const owner = {};
    let observed = "";
    subscribeProviderAttempts(owner, () => {
      throw new Error("broken optional telemetry");
    });
    subscribeProviderAttempts(owner, (event) => {
      observed = event.model.id;
    });
    expect(() => reportProviderAttempt(owner, { provider: "p", id: "native" }, "dispatch", 1000)).not.toThrow();
    expect(observed).toBe("native");
  });
});
