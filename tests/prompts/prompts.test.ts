import { expect, test } from "bun:test";
import {
  backgroundHandoff,
  bruvSystemPrompt,
  collaborationGuidance,
  executeGuidance,
  executeReference,
  isBruvSystemPrompt,
  mainAgentGuidance,
  subagentGuidance,
  withMainAgentGuidance,
  withSubagentGuidance,
  workingValues,
} from "../../src/prompts";

test("working values frame the agent separately from tool reference", () => {
  expect(executeGuidance).toEqual(executeReference);
  for (const value of workingValues) expect(collaborationGuidance()).toContain(value);
  for (const value of [
    "Values over rules.",
    "Quick work?",
    "Go look.",
    "Find simple way",
    "Share work.",
    "Solve real problem.",
    "All writing:",
    "Assume fresh start.",
  ])
    expect(workingValues.some((line) => line.startsWith(value))).toBe(true);
  const reference = executeReference.join("\n");
  for (const fact of [
    "shell 3 seconds",
    "subagent 1 second",
    "0 returns immediately",
    "background: true",
    "background: false",
    "defaults to true",
    "Set false at launch",
    "jobs.stop",
    "5,000",
    "session",
    "timeoutSeconds",
  ])
    expect(reference).toContain(fact);
});

test("shared engineering guidance favors product work over speculative defenses", () => {
  const guidance = collaborationGuidance();
  expect(guidance).toContain("Favor product progress over exhaustive defenses.");
  expect(guidance).toContain("Fix observed problems. Accept known gaps.");
  expect(guidance).toContain("No speculative guards, fallbacks, state, or test matrices.");
  expect(guidance).toContain("Keep essential security and data-loss protections.");
});

test("shared guidance keeps scratch in the current worktree", () => {
  expect(collaborationGuidance()).toContain(
    "Temp files belong in current worktree's `.tmp/`. Scratch stays with work, easy to find and clean up.",
  );
});

test("shared prompting guidance gives values and room for judgment", () => {
  expect(collaborationGuidance()).toContain("Values over rules. Say what matters and why. Leave room for judgment.");
});

test("shared writing guidance uses the nearby voice and keeps needed detail", () => {
  const guidance = collaborationGuidance();
  expect(guidance).toContain("use same voice as rest. Read nearby text first.");
  expect(guidance).toContain("Match its words and rhythm in all writing. No formal talk.");
  expect(guidance).toContain("Short words. Short sentences. Plain talk.");
  expect(guidance).toContain("app text, prompts, docs, comments, notes, replies");
  expect(guidance).toContain("Cut extra ideas and sections, not just words.");
  expect(guidance).toContain("No tell it again.");
  expect(guidance).toContain("Better layout can save words.");
  expect(guidance).toContain("Keep needed facts, steps, warnings, reasons. Need depth? Keep it.");
});

test("background notice identifies jobs and deferred results without turn-management coaching", () => {
  expect(backgroundHandoff([])).toBe("");
  const text = backgroundHandoff(Array.from({ length: 30 }, (_, i) => "job_" + i));
  expect(text).toContain("job_19");
  expect(text).not.toContain("job_20");
  expect(text).toContain("10 more");
  expect(text).toContain("Results come later.");
  expect(text).not.toContain("await handoff(message)");
  expect(text).not.toContain("END YOUR TURN");
});

test("roles keep child identity and useful guidance without delegation-policy commentary", () => {
  expect(subagentGuidance("fast")).toContain("Find answer. Show where it came from. Say what still guess.");
  expect(subagentGuidance("normal")).toContain("Work out what to change. Make it. Check it solves the problem.");
  expect(subagentGuidance("orchestrator")).toContain(
    "Shared work is simpler in one place. Extra worktrees bring extra care.",
  );
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
    "Shared work is simpler in one place. Extra worktrees bring extra care.",
  );
});

test("orchestrator guidance keeps delegation mechanics without leader framing", () => {
  const root = mainAgentGuidance("orchestrator", "framing-test");
  const child = subagentGuidance("orchestrator");
  expect(child).toStartWith("You are a orchestrator sub-agent.");
  for (const guidance of [root, child]) {
    expect(guidance).toContain("Shared work is simpler in one place. Extra worktrees bring extra care.");
    expect(guidance).not.toContain("You lead work.");
    expect(guidance).not.toContain("Give other agents clear jobs and room to think.");
    expect(guidance).not.toContain("Put their work together for user.");
    expect(guidance).not.toContain("Give workers clear jobs and room to think.");
    expect(guidance).not.toContain("Put their findings together.");
  }
});

test("Markdown is the complete source of the system and tool guidance", async () => {
  const system = await Bun.file(new URL("../../src/prompts/system.md", import.meta.url)).text();
  const reference = await Bun.file(new URL("../../src/prompts/execute.md", import.meta.url)).text();
  const identity = await Bun.file(new URL("../../src/prompts/identity.md", import.meta.url)).text();
  expect(bruvSystemPrompt()).toBe(`${identity.trimEnd()}\n\nGuidelines:\n${reference.trimEnd()}`);
  expect(collaborationGuidance()).toBe(system.trimEnd());
  expect(executeGuidance.map((item) => "- " + item).join("\n")).toBe(reference.trimEnd());
  for (const role of ["fast", "normal", "orchestrator"]) expect(subagentGuidance(role)).not.toContain("{{");
});

test("wisdom guidance has one canonical Markdown source", async () => {
  const source = await Bun.file(new URL("../../src/prompts/wisdom.md", import.meta.url)).text();
  expect(
    source.trimEnd(),
  ).toBe(`Next agent not hear whole talk. Save decisions, reasons, and where work stopped. No need copy whole conversation.

Work not done if next person cannot pick it up. Leave code and wisdom together, where others can get both. Say what finished and what still needs care.

Project wisdom lives in {{wisdomDir}}/. Put it with the feature or system it explains. Need past context? Read the wisdom that helps with this task.

Values live in {{valuesPath}}. Read before big work. Missing? Build small set from wisdom already there. No make up past lessons. User's words come first.

Write wisdom while doing the work. Finish it before the last commit, PR, or handoff. Put it with the code. No wait until the job is done. Write wisdom? Look for lesson that belongs in values too. Before big work ends or changes hands, check what we learned. Same lesson keeps coming back? Turn it into value. Link the wisdom it came from. Say when it helps and when it does not. Fix or join old values before adding more. New facts prove one wrong? Change it. Keep set small. One-time detail stays with feature. Nothing new? No need change values. At end, say what wisdom changed and what values changed. Values stayed same? Say why.

Before saying done, check our files and commits. Any edits not committed? Any commits not shared yet? Send code and wisdom where the user asked. Not there yet? Say what is left.

Task done or PR merged? No more edits in that worktree. Record release facts with the release or task, not in the old worktree. No new repo notes after shipping. Need another repo change? Start a new task and PR. No quiet edits on the old branch.

Write prompts and wisdom in same voice as rest. Short words. Short sentences. Plain talk. Read nearby text first. No formal policy talk. Keep exact names and facts when they matter.`);
});

test("Bruv base is a Pi custom prompt with execute guidance", () => {
  const prompt = bruvSystemPrompt();
  expect(prompt).toStartWith('You help user build software. You work inside a coding tool named "bruv".');
  expect(prompt).not.toContain("Be concise in your responses");
  expect(prompt).not.toContain("Show file paths clearly when working with files");
  expect(prompt).not.toContain("Available tools:");
  expect(prompt).not.toContain("In addition to the tools above");
  expect(prompt).toContain("\n\nGuidelines:\n");
  for (const item of executeGuidance) expect(prompt).toContain("- " + item);
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
  expect(tool.promptSnippet).toBe("Run JS/TS.");
  expect(tool.description).toBe(source.trimEnd());
  expect(tool.description).toContain("4,000 characters");
  expect(tool.description).toContain("shared 10 MiB stdout/stderr capture limit");
  expect(tool.description).toContain("truncation is reported explicitly");
  expect(tool.description).toStartWith("Run JS/TS code in current directory.");
  expect(tool.description).toContain("call the shell() or subagent() globals inside execute");
  expect(tool.description).toContain("depends on the actual environment and result");
  expect(tool.description).not.toContain("handoff");
  expect(executeReference.join("\n")).toContain("Execution cancelled? Jobs already started");
});

test("worktree API facts stay in reference and isolation judgment stays in orchestrator roles", () => {
  const reference = executeReference.join("\n");
  expect(reference).toContain("title?, workspace?");
  expect(reference).toContain('{ kind: "inherit" }');
  expect(reference).toContain("one pinned commit");
  expect(reference).toContain("t3.json");
  const judgment = "Shared work is simpler in one place. Extra worktrees bring extra care.";
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
    expect(guidance).toContain("Shared work is simpler in one place. Extra worktrees bring extra care.");
    expect(guidance).toContain(
      "A worktree helps when work needs its own branch or PR. Giving work to another agent need not mean another workspace.",
    );
    expect(guidance).not.toContain("Give it a worktree.");
    expect(guidance).not.toContain("for work you give another agent");
    expect(guidance).not.toContain("Make manual worktrees");
    expect(guidance).not.toContain("BRUV_WORKTREE_ROOT");
    expect(guidance).not.toContain("Save the worktree path and branch");
  }
});
