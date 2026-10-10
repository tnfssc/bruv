import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { preflightClaudeCompatModel } from "../../src/claude-compat/runtime";

test("local preflight accepts only an explicit selection/default, never the first authenticated model", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "bruv-model-preflight-"));
  try {
    await writeFile(
      join(agentDir, "auth.json"),
      JSON.stringify({ anthropic: { type: "api_key", key: "offline-fixture-only" } }),
    );
    const models = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const options = {
      cwd: agentDir,
      agentDir,
      emit() {},
      modelRuntime: models,
      settingsManager: SettingsManager.inMemory({}, { projectTrusted: false }),
    };
    await expect(preflightClaudeCompatModel(options)).rejects.toThrow("No Bruv model selected");
    await expect(preflightClaudeCompatModel({ ...options, model: "" })).rejects.toThrow("exact Bruv provider/id");
    const settingsManager = SettingsManager.inMemory(
      { defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-5" },
      { projectTrusted: false },
    );
    const ready = await preflightClaudeCompatModel({ ...options, settingsManager });
    expect(ready.initialModel.id).toBe("claude-sonnet-4-5");
    // Invalid explicit selection cannot fall back to the valid configured default.
    await expect(
      preflightClaudeCompatModel({ ...options, settingsManager, model: "anthropic/nonexistent" }),
    ).rejects.toThrow("Unknown Bruv model");
    expect(await readdir(agentDir)).toEqual(["auth.json"]);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});
