import { requireValue } from "./require-value";
export type Cell = { text: string; style: string };

/**
 * Scripted, shortened conversations, not recorded model output. Each piece copies bruv 1.0's UI:
 * tool lines from src/activity.ts, the work board from src/board.ts, check results and the receipt
 * frame from src/finish-render.ts and src/receipt.ts, the editor from src/editor.ts and the footer
 * from src/footer.ts. Colors are Pi's dark theme in truecolor. The prompt mark is the Nerd Font
 * icon U+F460, bundled as a small webfont subset. Board times run faster than real time.
 */
export const demoIds = ["voice", "keep", "check"] as const;
export type DemoId = (typeof demoIds)[number];
export const demoHeight = (cols: number): number => (cols < 60 ? 27 : 23);

const rgb = (r: number, g: number, b: number) => `38;2;${r};${g};${b}`;
const background = "48;2;20;24;32";
const styles = {
  text: `${rgb(222, 224, 225)};${background}`,
  dim: `${rgb(126, 136, 142)};${background}`,
  prompt: `${rgb(108, 118, 123)};${background}`,
  accent: `${rgb(167, 152, 215)};${background}`,
  success: `${rgb(104, 183, 141)};${background}`,
  error: `${rgb(234, 127, 129)};${background}`,
  user: `${rgb(222, 224, 225)};48;2;33;59;73`,
  cursor: `${rgb(20, 24, 32)};48;2;222;224;225`,
};
// Nerd Font chevron, as in src/editor.ts.
const PROMPT = "\uf460";
const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
// Board times move this many times faster than the demo clock.
const BOARD_SPEED = 6;

type Block =
  | { kind: "user"; text: string }
  | { kind: "note"; text: string }
  | { kind: "prose"; text: string }
  | { kind: "tools"; count: number; label?: string }
  | { kind: "gaps"; gaps: string[] }
  | { kind: "receipt"; lines: string[] };
type Work = { id: string; title: string; since: number; done?: number; detail?: string };
type Shot = {
  at: number;
  stage: string;
  blocks: Block[];
  input?: string;
  typeFor?: number;
  busy?: boolean;
  board?: Work[];
  /** What `show` put above the input: a title, a small chart or nothing, and a link. */
  shown?: { title: string; bars?: number[]; link: string };
  /** Voice is on, as the footer shows. */
  voice?: boolean;
};
const user = (text: string): Block => ({ kind: "user", text });
const prose = (text: string): Block => ({ kind: "prose", text });
const tools = (count: number, label?: string): Block => ({ kind: "tools", count, label });
const note = (text: string): Block => ({ kind: "note", text });

// Voice: what you say shows as your message; replies are spoken as they stream.
const vOn = note("Voice is on. Just talk; /voice again turns it off.");
const vAsk = user("show me how signups did this month");
const vChart = prose("Signups grew 18% this month, most of it in week two. The chart is in your terminal.");
const vWhy = user("why the jump in week two?");
const vCut = prose("The newsletter went out on the 14th, and signups doubled over the next");
const vStop = user("ok, show me that newsletter");
const vPage = prose("It's on screen. The subject line was the free plan announcement.");
const signups = { title: "Signups this month", bars: [2, 3, 3, 4, 7, 8, 6, 5, 5, 6, 6, 7], link: "Open the picture" };
const newsletter = { title: "March newsletter", link: "Open the page in the browser" };

const keepPrompt = "the export button on reports is broken. fix it and add tests";
const ku = user(keepPrompt);
const kp = prose("Export used the old column names. Fixed the mapping. Next: tests for empty and large reports.");
const kDone = prose("Export works again. Added tests for empty and 10k-row reports. All 48 report tests pass.");

const checkPrompt = "go through checkout like a real customer and fix whatever breaks";
const cu = user(checkPrompt);
const cp = prose("Fixed the coupon field and the address form. Everything I tried works.");
const gaps: Block = {
  kind: "gaps",
  gaps: ["A declined card clears the whole form.", "Guest checkout wasn't tried."],
};
const receipt: Block = {
  kind: "receipt",
  lines: [
    "Done · 6m · 41 calls · 2 agents",
    `Asked:   ${checkPrompt}`,
    "✓ A declined card keeps the form filled",
    "✓ Guest checkout places an order",
    "✓ Coupon and address fixes hold in a real browser",
    "Changed: 6 files, +182 −37",
  ],
};
const check = (since: number, done?: number): Work => ({ id: "a1", title: "check", since, done, detail: checkPrompt });
const recheck = (since: number, done?: number): Work => ({
  id: "a2",
  title: "check",
  since,
  done,
  detail: checkPrompt,
});

const scripts: Record<DemoId, Shot[]> = {
  voice: [
    { at: 0, stage: "Turn voice on", blocks: [], input: "/voice", typeFor: 900 },
    { at: 1300, stage: "Voice is on", blocks: [vOn], voice: true },
    { at: 2600, stage: "Just talk", blocks: [vOn, vAsk], busy: true, voice: true },
    { at: 3600, stage: "It works on it", blocks: [vOn, vAsk, tools(2, "Query signups")], busy: true, voice: true },
    {
      at: 5600,
      stage: "It shows you things",
      blocks: [vOn, vAsk, tools(3), vChart],
      shown: signups,
      voice: true,
    },
    {
      at: 8200,
      stage: "Ask a follow-up",
      blocks: [vOn, vAsk, tools(3), vChart, vWhy, tools(1, "Read campaign log")],
      busy: true,
      shown: signups,
      voice: true,
    },
    {
      at: 9600,
      stage: "It answers out loud",
      blocks: [vOn, vAsk, tools(3), vChart, vWhy, tools(1), vCut],
      busy: true,
      shown: signups,
      voice: true,
    },
    {
      at: 11000,
      stage: "Talk over it to cut in",
      blocks: [vOn, vAsk, tools(3), vChart, vWhy, tools(1), vCut, vStop, tools(1, "Show newsletter")],
      busy: true,
      shown: signups,
      voice: true,
    },
    {
      at: 13400,
      stage: "It stops and answers that",
      blocks: [vOn, vAsk, tools(3), vChart, vWhy, tools(1), vCut, vStop, tools(2), vPage],
      shown: newsletter,
      voice: true,
    },
  ],
  keep: [
    { at: 0, stage: "Type a loose request", blocks: [], input: keepPrompt, typeFor: 2600 },
    { at: 2900, stage: "Find the cause", blocks: [ku, tools(1, "Read reports page")], busy: true },
    { at: 4300, stage: "Fix it", blocks: [ku, tools(4, "Run report tests")], busy: true },
    { at: 6000, stage: "Report progress and keep going", blocks: [ku, tools(4), kp], busy: true },
    { at: 7900, stage: "Write the tests", blocks: [ku, tools(4), kp, tools(3, "Add empty report test")], busy: true },
    { at: 10200, stage: "Run the tests", blocks: [ku, tools(4), kp, tools(6, "Run report tests")], busy: true },
    { at: 12600, stage: "Finished, not paused", blocks: [ku, tools(4), kp, tools(6), kDone] },
  ],
  check: [
    { at: 0, stage: "Ask for a full pass", blocks: [], input: checkPrompt, typeFor: 2800 },
    { at: 3100, stage: "Work through checkout", blocks: [cu, tools(8, "Open checkout in browser")], busy: true },
    { at: 5000, stage: "The model says it's done", blocks: [cu, tools(8), cp], busy: true },
    {
      at: 5900,
      stage: "A fresh agent checks",
      blocks: [cu, tools(8), cp],
      busy: true,
      board: [check(5900)],
    },
    {
      at: 8600,
      stage: "The check finds gaps",
      blocks: [cu, tools(8), cp, gaps],
      busy: true,
      board: [check(5900, 8600)],
    },
    {
      at: 9800,
      stage: "Fix the gaps",
      blocks: [cu, tools(8), cp, gaps, tools(3, "Keep card form on error")],
      busy: true,
      board: [check(5900, 8600)],
    },
    {
      at: 11600,
      stage: "Check again",
      blocks: [cu, tools(8), cp, gaps, tools(5)],
      busy: true,
      board: [check(5900, 8600), recheck(11600)],
    },
    {
      at: 14000,
      stage: "Checked, with a receipt",
      blocks: [cu, tools(8), cp, gaps, tools(5), receipt],
      board: [check(5900, 8600), recheck(11600, 14000)],
    },
  ],
};

export function demoDuration(id: DemoId): number {
  return requireValue(scripts[id].at(-1)).at + 4000;
}

// Scripted glyphs are all single-width: ASCII, braille, box drawing, ✓, ✗, ·, − and the prompt icon.
function line(text: string, style: string, cols: number): Cell[] {
  const glyphs = [...text];
  return Array.from({ length: cols }, (_, x) => ({ text: glyphs[x] ?? " ", style }));
}
function wrap(text: string, width: number): string[] {
  if (width < 1) return [];
  const result: string[] = [];
  for (const paragraph of text.split("\n")) {
    let rest = paragraph;
    while ([...rest].length > width) {
      let cut = rest.lastIndexOf(" ", width);
      if (cut < 1) cut = width;
      result.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^ +/, "");
    }
    result.push(rest);
  }
  return result;
}
const clip = (text: string, width: number) =>
  [...text].length > width ? `${[...text].slice(0, Math.max(0, width - 1)).join("")}…` : text;
const elapsedLabel = (ms: number) => {
  const seconds = Math.max(0, Math.floor((ms * BOARD_SPEED) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
};

function transcriptRows(shot: Shot, cols: number): Cell[][] {
  const rows: Cell[][] = [];
  const lastTools = shot.blocks.findLastIndex((block) => block.kind === "tools");
  for (const [i, block] of shot.blocks.entries()) {
    if (i > 0) rows.push(line("", styles.text, cols));
    if (block.kind === "tools") {
      const label = shot.busy && i === lastTools && block.label ? ` · ${block.label}` : "";
      rows.push(
        line(clip(`${block.count} ${block.count === 1 ? "tool" : "tools"} called${label}`, cols), styles.dim, cols),
      );
    } else if (block.kind === "gaps") {
      rows.push(line(` ✗ Check found ${block.gaps.length} gaps`, styles.error, cols));
      for (const gap of block.gaps)
        for (const [n, text] of wrap(gap, Math.max(1, cols - 4)).entries())
          rows.push(line(`${n ? "   " : " - "}${text}`, styles.text, cols));
      rows.push(line(" Fixing, then checking again.", styles.dim, cols));
    } else if (block.kind === "receipt") {
      const inner = Math.max(1, cols - 6);
      const edge = (left: string, right: string) => {
        const row = line(` ${left}${"─".repeat(Math.max(0, cols - 4))}${right}`, styles.accent, cols);
        return row;
      };
      rows.push(edge("╭", "╮"));
      for (const text of block.lines.flatMap((entry) => wrap(entry, inner))) {
        const row = line(` │ ${text.padEnd(inner)} │`, styles.text, cols);
        row[1] = { text: "│", style: styles.accent };
        if (cols > 3) row[cols - 2] = { text: "│", style: styles.accent };
        if (text.startsWith("✓") && row[3]) row[3] = { text: "✓", style: styles.success };
        rows.push(row);
      }
      rows.push(edge("╰", "╯"));
    } else {
      const style = block.kind === "user" ? styles.user : block.kind === "note" ? styles.dim : styles.text;
      for (const text of wrap(block.text, Math.max(1, cols - 2))) rows.push(line(` ${text}`, style, cols));
    }
  }
  return rows;
}

function boardRows(shot: Shot, cols: number, elapsed: number, spin: string): Cell[][] {
  return (shot.board ?? []).map((work) => {
    const running = work.done === undefined;
    const time = elapsedLabel((running ? elapsed : (work.done as number)) - work.since);
    const parts = [work.id, work.title, ...(running && work.detail ? [work.detail] : []), time];
    const mark = running ? spin : "✓";
    const row = line(` ${mark} ${clip(parts.join(" · "), Math.max(1, cols - 3))}`, styles.text, cols);
    row[1] = { text: mark, style: running ? styles.accent : styles.success };
    // The time is dim, like the real board.
    const text = row.map((cell) => cell.text).join("");
    const at = text.lastIndexOf(time);
    for (let x = at; x >= 0 && x < at + time.length && x < cols; x++) row[x].style = styles.dim;
    return row;
  });
}

/** The shown thing above the input: a title, a small bar chart standing in for the picture, and its link. */
function shownRows(shot: Shot, cols: number): Cell[][] {
  if (!shot.shown) return [];
  const { title, bars, link } = shot.shown;
  const head = line(clip(` ▍ ${title}`, cols), styles.text, cols);
  if (cols > 1) head[1] = { text: "▍", style: styles.accent };
  // Three rows of blocks, each row three steps high, like a tiny bar chart.
  const cell = (value: number, row: number) => {
    const fill = value - (row - 1) * 3;
    return fill >= 3 ? "█" : fill === 2 ? "▆" : fill === 1 ? "▃" : " ";
  };
  const chart = bars
    ? [3, 2, 1].map((row) => line(`   ${bars.map((value) => cell(value, row)).join(" ")}`, styles.accent, cols))
    : [];
  return [head, ...chart, line(clip(`   ${link}`, cols), styles.accent, cols)];
}

function footerRow(cols: number, voice = false): Cell[] {
  // The compact footer's first fitting layout: project:branch · voice · price · context, then the model.
  const on = voice ? " · ● voice" : "";
  const tries: [string, string][] = [
    [`shop:main${on} · $0.42 api · ctx 18%`, "gpt-6-astra · high"],
    [`shop${on} · $0.42 api · ctx 18%`, "gpt-6-astra · high"],
    [`$0.42 api${on} · ctx 18%`, "gpt-6-astra"],
    [`ctx 18%${on}`, "gpt-6-astra"],
  ];
  const [left, right] = tries.find(([l, r]) => l.length + 2 + r.length <= cols) ?? ["ctx 18%", ""];
  const footer = line(left, styles.dim, cols);
  const dot = left.indexOf("●");
  if (dot >= 0 && dot < cols) footer[dot] = { text: "●", style: styles.accent };
  if (right)
    for (let i = 0; i < right.length; i++) footer[cols - right.length + i] = { text: right[i], style: styles.dim };
  return footer;
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
  const transcript = transcriptRows(shot, cols);
  // Like bruv's widgets, the board and the shown thing sit above the editor.
  const board = [...shownRows(shot, cols), ...boardRows(shot, cols, elapsed, spin)];
  const typed =
    shot.input?.slice(0, Math.floor(shot.input.length * Math.min(1, (elapsed - shot.at) / (shot.typeFor ?? 1)))) ?? "";
  const inputLines = wrap(typed, Math.max(1, cols - 2));
  // Bottom up: footer, borderless editor, the board above it, one blank row, then the transcript.
  const editorTop = height - 1 - inputLines.length;
  const boardTop = editorTop - board.length - (board.length ? 1 : 0);
  board.forEach((row, i) => {
    if (boardTop + i >= 0) rows[boardTop + i] = row;
  });
  const available = Math.max(0, boardTop - 1);
  transcript.slice(Math.max(0, transcript.length - available)).forEach((row, y) => {
    rows[y] = row;
  });
  inputLines.forEach((text, i) => {
    const y = editorTop + i;
    if (y < 0) return;
    rows[y] = line(`${i === 0 ? (shot.busy ? spin : PROMPT) : " "} ${text}`, styles.text, cols);
    if (cols) rows[y][0].style = shot.busy ? styles.accent : styles.prompt;
  });
  if (!shot.busy && cols > 2) {
    const y = height - 2;
    const x = Math.min(cols - 1, 2 + [...inputLines[inputLines.length - 1]].length);
    if (!shot.input || Math.floor(elapsed / 500) % 2 === 0) rows[y][x] = { text: " ", style: styles.cursor };
  }
  rows[height - 1] = footerRow(cols, shot.voice);
  return { rows, stage: shot.stage };
}

/** The whole story as plain text, without UI chrome, spinners or typing. */
export function demoTranscript(id: DemoId): string {
  const last = requireValue(scripts[id].at(-1));
  return last.blocks
    .map((block) => {
      if (block.kind === "user" || block.kind === "prose")
        return `${block.kind === "user" ? "You" : "bruv"}: ${block.text}`;
      if (block.kind === "note") return block.text;
      if (block.kind === "tools") return `(${block.count} ${block.count === 1 ? "tool" : "tools"} called)`;
      if (block.kind === "gaps")
        return [`Check found ${block.gaps.length} gaps:`, ...block.gaps.map((gap) => `- ${gap}`)].join("\n");
      return block.lines.join("\n");
    })
    .join("\n\n");
}
