import { expect, test } from "bun:test";
import { getModel } from "@earendil-works/pi-ai/compat";
import { ModelRegistry, ModelRuntime, ModelSelectorComponent, initTheme } from "@earendil-works/pi-coding-agent";
import { AuthStorage } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";

// Published Pi 1.1.0 ID, not a local alias. No provider request or account-access claim.
test("bundled Haiku 5.5 is available and selectable with offline Anthropic credentials", async () => {
  const catalogModel = getModel("anthropic", "claude-haiku-5-5");
  expect(catalogModel).toMatchObject({
    id: "claude-haiku-5-5",
    name: "Claude Haiku 5.5",
    provider: "anthropic",
    api: "anthropic-messages",
  });
  const runtime = await ModelRuntime.create({
    credentials: AuthStorage.inMemory(),
    modelsPath: null,
    allowModelNetwork: false,
  });
  await runtime.setRuntimeApiKey("anthropic", "offline-test-key");
  const registry = new ModelRegistry(runtime);
  const model = registry.find("anthropic", catalogModel.id);
  expect(model).toBeDefined();
  expect(registry.getAvailable()).toContain(model!);
  const refresh = runtime.refresh.bind(runtime);
  runtime.refresh = (options = {}) => refresh({ ...options, allowNetwork: false });
  initTheme("dark");
  let selected: typeof model;
  const selector = new ModelSelectorComponent(
    { requestRender() {} } as any,
    model!,
    runtime,
    [],
    (value) => {
      selected = value;
    },
    () => {},
    "claude-haiku-5-5",
  );
  try {
    const matches = (selector as any).filteredModels.filter(
      (item: any) => item.provider === "anthropic" && item.id === catalogModel.id,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].model).toBe(model);
    expect(selector.render(100).join("\n")).toContain(catalogModel.id);
    selector.handleInput("\r");
    expect(selected).toBe(model);
  } finally {
    selector.dispose();
  }
});
