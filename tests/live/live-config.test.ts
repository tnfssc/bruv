import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLiveConfig, parseLiveConfig, saveLiveConfig } from "../../src/live/config";

describe("Live voice settings (offline)", () => {
  test("missing file defaults Google; saved choice survives reload without a key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-live-config-"));
    const path = join(dir, "live-settings.json");
    try {
      const initial = await loadLiveConfig(path);
      expect(initial).toEqual({ provider: "google", model: "gemini-3.8-live", inputMode: "push-to-talk" });
      const chosen = {
        provider: "openai" as const,
        model: "gpt-realtime-2.1-mini" as const,
        inputMode: "push-to-talk" as const,
      };
      await saveLiveConfig(chosen, path);
      expect(await loadLiveConfig(path)).toEqual(chosen);
      expect(await readFile(path, "utf8")).not.toContain("apiKey");
      const thinking = {
        provider: "google" as const,
        model: "gemini-3.8-live-extended-thinking" as const,
        inputMode: "continuous" as const,
      };
      await saveLiveConfig(thinking, path);
      expect(await loadLiveConfig(path)).toEqual(thinking);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("GPT-Live selection persists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bruv-gpt-live-config-"));
    const path = join(dir, "live-settings.json");
    const chosen = { provider: "openai" as const, model: "gpt-live-1" as const, inputMode: "continuous" as const };
    try {
      await saveLiveConfig(chosen, path);
      expect(await loadLiveConfig(path)).toEqual(chosen);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("obsolete provider memories are ignored without changing the active choice", () => {
    expect(
      parseLiveConfig({
        provider: "google",
        model: "gemini-3.8-live",
        openaiModel: "invented",
        googleModel: "invented",
      }),
    ).toEqual({ provider: "google", model: "gemini-3.8-live", inputMode: "push-to-talk" });
  });
  test("missing mode is muted by default; invalid modes never fall back", () => {
    expect(parseLiveConfig({ provider: "google", model: "gemini-3.8-live" }).inputMode).toBe("push-to-talk");
    expect(() => parseLiveConfig({ provider: "google", model: "gemini-3.8-live", inputMode: "automatic" })).toThrow(
      "input mode",
    );
  });
  test("rejects mismatched and invented models instead of fallback", () => {
    for (const config of [
      { provider: "google", model: "gpt-live-1" },
      { provider: "openai", model: "gemini-3.8-live" },
      { provider: "openai", model: "gpt-realtime-2.1-unknown" },
      { provider: "openai", model: "gemini-3.8-live-extended-thinking" },
    ])
      expect(() => parseLiveConfig(config)).toThrow();
    expect(parseLiveConfig({ provider: "openai", model: "gpt-realtime-2.1-mini" })).toEqual({
      provider: "openai",
      model: "gpt-realtime-2.1-mini",
      inputMode: "push-to-talk",
    });
  });
});
