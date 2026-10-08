import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createPromptPreview } from "../src/prompt-preview";
import { executeGuidance } from "../src/prompts";
import { registerExecuteTool } from "../src/typescript/extension";

test("offline preview captures production prompt, tool definition, and injected messages", async () => {
  const fetch = spyOn(globalThis, "fetch").mockImplementation((() => {
    throw new Error("prompt preview attempted network access");
  }) as unknown as typeof globalThis.fetch);
  try {
    let registered!: ToolDefinition;
    registerExecuteTool({
      registerTool(tool: ToolDefinition) {
        registered = tool;
      },
      on() {},
    } as unknown as ExtensionAPI);

    const preview = await createPromptPreview({
      message: "USER_PREVIEW_MARKER",
      goal: "GOAL_PREVIEW_MARKER",
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(preview.preview.context).toBe("isolated");
    expect(preview.preview.label).toContain("external project context is excluded");
    expect(preview.preview.transientSession).toBe(true);
    expect(preview.preview.networkRequests).toBe(0);
    expect(preview.preview.role).toBe("root");
    expect(preview.preview.rootMode).toBe("orchestrator");
    expect(preview.systemPrompt).toContain("Delegating independent code or PR work? Give it a worktree.");
    expect(preview.systemPrompt).not.toContain("Available tools:");
    expect(preview.systemPrompt).not.toContain("In addition to the tools above");
    for (const guidance of executeGuidance) expect(preview.systemPrompt).toContain(guidance);
    expect(preview.systemPrompt).not.toContain("Delegation is disabled");
    expect(preview.systemPrompt).toContain("<cwd>");
    expect(preview.messages[0]?.role).toBe("system");
    expect(getCurrentSystemPrompt(preview.messages)).toBe(preview.systemPrompt);
    expect(getCurrentTools(preview.messages)).toEqual(preview.tools);
    expect(preview.tools).toHaveLength(1);
    expect(preview.tools[0]).toMatchObject({
      name: registered.name,
      description: registered.description,
      parameters: registered.parameters,
    });
    expect(preview.tools[0]!.description).toBe(
      (await Bun.file(new URL("../src/prompts/execute-description.md", import.meta.url)).text()).trimEnd(),
    );
    expect(JSON.stringify(preview.messages)).toContain("USER_PREVIEW_MARKER");
    expect(JSON.stringify(preview.messages)).toContain("Persistent goal state (authoritative)");
    expect(JSON.stringify(preview.messages)).toContain("GOAL_PREVIEW_MARKER");
  } finally {
    fetch.mockRestore();
  }
});

test("root modes and explicitly selected project guidance pass through real assembly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-prompt-preview-project-"));
  try {
    await writeFile(join(dir, "AGENTS.md"), "PROJECT_PREVIEW_GUIDANCE");
    const preview = await createPromptPreview({ project: dir, rootMode: "fast" });

    expect(preview.preview.context).toBe("selected-project");
    expect(preview.preview.label).toContain(dir);
    expect(preview.preview.included).toContain("project/ancestor AGENTS.md files discovered by Pi");
    expect(preview.systemPrompt).toContain("PROJECT_PREVIEW_GUIDANCE");
    expect(preview.systemPrompt).toContain("Next agent not hear whole talk.");
    expect(preview.systemPrompt).not.toContain("main agent in fast instruction mode");
    expect(preview.systemPrompt).not.toContain("You build and fix code.");
    expect(preview.systemPrompt).not.toContain("Delegating independent code or PR work? Give it a worktree.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("selected project base and append are included without loading settings or writing project state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bruv-prompt-preview-custom-"));
  const fetch = spyOn(globalThis, "fetch").mockImplementation((() => {
    throw new Error("prompt preview attempted network access");
  }) as unknown as typeof globalThis.fetch);
  try {
    await mkdir(join(dir, ".bruv"));
    await writeFile(join(dir, ".bruv", "SYSTEM.md"), "CUSTOM_PREVIEW_BASE");
    await writeFile(join(dir, ".bruv", "APPEND_SYSTEM.md"), "CUSTOM_PREVIEW_APPEND");
    await writeFile(
      join(dir, ".bruv", "settings.json"),
      JSON.stringify({ packages: ["npm:preview-must-not-install"] }),
    );
    const before = await readdir(dir);
    const preview = await createPromptPreview({ project: dir, goal: "CUSTOM_GOAL" });
    expect(preview.systemPrompt).toContain("CUSTOM_PREVIEW_BASE");
    expect(preview.systemPrompt).toContain("CUSTOM_PREVIEW_APPEND");
    expect(preview.systemPrompt).toContain("Next agent not hear whole talk.");
    expect(preview.systemPrompt).not.toContain("Quick work? Finish it.");
    expect(preview.systemPrompt).not.toContain("Delegating independent code or PR work? Give it a worktree.");
    expect(JSON.stringify(preview.messages)).toContain("CUSTOM_GOAL");
    expect(preview.preview.excluded).toContain("global and project settings/packages");
    expect(await readdir(dir)).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
    await rm(dir, { recursive: true, force: true });
  }
});

test("workspace reference and delegation mechanics reach real root and child assembly", async () => {
  const judgment = "Delegating independent code or PR work? Give it a worktree.";
  for (const role of ["root", "orchestrator", "normal"] as const) {
    const preview = await createPromptPreview({ role });
    expect(preview.preview.networkRequests).toBe(0);
    expect(preview.systemPrompt).toContain("title?, workspace?");
    expect(preview.systemPrompt).toContain("one pinned commit");
    expect(preview.systemPrompt).not.toContain("You lead work.");
    expect(preview.systemPrompt).not.toContain("Give other agents clear jobs and room to think.");
    expect(preview.systemPrompt).not.toContain("Put their work together for user.");
    expect(preview.systemPrompt).not.toContain("Give workers clear jobs and room to think.");
    expect(preview.systemPrompt).not.toContain("Put their findings together.");
    if (role === "normal") expect(preview.systemPrompt).not.toContain(judgment);
    else expect(preview.systemPrompt.split(judgment)).toHaveLength(2);
  }
});

test("custom child base and append preserve role framing without injecting Bruv API prose", async () => {
  const dir = await mkdtemp(join("/var/tmp", "bruv-workspace-prompt-"));
  try {
    await mkdir(join(dir, ".bruv"));
    await writeFile(join(dir, ".bruv", "SYSTEM.md"), "WORKSPACE_CUSTOM_BASE");
    await writeFile(join(dir, ".bruv", "APPEND_SYSTEM.md"), "WORKSPACE_CUSTOM_APPEND");
    const preview = await createPromptPreview({ project: dir, role: "orchestrator" });
    expect(preview.preview.networkRequests).toBe(0);
    expect(preview.systemPrompt).toContain("WORKSPACE_CUSTOM_BASE");
    expect(preview.systemPrompt).toContain("WORKSPACE_CUSTOM_APPEND");
    expect(preview.systemPrompt).toContain("You are a orchestrator sub-agent.");
    expect(preview.systemPrompt).toContain("Delegating independent code or PR work? Give it a worktree.");
    expect(preview.systemPrompt).not.toContain("title?, workspace?");
    expect(preview.systemPrompt).not.toContain("Quick work? Finish it.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("explicit preview roles do not inherit or overwrite the caller child identity", async () => {
  const priorDepth = process.env.BRUV_SUBAGENT_DEPTH;
  const priorType = process.env.BRUV_SUBAGENT_TYPE;
  process.env.BRUV_SUBAGENT_DEPTH = "4";
  process.env.BRUV_SUBAGENT_TYPE = "orchestrator";
  try {
    const root = await createPromptPreview();
    expect(root.systemPrompt).toContain("Delegating independent code or PR work? Give it a worktree.");
    expect(root.systemPrompt).not.toContain("You lead work.");
    expect(root.systemPrompt).not.toContain("You are a orchestrator sub-agent.");
    expect(process.env.BRUV_SUBAGENT_DEPTH).toBe("4");
    expect(process.env.BRUV_SUBAGENT_TYPE).toBe("orchestrator");

    for (const role of ["fast", "normal"] as const) {
      const child = await createPromptPreview({ role });
      expect(child.systemPrompt).toContain(`You are a ${role} sub-agent.`);
      expect(child.systemPrompt).not.toContain("You lead work.");
      expect(child.systemPrompt).not.toContain("Delegating independent code or PR work? Give it a worktree.");
      expect(child.systemPrompt).not.toContain("You are a orchestrator sub-agent.");
      expect(process.env.BRUV_SUBAGENT_DEPTH).toBe("4");
      expect(process.env.BRUV_SUBAGENT_TYPE).toBe("orchestrator");
    }
  } finally {
    if (priorDepth === undefined) delete process.env.BRUV_SUBAGENT_DEPTH;
    else process.env.BRUV_SUBAGENT_DEPTH = priorDepth;
    if (priorType === undefined) delete process.env.BRUV_SUBAGENT_TYPE;
    else process.env.BRUV_SUBAGENT_TYPE = priorType;
  }
});
