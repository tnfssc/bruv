import type { Cell } from "./type";

/**
 * Scripted, condensed conversations, NOT recorded model responses.
 * Sources: wisdom/landing-page/product-story.md (the three product stories);
 * wisdom/task-placement/clean-product-video.md and scripts/fixtures/task-placement-clean/
 * scenario.ts + models.json (real worktree helpers, natural labels, fixture model studio);
 * src/ui/execution-previews.ts + task-rows.ts + rolling-activity.ts (tool groups/task outcomes);
 * src/ui/editor.ts + footer.ts + conversation-density.ts (borderless gutter, compact footer);
 * src/wisdom/extension.ts + location.ts and src/prompts/wisdom.md (explicit file reuse).
 * /wisdom only reports a directory; it does NOT restore hidden conversational memory.
 * RGB values resolve Pi 1.0.0's bundled dark.json. Background comes from the existing
 * settings-cells.json capture. Product themes are configurable. The Nerd Font idle
 * icon U+F460 is bundled as a tiny webfont subset. Code previews and other chrome
 * are honestly condensed. No tools, network, paid calls, private paths or timers run.
 */
export const demoIds = ["delegate", "background", "wisdom"] as const;
export type DemoId = (typeof demoIds)[number];
export const demoHeight = (cols: number): number => (cols < 60 ? 27 : 23);

const rgb = (r: number, g: number, b: number) => "38;2;" + r + ";" + g + ";" + b;
const background = "48;2;20;24;32";
const styles = {
  text: rgb(222, 224, 225) + ";" + background,
  dim: rgb(126, 136, 142) + ";" + background,
  prompt: rgb(108, 118, 123) + ";" + background,
  accent: rgb(167, 152, 215) + ";" + background,
  success: rgb(104, 183, 141) + ";" + background,
  user: rgb(222, 224, 225) + ";48;2;33;59;73",
  cursor: rgb(20, 24, 32) + ";48;2;222;224;225",
};
const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
type Block = { kind: "user" | "prose" | "tool" | "task"; text: string; state?: "working" | "running" | "done" };
type Shot = {
  at: number;
  stage: string;
  blocks: Block[];
  input?: string;
  typeFor?: number;
  busy?: boolean;
  jobs?: number;
};
const user = (text: string): Block => ({ kind: "user", text });
const prose = (text: string): Block => ({ kind: "prose", text });
const tool = (text: string, state: "working" | "done" = "done"): Block => ({ kind: "tool", text, state });
const task = (text: string, state: "running" | "done" = "running"): Block => ({ kind: "task", text, state });

const delegatePrompt = "Fix CSV imports in a worktree. I'll keep working on export.";
const du = user(delegatePrompt);
const dp = prose("I'll give the CSV fix its own Git worktree.");
const backgroundPrompt = "Run the import tests in the background.";
const bu = user(backgroundPrompt);
const br = prose("Import tests are running.");
const cachePrompt = "While they run, explain the cache.";
const ca = prose("Clear the preview cache when an import changes its rows.");
const wisdomPrompt = "Read wisdom/csv.md and finish the import.";
const wu = user(wisdomPrompt);
const wc = prose("The notes say to stream rows to limit memory use. The quoted-newline test is still missing.");

const scripts: Record<DemoId, Shot[]> = {
  delegate: [
    { at: 0, stage: "Type a worktree request", blocks: [], input: delegatePrompt, typeFor: 2800 },
    { at: 3100, stage: "Give the fix its own branch", blocks: [du], busy: true },
    { at: 4000, stage: "Plan the delegation", blocks: [du, dp], busy: true },
    { at: 4900, stage: "Launch an isolated helper", blocks: [du, dp, tool("Delegate CSV fix", "working")], busy: true },
    {
      at: 6200,
      stage: "Helper works; your checkout stays free",
      blocks: [du, dp, task("Fix CSV import"), prose("The CSV helper is working in its own checkout.")],
      jobs: 1,
    },
    { at: 11900, stage: "Receive the helper result", blocks: [du, dp, task("Fix CSV import", "done")], busy: true },
    {
      at: 13000,
      stage: "Review before bringing changes back",
      blocks: [du, dp, task("Fix CSV import", "done"), tool("Review helper diff", "working")],
      busy: true,
    },
    {
      at: 16000,
      stage: "Review complete",
      blocks: [du, dp, task("Fix CSV import", "done"), tool("Review helper diff")],
      busy: true,
    },
    {
      at: 18000,
      stage: "Review the branch before merging",
      blocks: [
        du,
        dp,
        task("Fix CSV import", "done"),
        tool("Review helper diff"),
        prose("The fix streams CSV rows and passes the import tests. Review its branch before merging."),
      ],
    },
  ],
  background: [
    { at: 0, stage: "Type a background test request", blocks: [], input: backgroundPrompt, typeFor: 2600 },
    { at: 2900, stage: "Start the tests", blocks: [bu], busy: true },
    {
      at: 3800,
      stage: "Launch the background shell job",
      blocks: [bu, tool("Run import tests", "working")],
      busy: true,
    },
    {
      at: 5100,
      stage: "Tests run without blocking the conversation",
      blocks: [bu, task("Run import tests"), br],
      jobs: 1,
    },
    {
      at: 6700,
      stage: "Ask another question while tests run",
      blocks: [bu, task("Run import tests"), br],
      input: cachePrompt,
      typeFor: 2600,
      jobs: 1,
    },
    {
      at: 9800,
      stage: "Continue the conversation",
      blocks: [bu, task("Run import tests"), br, user(cachePrompt)],
      busy: true,
      jobs: 1,
    },
    {
      at: 11200,
      stage: "Reason about the cache while the job runs",
      blocks: [bu, task("Run import tests"), br, user(cachePrompt), ca],
      jobs: 1,
    },
    {
      at: 15600,
      stage: "Background completion arrives",
      blocks: [bu, task("Run import tests"), br, user(cachePrompt), ca, task("Run import tests", "done")],
      busy: true,
    },
    {
      at: 18100,
      stage: "Use the result without losing the thread",
      blocks: [
        bu,
        task("Run import tests"),
        br,
        user(cachePrompt),
        ca,
        task("Run import tests", "done"),
        prose("Import tests passed. Next: add cache invalidation at the import boundary."),
      ],
    },
  ],
  wisdom: [
    { at: 0, stage: "Ask to reuse saved project context", blocks: [], input: wisdomPrompt, typeFor: 2600 },
    { at: 2900, stage: "Read the saved project context", blocks: [wu], busy: true },
    {
      at: 3900,
      stage: "Read the saved decision and remaining work",
      blocks: [wu, tool("Read wisdom/csv.md", "working")],
      busy: true,
    },
    { at: 5600, stage: "Recover the reason behind the code", blocks: [wu, tool("Read wisdom/csv.md"), wc], busy: true },
    {
      at: 7900,
      stage: "Finish the missing regression",
      blocks: [wu, tool("Read wisdom/csv.md"), wc, tool("Add quoted-newline test", "working")],
      busy: true,
    },
    {
      at: 11200,
      stage: "Check the resumed work",
      blocks: [
        wu,
        tool("Read wisdom/csv.md"),
        wc,
        tool("Add quoted-newline test"),
        tool("Run import tests", "working"),
      ],
      busy: true,
    },
    {
      at: 14300,
      stage: "Leave context for the next session",
      blocks: [
        wu,
        tool("Read wisdom/csv.md"),
        wc,
        tool("Add quoted-newline test"),
        tool("Run import tests"),
        tool("Update wisdom/csv.md", "working"),
      ],
      busy: true,
    },
    {
      at: 17800,
      stage: "Code and handoff notes agree",
      blocks: [
        wu,
        tool("Read wisdom/csv.md"),
        wc,
        tool("Add quoted-newline test"),
        tool("Run import tests"),
        tool("Update wisdom/csv.md"),
        prose("Added the quoted-newline test and saved cache invalidation as the next step in wisdom/csv.md."),
      ],
    },
  ],
};

export function demoDuration(id: DemoId): number {
  return id === "background" ? 21000 : 20000;
}

// Scripted glyphs are all single-width: ASCII, braille, prompt icon, ✓, ↗ and ▸.
// No emoji, combining marks, tabs, escape sequences or double-width glyphs.
function line(text: string, style: string, cols: number): Cell[] {
  const glyphs = [...text];
  return Array.from({ length: cols }, (_, x) => ({ text: glyphs[x] ?? " ", style }));
}
function wrap(text: string, width: number): string[] {
  if (width < 1) return [];
  const result: string[] = [];
  for (const paragraph of text.split("\n")) {
    let rest = paragraph;
    while (rest.length > width) {
      let cut = rest.lastIndexOf(" ", width);
      if (cut < 1) cut = width;
      result.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^ +/, "");
    }
    result.push(rest);
  }
  return result;
}

export function demoFrame(id: DemoId, cols: number, elapsedMs: number): { rows: Cell[][]; stage: string } {
  cols = Math.max(0, Math.floor(cols));
  const height = demoHeight(cols);
  const elapsed = Math.min(
    demoDuration(id),
    Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : elapsedMs === Infinity ? demoDuration(id) : 0),
  );
  const shot = [...scripts[id]].reverse().find((s) => s.at <= elapsed) ?? scripts[id][0];
  const spin = spinner[Math.floor(elapsed / 80) % spinner.length];
  const rows = Array.from({ length: height }, () => line("", styles.text, cols));
  const transcript: Cell[][] = [];
  for (let i = 0; i < shot.blocks.length; i++) {
    const block = shot.blocks[i];
    const previous = shot.blocks[i - 1];
    if (i && (block.kind === "user" || previous.kind === "user" || block.kind === "prose"))
      transcript.push(line("", styles.text, cols));
    if (block.kind === "tool") {
      // Fullscreen bruv groups tools by user turn. The first tool owns the
      // count row; active turns append the latest action label. Task details
      // remain visible separately (protected by the real activity projector).
      const boundary = shot.blocks.slice(0, i).findLastIndex((b) => b.kind === "user");
      if (shot.blocks.slice(boundary + 1, i).some((b) => b.kind === "tool")) continue;
      const nextUser = shot.blocks.findIndex((b, index) => index > i && b.kind === "user");
      const tools = shot.blocks.slice(i, nextUser < 0 ? undefined : nextUser).filter((b) => b.kind === "tool");
      const latest = tools.at(-1)!;
      const label =
        tools.length +
        (tools.length === 1 ? " tool called ▸" : " tools called ▸") +
        (shot.busy ? " · " + latest.text : "");
      const clipped =
        label.length > cols ? label.slice(0, Math.max(0, cols - 3)) + ".".repeat(Math.min(3, cols)) : label;
      transcript.push(line(clipped, styles.text, cols));
    } else if (block.kind === "task") {
      if (block.state === "running") transcript.push(line("1 tool called ▸", styles.text, cols));
      const mark = block.state === "working" ? spin : block.state === "running" ? "↗" : "✓";
      const color = block.state === "done" ? styles.success : styles.accent;
      // Actual collapsed tool/task rows truncate instead of wrapping into cards.
      const cells = line(" " + mark + " " + block.text, color, cols);
      transcript.push(cells);
    } else {
      for (const text of wrap(block.text, Math.max(1, cols - 2)))
        transcript.push(line(" " + text, block.kind === "user" ? styles.user : styles.text, cols));
    }
  }
  const typed =
    shot.input?.slice(0, Math.floor(shot.input.length * Math.min(1, (elapsed - shot.at) / (shot.typeFor ?? 1)))) ?? "";
  const inputLines = wrap(typed, Math.max(1, cols - 2));
  // Reserve borderless editor, a blank separation row and one-row compact footer.
  const editorTop = height - 1 - inputLines.length;
  const available = Math.max(0, editorTop - 1);
  transcript.slice(Math.max(0, transcript.length - available)).forEach((row, y) => {
    rows[y] = row;
  });
  inputLines.forEach((text, i) => {
    const y = editorTop + i;
    if (y < 0) return;
    rows[y] = line((i === 0 ? (shot.busy ? spin : "") : " ") + " " + text, styles.text, cols);
    if (cols) rows[y][0].style = shot.busy ? styles.accent : styles.prompt;
  });
  if (!shot.busy && cols > 2) {
    const y = height - 2;
    const x = Math.min(cols - 1, 2 + inputLines[inputLines.length - 1].length);
    if (!shot.input || Math.floor(elapsed / 500) % 2 === 0) rows[y][x] = { text: " ", style: styles.cursor };
  }
  // Real compact-footer vocabulary/candidate order; no invented progress counters.
  const jobs = shot.jobs ?? 0;
  const full = "csv-app:main" + (jobs ? " · 1 task" : "") + " · $0.000 · ctx 4%";
  const short = (jobs ? "1t " : "") + "$0.000 C4%";
  const left = full.length + 8 <= cols ? full : short;
  const footer = line(left, styles.dim, cols);
  const model = "studio";
  if (left.length + model.length + 2 <= cols)
    for (let i = 0; i < model.length; i++) footer[cols - model.length + i] = { text: model[i], style: styles.dim };
  if (jobs) {
    const start = left.indexOf(left === full ? "1 task" : "1t");
    const length = left === full ? 6 : 2;
    for (let x = start; x < Math.min(cols, start + length); x++) if (x >= 0) footer[x].style = styles.accent;
  }
  rows[height - 1] = footer;
  return { rows, stage: shot.stage };
}

/** Full readable story, without UI chrome or transient spinner/typing frames. */
export function demoTranscript(id: DemoId): string {
  const last = scripts[id][scripts[id].length - 1];
  return last.blocks
    .map((block) => {
      if (block.kind === "user") return "You: " + block.text;
      if (block.kind === "prose") return "bruv: " + block.text;
      return (block.state === "running" ? "↗ " : "✓ ") + block.text;
    })
    .join("\n\n");
}
