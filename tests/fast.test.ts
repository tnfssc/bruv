import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { readConfig, saveConfig } from "../src/config";
import { registerFast } from "../src/fast";
import { sdk } from "./sdk";

test("fast saves its default and confirmation, covers every Codex model, and preserves other settings", async () => {
  mkdirSync(".tmp", { recursive: true });
  const dir = mkdtempSync(resolve(".tmp/fast-"));
  const previous = process.env.BRUV_FAST;
  delete process.env.BRUV_FAST;
  let confirms = 0;
  let accepted = false;
  let isFast = () => false;
  let status: string | undefined;
  saveConfig({ profiles: { normal: { thinking: "high" } } }, dir);
  const make = () =>
    sdk(
      [
        (pi) => {
          isFast = registerFast(pi, dir);
        },
      ],
      {
        confirm: async () => {
          confirms++;
          return accepted;
        },
        setStatus: (_key, text) => {
          status = text;
        },
      },
    );
  const app = await make();
  try {
    await app.session.prompt("/fast on");
    expect(isFast()).toBe(false);
    expect(confirms).toBe(0);
    // The public registry includes the installed openai-codex model catalog.
    const models = app.session.extensionRunner
      .createContext()
      .modelRegistry.getAll()
      .filter((model) => model.provider === "openai-codex");
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((model) => model.api === "openai-codex-responses")).toBe(true);
    for (const model of [...models, { ...app.faux.getModel(), id: "responses", api: "openai-responses" }]) {
      await app.session.setModel({ ...model, provider: app.faux.getModel().provider });
      await app.session.prompt("/fast on");
      if (!accepted) {
        expect(isFast()).toBe(false);
        expect(readConfig(dir).fastConfirmed).toBeUndefined();
        accepted = true;
        await app.session.prompt("/fast on");
      }
      expect(isFast()).toBe(true);
      expect(status).toBe("fast");
      expect(await app.session.extensionRunner.emitBeforeProviderRequest({ input: [] })).toMatchObject({
        service_tier: "priority",
      });
      await app.session.prompt("/fast off");
      expect(readConfig(dir).fast).toBe(false);
      expect(await app.session.extensionRunner.emitBeforeProviderRequest({ input: [] })).toEqual({ input: [] });
    }
    expect(confirms).toBe(2);
    await app.session.prompt("/fast on");
    expect(readConfig(dir)).toEqual({ fast: true, fastConfirmed: true, profiles: { normal: { thinking: "high" } } });
    await app.session.setModel(app.faux.getModel());
    expect(isFast()).toBe(false);
    expect(status).toBeUndefined();
    expect(readConfig(dir).fast).toBe(true);
    expect(await app.session.extensionRunner.emitBeforeProviderRequest({ input: [] })).toEqual({ input: [] });
    const resumed = await make();
    try {
      await resumed.session.setModel({ ...models[0], provider: resumed.faux.getModel().provider });
      expect(isFast()).toBe(true);
      await resumed.session.prompt("/fast");
      expect(readConfig(dir).fast).toBe(false);
      await resumed.session.prompt("/fast on");
      expect(confirms).toBe(2);
    } finally {
      await resumed.close();
    }
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.BRUV_FAST;
    else process.env.BRUV_FAST = previous;
  }
});

test("child fast starts on without a dialog and its saved off setting survives reload", async () => {
  mkdirSync(".tmp", { recursive: true });
  const dir = mkdtempSync(resolve(".tmp/fast-child-"));
  const previous = process.env.BRUV_FAST;
  process.env.BRUV_FAST = "1";
  let confirms = 0;
  let isFast = () => false;
  const app = await sdk(
    [
      (pi) => {
        isFast = registerFast(pi, dir);
      },
    ],
    {
      confirm: async () => {
        confirms++;
        return false;
      },
    },
  );
  try {
    await app.session.setModel({ ...app.faux.getModel(), id: "codex-child", api: "openai-codex-responses" });
    expect(isFast()).toBe(true);
    expect(confirms).toBe(0);
    await app.session.prompt("/fast off");
    await app.session.extensionRunner.emit({ type: "session_start", reason: "reload" });
    expect(isFast()).toBe(false);
    expect(readConfig(dir)).toMatchObject({ fast: false, fastConfirmed: true });
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.BRUV_FAST;
    else process.env.BRUV_FAST = previous;
  }
});

test("fast replies Pi priced at the base rate are priced at the priority tier once", async () => {
  mkdirSync(".tmp", { recursive: true });
  const dir = mkdtempSync(resolve(".tmp/fast-cost-"));
  const previous = process.env.BRUV_FAST;
  process.env.BRUV_FAST = "1";
  const app = await sdk([(pi) => void registerFast(pi, dir)]);
  try {
    const cost = { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 };
    const model = { ...app.faux.getModel(), id: "codex-cost", api: "openai-codex-responses", cost } as const;
    await app.session.setModel(model);
    const reply = (total: number) =>
      ({
        ...fauxAssistantMessage("done"),
        model: model.id,
        usage: {
          input: 1_000_000,
          output: 1_000_000,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2_000_000,
          cost: { input: total / 3, output: (total * 2) / 3, cacheRead: 0, cacheWrite: 0, total },
        },
      }) as const;
    const runner = app.session.extensionRunner;
    await runner.emitBeforeProviderRequest({ input: [] });
    const base = await runner.emitMessageEnd({ type: "message_end", message: reply(3) });
    expect(base?.role === "assistant" && base.usage.cost.total).toBe(6);
    expect(await runner.emitMessageEnd({ type: "message_end", message: reply(6) })).toBeUndefined();
    await app.session.prompt("/fast off");
    await runner.emitBeforeProviderRequest({ input: [] });
    expect(await runner.emitMessageEnd({ type: "message_end", message: reply(3) })).toBeUndefined();
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.BRUV_FAST;
    else process.env.BRUV_FAST = previous;
  }
});
