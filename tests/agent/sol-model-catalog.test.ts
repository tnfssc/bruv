import { describe, expect, test } from "bun:test";
import { AuthStorage } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";
import { ModelRegistry, ModelRuntime, ModelSelectorComponent, initTheme } from "@earendil-works/pi-coding-agent";

// Offline only: bundled upstream catalog, isolated config, and a nonfunctional runtime key.
// This checks what Bruv's Pi-backed registry and interactive picker actually consume;
// it does not prove account access or make a model request.
describe("bundled GPT-6.1 Sol models", () => {
  test("registry retains upstream IDs, provider APIs, capabilities and prices", async () => {
    const runtime = await ModelRuntime.create({
      credentials: AuthStorage.inMemory(),
      modelsPath: null,
      allowModelNetwork: false,
    });
    const registry = new ModelRegistry(runtime);
    for (const [provider, api, baseUrl, minimal] of [
      ["openai", "openai-responses", "https://api.openai.com/v1", null],
      ["openai-codex", "openai-codex-responses", "https://chatgpt.com/backend-api", "low"],
    ] as const) {
      const model = registry.find(provider, "gpt-6.1-sol");
      expect(model).toBeDefined();
      expect(registry.getAll().find((entry) => entry.provider === provider && entry.id === model?.id)).toBe(model);
      expect(model).toMatchObject({
        id: "gpt-6.1-sol",
        name: "GPT-6.1 Sol",
        provider,
        api,
        baseUrl,
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 272000,
        maxTokens: 128000,
        cost: {
          input: 2,
          output: 10,
          cacheRead: 0.1,
          cacheWrite: 2.5,
          tiers: [{ inputTokensAbove: 272000, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 }],
        },
        thinkingLevelMap: {
          off: null,
          minimal,
          low: "low",
          medium: "medium",
          high: "high",
          xhigh: "xhigh",
          max: "max",
        },
      });
      expect(model?.compat).toMatchObject({
        supportsOpenAIGrammarTools: true,
        supportsAdditionalTools: true,
        supportsToolSearch: true,
        supportsMidConvoSystemMessages: true,
      });
      if (provider === "openai")
        expect(model?.compat).toMatchObject({ supportsStrictMode: true, supportsExplicitPromptCacheMode: true });
    }
  });

  test.each(["openai", "openai-codex"])(
    "configured offline %s provider appears in the real model selector and can be selected",
    async (provider) => {
      const credentials = AuthStorage.inMemory(
        provider === "openai-codex"
          ? {
              "openai-codex": {
                type: "oauth",
                access: "offline-test-access",
                refresh: "offline-test-refresh",
                expires: Date.now() + 3_600_000,
              },
            }
          : {},
      );
      const runtime = await ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
      if (provider === "openai") await runtime.setRuntimeApiKey(provider, "offline-test-key");
      const registry = new ModelRegistry(runtime);
      const model = registry.find(provider, "gpt-6.1-sol");
      expect(model).toBeDefined();
      expect(registry.getAvailable().some((entry) => entry === model)).toBe(true);
      let selected: typeof model;
      // Picker refreshes on construction; force its catalog refresh to remain offline too.
      const refresh = runtime.refresh.bind(runtime);
      runtime.refresh = (options = {}) => refresh({ ...options, allowNetwork: false });
      initTheme("dark");
      const selector = new ModelSelectorComponent(
        { requestRender() {} } as any,
        model!,
        runtime,
        [],
        (value) => {
          selected = value;
        },
        () => {},
        "gpt-6.1-sol",
      );
      try {
        const matches = (selector as any).filteredModels.filter(
          (item: any) => item.provider === provider && item.id === "gpt-6.1-sol",
        );
        expect(matches).toHaveLength(1);
        expect(matches[0].model).toBe(model);
        expect(selector.render(100).join("\n")).toContain("gpt-6.1-sol");
        selector.handleInput("\r");
        expect(selected).toBe(model);
      } finally {
        selector.dispose();
      }
    },
  );
});
