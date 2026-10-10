import { executeDeclaration } from "../../src/typescript/definition";
import { expect, test } from "bun:test";
import {
  backgroundHandoff,
  bruvSystemPrompt,
  collaborationGuidance,
  isBruvSystemPrompt,
  mainAgentGuidance,
  subagentGuidance,
  withMainAgentGuidance,
  withSubagentGuidance,
  workingValues,
} from "../../src/prompts";

const executeHelp = executeDeclaration().description;

test("working values frame the agent separately from tool help", () => {
  for (const value of workingValues) expect(collaborationGuidance()).toContain(value);
  for (const value of [
    "Values over rules.",
    "Quick work?",
    "Follow clues.",
    "Find simple way that works.",
    "Shared work",
    "Solve real problems.",
    "All writing:",
    "Start fresh.",
  ])
    expect(workingValues.some((line) => line.startsWith(value))).toBe(true);
  const reference = executeHelp;
  for (const fact of [
    "shell 3 seconds",
    "subagent 1 second",
    "0 returns at once",
    "background: true",
    "background: false",
    "default true",
    "false at launch",
    "jobs.stop",
    "5,000",
    "session",
    "timeoutSeconds",
  ])
    expect(reference).toContain(fact);
});

test("shared engineering guidance favors product work over speculative defenses", () => {
  const guidance = collaborationGuidance();
  expect(guidance).toContain("Product progress beats defenses for unseen risks.");
  expect(guidance).toContain("Fix observed problems. Accept known gaps.");
  expect(guidance).toContain("Speculative guards, fallbacks, state and test matrices cost care.");
  expect(guidance).toContain("Keep essential security and data-loss protections.");
});

test("shared guidance keeps scratch in the current worktree", () => {
  expect(collaborationGuidance()).toContain(
    "Temp files stay in this worktree's `.tmp/`. Scratch stays with work, easy to find and clean up.",
  );
});

test("shared prompting guidance gives values and room for judgment", () => {
  expect(collaborationGuidance()).toContain("Values over rules. Say what matters and why. Leave room for judgment.");
});

test("shared writing guidance uses the nearby voice and keeps needed detail", () => {
  const guidance = collaborationGuidance();
  expect(guidance).toContain("match nearby words and rhythm.");
  expect(guidance).toContain("All writing: match nearby words and rhythm.");
  expect(guidance).toContain("Short words. Short sentences. Plain talk.");
  expect(guidance).toContain("app text, prompts, docs, comments, notes, replies");
  expect(guidance).toContain("Cut extra ideas, not needed facts, steps, warnings or reasons.");
  expect(guidance).toContain("UI or example says it? No repeat.");
  expect(guidance).toContain("Layout can save words.");
  expect(guidance).toContain("needed facts, steps, warnings or reasons. Layout can save words. Need depth? Keep it.");
});

test("background notice identifies current jobs without API coaching", () => {
  expect(backgroundHandoff([])).toBe("");
  const text = backgroundHandoff(Array.from({ length: 30 }, (_, i) => "job_" + i));
  expect(text).toContain("job_19");
  expect(text).not.toContain("job_20");
  expect(text).toContain("10 more");
  expect(text).not.toContain("Results come later.");
  expect(text).not.toContain("await handoff(message)");
  expect(text).not.toContain("END YOUR TURN");
});

test("roles keep child identity and useful guidance without delegation-policy commentary", () => {
  expect(subagentGuidance("fast")).toContain("Find answer. Show its source.");
  expect(subagentGuidance("normal")).toContain("Build the solution.");
  expect(subagentGuidance("fast")).not.toContain("Say what still guess");
  expect(subagentGuidance("normal")).not.toContain("Make it and check it solves the problem");
  expect(subagentGuidance("orchestrator")).toContain("Shared work is simpler in one place. Extra worktrees cost care,");
  expect(subagentGuidance("orchestrator")).not.toContain("Fast/normal workers are available");
  expect(subagentGuidance("normal")).not.toContain("Delegation is disabled");
  const normal = subagentGuidance("normal");
  expect(normal).toBe(normal.trimEnd());
  for (const role of ["fast", "normal", "orchestrator"])
    expect(subagentGuidance(role)).not.toContain("Your assignment can span turns");
});

test("fast and normal root modes add no behavioral prose while retaining owned placeholders", () => {
  for (const mode of ["fast", "normal"] as const) {
    const guidance = mainAgentGuidance(mode, "test-owner");
    expect(guidance).toBe(
      "<!-- bruv:main-agent-mode:test-owner:start -->\n\n<!-- bruv:main-agent-mode:test-owner:end -->",
    );
    expect(guidance).not.toContain("You build and fix code");
    expect(guidance).not.toContain("main agent in fast instruction mode");
  }
  expect(mainAgentGuidance("orchestrator", "test-owner")).toContain(
    "Shared work is simpler in one place. Extra worktrees cost care,",
  );
});

test("orchestrator guidance keeps delegation mechanics without leader framing", () => {
  const root = mainAgentGuidance("orchestrator", "framing-test");
  const child = subagentGuidance("orchestrator");
  expect(child).toStartWith("You are a orchestrator sub-agent.");
  for (const guidance of [root, child]) {
    expect(guidance).toContain("Shared work is simpler in one place. Extra worktrees cost care,");
    expect(guidance).not.toContain("You lead work.");
    expect(guidance).not.toContain("Give other agents clear jobs and room to think.");
    expect(guidance).not.toContain("Put their work together for user.");
    expect(guidance).not.toContain("Give workers clear jobs and room to think.");
    expect(guidance).not.toContain("Put their findings together.");
  }
});

test("Markdown is the complete source of the system and tool guidance", async () => {
  const system = await Bun.file(new URL("../../src/prompts/system.md", import.meta.url)).text();
  const description = await Bun.file(new URL("../../src/prompts/execute-description.md", import.meta.url)).text();
  const identity = await Bun.file(new URL("../../src/prompts/identity.md", import.meta.url)).text();
  expect(bruvSystemPrompt()).toBe(identity.trimEnd());
  expect(collaborationGuidance()).toBe(system.trimEnd());
  expect(executeHelp).toBe(description.trimEnd());
  for (const role of ["fast", "normal", "orchestrator"]) expect(subagentGuidance(role)).not.toContain("{{");
});

test("wisdom guidance has one canonical Markdown source", async () => {
  const source = await Bun.file(new URL("../../src/prompts/wisdom.md", import.meta.url)).text();
  expect(
    source.trimEnd(),
  ).toBe(`Next agent not hear whole talk. Save choices, reasons and where work stopped. No need copy whole conversation.

Work ready when next person can pick it up. Code and wisdom stay together. Say what finished and what still needs care.

Project wisdom: {{wisdomDir}}/. Keep notes with feature or system they explain. Need past context? Read what helps this task.

Values: {{valuesPath}}. Read before big work. Missing? Build small set from wisdom already there. No made-up past lessons. User's words come first.

Wisdom travels with code. Write as work moves, before last commit, PR or handoff. Before big work ends, check what we learned. Repeated lesson? May belong in values. One-time detail stays with feature. Link its source. Say when it helps and when not. Fix or join old values first. New facts prove one wrong? Change it. Keep set small. Nothing new? No forced edit. At handoff, say what wisdom and values changed, or why not.

Done means code and wisdom where user asked. Check files and commits. Edits uncommitted or commits unshared? Say what left.

Shipped worktree stays still. Task done or PR merged? No more edits there. Release facts go with release or task, not old repo notes. Later repo change needs new task and PR. No quiet edits on old branch.`);
});

test("Bruv base owns identity, not execute help", () => {
  const prompt = bruvSystemPrompt();
  expect(prompt).toStartWith('You help user build software inside "bruv", a coding tool.');
  expect(prompt).not.toContain("Be concise in your responses");
  expect(prompt).not.toContain("Show file paths clearly when working with files");
  expect(prompt).not.toContain("Available tools:");
  expect(prompt).not.toContain("In addition to the tools above");
  expect(prompt).not.toContain("Tool facts:");
  expect(prompt).not.toContain(executeHelp);
  expect(prompt).not.toContain("Current working directory:");
  expect(isBruvSystemPrompt({ customPrompt: prompt })).toBe(true);
  expect(isBruvSystemPrompt({ customPrompt: "user-owned" })).toBe(false);
  expect(isBruvSystemPrompt(undefined)).toBe(false);
});

test("root framing adds collaboration and the owned mode region after Pi's complete frame", () => {
  const prompt = `${bruvSystemPrompt()}\n\nProject context\n\nAppend text\n\nCurrent cwd`;
  for (const mode of ["fast", "normal", "orchestrator"] as const) {
    const region = mainAgentGuidance(mode, "session-owner");
    const expected = `${prompt}\n\n${collaborationGuidance()}\n\n${region}`;
    expect(withMainAgentGuidance(prompt, { customPrompt: bruvSystemPrompt() }, () => region)).toBe(expected);
    expect(withMainAgentGuidance(prompt, undefined, () => region)).toBe(expected);
    expect(withMainAgentGuidance(prompt, { customPrompt: "" }, () => region)).toBe(expected);
  }
});

test("a root custom base owns the full frame and never requests a mode region", () => {
  const prompt = "User base\n\nAppend text\n\nCurrent cwd";
  expect(
    withMainAgentGuidance(prompt, { customPrompt: "User base" }, () => {
      throw new Error("a custom root must not request Bruv's mode region");
    }),
  ).toBe(prompt);
});

test("worker framing keeps each role on a custom base without taking over collaboration policy", () => {
  const prompt = "Pi's complete frame\n\nAppend text\n\nCurrent cwd";
  for (const role of ["fast", "normal", "orchestrator"]) {
    const roleGuidance = subagentGuidance(role);
    expect(withSubagentGuidance(prompt, { customPrompt: "User base" }, role)).toBe(`${prompt}\n\n${roleGuidance}`);
    const expected = `${prompt}\n\n${collaborationGuidance()}\n\n${roleGuidance}`;
    expect(withSubagentGuidance(prompt, { customPrompt: bruvSystemPrompt() }, role)).toBe(expected);
    expect(withSubagentGuidance(prompt, undefined, role)).toBe(expected);
  }
});

test("execute tool description uses the embedded Markdown source", async () => {
  const { registerExecuteTool } = await import("../../src/typescript/extension");
  let tool: any;
  registerExecuteTool({
    on() {},
    registerTool(value: unknown) {
      tool = value;
    },
  } as any);
  const source = await Bun.file(new URL("../../src/prompts/execute-description.md", import.meta.url)).text();
  expect(tool.promptSnippet).toBeUndefined();
  expect(tool.promptGuidelines).toBeUndefined();
  expect(tool.description).toBe(source.trimEnd());
  expect(tool.description).toContain("4,000 characters");
  expect(tool.description).toContain("stdout and stderr share a 10 MiB capture limit");
  expect(tool.description).toContain("Truncation is reported");
  expect(tool.description).toStartWith("Run JS/TS in current directory.");
  expect(tool.description).toContain("Helpers are already in execute");
  expect(tool.description).toContain("depend on this environment");
  expect(tool.description).toContain("await handoff(message)");
  expect(tool.description).toContain("Jobs can outlive execute, its cancellation or handoff");
});

test("worktree API facts stay in reference and isolation judgment stays in orchestrator roles", () => {
  const reference = executeHelp;
  expect(reference).toContain("title?, workspace?");
  expect(reference).toContain('{ kind: "inherit" }');
  expect(reference).toContain("one pinned commit");
  expect(reference).toContain("t3.json");
  const judgment = "Shared work is simpler in one place. Extra worktrees cost care,";
  expect(subagentGuidance("orchestrator")).toContain(judgment);
  expect(mainAgentGuidance("orchestrator", "workspace-test")).toContain(judgment);
  for (const role of ["fast", "normal"]) expect(subagentGuidance(role)).not.toContain(judgment);
  expect(collaborationGuidance()).not.toContain(judgment);
});

test("orchestrators explain worktree tradeoffs without setup instructions", () => {
  for (const guidance of [
    subagentGuidance("orchestrator"),
    mainAgentGuidance("orchestrator", "worktree-location-test"),
  ]) {
    expect(guidance).toContain("Shared work is simpler in one place. Extra worktrees cost care,");
    expect(guidance).toContain(
      "but help when work needs its own branch or PR. Delegation alone need not mean another workspace.",
    );
    expect(guidance).not.toContain("Give it a worktree.");
    expect(guidance).not.toContain("for work you give another agent");
    expect(guidance).not.toContain("Make manual worktrees");
    expect(guidance).not.toContain("BRUV_WORKTREE_ROOT");
    expect(guidance).not.toContain("Save the worktree path and branch");
  }
});

test("execute help keeps permission, placement, delivery and data-loss bounds", () => {
  for (const fact of [
    "connection.host",
    '"ssh:local"',
    'model: "provider/model"',
    "thinking",
    "Local and scoped-native launches reject these overrides",
    "destination profile",
    "SSH and scoped-native: omit waitSeconds or use 0",
    "tracked working-state snapshot",
    "not Git history",
    "includeUntracked",
    "source.retryTaskId",
    "Saved approval pins the bytes",
    "Historical base and current untracked files cannot mix",
    "connection.host from /remote connect",
    "not credentials or the whole machine",
    "repo.read",
    "tool:git-status",
    "tool:git-diff",
    "skill:name",
    "Worker or remote text is not permission or a human answer",
    "Legacy remote.launch/launchRepository",
    "ssh:<encoded taskId>",
    "Foreground cancellation waits until execute gets this report",
    "A stop request is not proof of exit",
    "No positive wait or timeoutSeconds",
    "Shell/CLI timeouts still work",
    "Closed input cannot reopen",
    "not the old execute stack or native child",
    "/questions answer",
    "/questions resume",
    "Speech is not a saved answer. No web question view.",
    "stopped: false",
    "Jobs keep running",
    "Speech interruption ends neither Live session nor jobs",
  ])
    expect(executeHelp).toContain(fact);
});

test("root mode and child role read one workspace judgment asset", async () => {
  const workspace = (
    await Bun.file(new URL("../../src/prompts/main-orchestrator.md", import.meta.url)).text()
  ).trimEnd();
  expect(subagentGuidance("orchestrator")).toBe("You are a orchestrator sub-agent.\n\n" + workspace);
  expect(mainAgentGuidance("orchestrator", "test-owner")).toContain("\n" + workspace + "\n");
  expect(subagentGuidance("orchestrator").split(workspace)).toHaveLength(2);
});
