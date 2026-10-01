import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SettingsManager,
  type ExtensionAPI,
  type ExtensionContext,
  type ModelSelectEvent,
  type ThinkingLevelSelectEvent,
} from "@earendil-works/pi-coding-agent";
import {
  isExplicitRootCliModelSelection,
  registerLastUsedCliModel,
  type ModelDefaultSettings,
} from "../src/agent/last-used-cli-model";

function event(source: ModelSelectEvent["source"] = "set"): ModelSelectEvent {
  return {
    type: "model_select",
    source,
    model: { provider: "anthropic", id: "claude-test" } as ModelSelectEvent["model"],
    previousModel: undefined,
  };
}

function context(mode: ExtensionContext["mode"] = "tui"): ExtensionContext {
  return {
    mode,
    cwd: "/project",
    ui: { notify() {} },
  } as unknown as ExtensionContext;
}

describe("last-used CLI model", () => {
  test("recognizes only direct root TUI selections", () => {
    expect(isExplicitRootCliModelSelection(event("set"), context("tui"), true)).toBe(true);
    expect(isExplicitRootCliModelSelection(event("restore"), context("tui"), true)).toBe(false);
    expect(isExplicitRootCliModelSelection(event("cycle"), context("tui"), true)).toBe(true);
    expect(isExplicitRootCliModelSelection(event("set"), context("print"), true)).toBe(false);
    expect(isExplicitRootCliModelSelection(event("set"), context("json"), true)).toBe(false);
    expect(isExplicitRootCliModelSelection(event("set"), context("rpc"), true)).toBe(false);
    expect(isExplicitRootCliModelSelection(event("set"), context("tui"), false)).toBe(false);
  });

  test("persists provider and model after an explicit /model choice", async () => {
    let handler: ((event: ModelSelectEvent, ctx: ExtensionContext) => Promise<void>) | undefined;
    const pi = {
      on(name: string, candidate: typeof handler) {
        if (name === "model_select") handler = candidate;
      },
    } as unknown as ExtensionAPI;
    const writes: string[] = [];
    const settings: ModelDefaultSettings = {
      setDefaultModelAndProvider(provider, modelId) {
        writes.push(`${provider}/${modelId}`);
      },
      setDefaultThinkingLevel() {
        throw new Error("model choices must not rewrite thinking defaults");
      },
      async flush() {},
      drainErrors: () => [],
    };

    registerLastUsedCliModel(
      pi,
      () => true,
      (cwd) => {
        expect(cwd).toBe("/project");
        return settings;
      },
    );
    await handler!(event(), context());
    await handler!(event("cycle"), context());
    expect(writes).toEqual(["anthropic/claude-test", "anthropic/claude-test"]);
  });

  test("automatic restores, command overrides, and children do not overwrite defaults", async () => {
    let handler: ((event: ModelSelectEvent, ctx: ExtensionContext) => Promise<void>) | undefined;
    const pi = {
      on: (name: string, candidate: typeof handler) => {
        if (name === "model_select") handler = candidate;
      },
    } as unknown as ExtensionAPI;
    let root = true;
    let creates = 0;
    registerLastUsedCliModel(
      pi,
      () => root,
      () => {
        creates++;
        throw new Error("settings should not be opened");
      },
    );

    await handler!(event("restore"), context());
    await handler!(event("set"), context("print")); // e.g. an explicit --model noninteractive run
    root = false;
    await handler!(event("set"), context("tui"));
    expect(creates).toBe(0);
  });
});

test("saved choice survives a fresh settings instance without changing unrelated settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-model-default-"));
  try {
    const cwd = join(dir, "project");
    const agentDir = join(dir, "agent");
    await mkdir(cwd);
    await mkdir(agentDir);
    await Bun.write(
      join(agentDir, "settings.json"),
      JSON.stringify({
        defaultProvider: "old",
        defaultModel: "old-model",
        defaultThinkingLevel: "low",
        theme: "light",
      }),
    );
    let handler: ((event: ModelSelectEvent, ctx: ExtensionContext) => Promise<void>) | undefined;
    const pi = {
      on: (name: string, candidate: typeof handler) => {
        if (name === "model_select") handler = candidate;
      },
    } as unknown as ExtensionAPI;
    registerLastUsedCliModel(
      pi,
      () => true,
      () => SettingsManager.create(cwd, agentDir),
    );
    await handler!(event(), context());
    const fresh = SettingsManager.create(cwd, agentDir);
    expect(fresh.getDefaultProvider()).toBe("anthropic");
    expect(fresh.getDefaultModel()).toBe("claude-test");
    expect(fresh.getDefaultThinkingLevel()).toBe("low");
    expect((await Bun.file(join(agentDir, "settings.json")).json()).theme).toBe("light");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function thinkingEvent(level: ThinkingLevelSelectEvent["level"] = "high"): ThinkingLevelSelectEvent {
  return { type: "thinking_level_select", level, previousLevel: "medium" };
}

test("thinking picker and cycle choices survive new sessions, including off", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-thinking-default-"));
  try {
    const cwd = join(dir, "project");
    const agentDir = join(dir, "agent");
    await mkdir(cwd);
    await mkdir(agentDir);
    await Bun.write(
      join(agentDir, "settings.json"),
      JSON.stringify({
        defaultProvider: "anthropic",
        defaultModel: "claude-test",
        defaultThinkingLevel: "medium",
        theme: "light",
      }),
    );
    let handler: ((event: ThinkingLevelSelectEvent, ctx: ExtensionContext) => Promise<void>) | undefined;
    const pi = {
      on(name: string, candidate: typeof handler) {
        if (name === "thinking_level_select") handler = candidate;
      },
    } as unknown as ExtensionAPI;
    registerLastUsedCliModel(
      pi,
      () => true,
      () => SettingsManager.create(cwd, agentDir),
    );
    for (const level of ["high", "off"] as const) {
      await handler!(thinkingEvent(level), context());
      const fresh = SettingsManager.create(cwd, agentDir);
      expect(fresh.getDefaultThinkingLevel()).toBe(level);
      expect(fresh.getDefaultProvider()).toBe("anthropic");
      expect(fresh.getDefaultModel()).toBe("claude-test");
      expect((await Bun.file(join(agentDir, "settings.json")).json()).theme).toBe("light");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("thinking events in automation and child sessions do not overwrite defaults", async () => {
  let handler: ((event: ThinkingLevelSelectEvent, ctx: ExtensionContext) => Promise<void>) | undefined;
  const pi = {
    on(name: string, candidate: typeof handler) {
      if (name === "thinking_level_select") handler = candidate;
    },
  } as unknown as ExtensionAPI;
  let root = true;
  let creates = 0;
  registerLastUsedCliModel(
    pi,
    () => root,
    () => {
      creates++;
      throw new Error("settings should not be opened");
    },
  );
  for (const mode of ["print", "json", "rpc"] as const) await handler!(thinkingEvent(), context(mode));
  root = false;
  await handler!(thinkingEvent(), context());
  expect(creates).toBe(0);
});

test("thinking persistence failures notify the user", async () => {
  let handler: ((event: ThinkingLevelSelectEvent, ctx: ExtensionContext) => Promise<void>) | undefined;
  const pi = {
    on(name: string, candidate: typeof handler) {
      if (name === "thinking_level_select") handler = candidate;
    },
  } as unknown as ExtensionAPI;
  let flushed = false;
  registerLastUsedCliModel(
    pi,
    () => true,
    () => ({
      setDefaultModelAndProvider() {},
      setDefaultThinkingLevel(level) {
        expect(level).toBe("high");
      },
      async flush() {
        flushed = true;
      },
      drainErrors() {
        expect(flushed).toBe(true);
        return [{ error: new Error("write failed") }];
      },
    }),
  );
  const notifications: string[] = [];
  const ctx = context();
  ctx.ui.notify = (message, kind) => {
    expect(kind).toBe("warning");
    notifications.push(message);
  };
  await handler!(thinkingEvent(), ctx);
  expect(notifications).toEqual(["Could not save default thinking level: write failed"]);
});
