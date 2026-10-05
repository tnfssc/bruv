import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { IDLE_PROMPT_ICON } from "../src/ui/editor";
import { capturePane, shellQuote as quote, tmuxRunner } from "./tui-helpers";

const promptRow = (lines: string[]) => lines.findIndex((line) => line.startsWith(IDLE_PROMPT_ICON));
const footerRow = (lines: string[]) => lines.findIndex((line) => line.includes("gpt-4o") && line.includes("$0.000"));

function hasCompleteDraft(lines: string[], draft: string): boolean {
  const prompt = promptRow(lines),
    footer = footerRow(lines);
  if (prompt < 0 || footer <= prompt) return false;
  // These fixtures have no trailing spaces. Remove only the prompt gutter and
  // concatenate visible content: wrapping/newline placement is asserted later.
  const content = lines
    .slice(prompt, footer)
    .map((line) => line.slice(2))
    .join("");
  return content === draft.replaceAll("\n", "");
}

const fixtureFooter = "gpt-4o $0.000";
test("draft readiness rejects partial wrapped and multiline input", () => {
  const draft = "x".repeat(150);
  expect(hasCompleteDraft([IDLE_PROMPT_ICON + " " + draft.slice(0, 30), fixtureFooter], draft)).toBe(false);
  expect(
    hasCompleteDraft([IDLE_PROMPT_ICON + " " + draft.slice(0, 118), "  " + draft.slice(118), fixtureFooter], draft),
  ).toBe(true);
  expect(hasCompleteDraft([IDLE_PROMPT_ICON + " first", fixtureFooter], "first\nsecond\nthird")).toBe(false);
  expect(
    hasCompleteDraft([IDLE_PROMPT_ICON + " first", "  second", "  third", fixtureFooter], "first\nsecond\nthird"),
  ).toBe(true);
});

test("draft readiness accepts complete content even with incorrect layout", () => {
  // Readiness must not wait away a row-count, blank-row or multiline regression.
  expect(hasCompleteDraft([IDLE_PROMPT_ICON + " " + "x".repeat(150), fixtureFooter], "x".repeat(150))).toBe(true);
  expect(hasCompleteDraft([IDLE_PROMPT_ICON + " spacing-draft", "", fixtureFooter], "spacing-draft")).toBe(true);
  expect(hasCompleteDraft([IDLE_PROMPT_ICON + " firstsecondthird", fixtureFooter], "first\nsecond\nthird")).toBe(true);
});

for (const mode of ["fullscreen", "regular"] as const) {
  test("real terminal prompt/footer adjacency: " + mode, async () => {
    const home = await mkdtemp(join(tmpdir(), "bruv-editor-spacing-"));
    const socket = "bruv-spacing-" + mode + "-" + process.pid + "-" + Date.now();
    const artifactDir = resolve(import.meta.dir, "../artifacts/tui", socket);
    const tmux = tmuxRunner(socket, join(home, "tmux.conf"));

    const frames: Record<string, string> = {};
    async function frameWhen(predicate: (lines: string[]) => boolean): Promise<string[]> {
      let lines: string[] = [];
      for (let attempt = 0; attempt < 100; attempt++) {
        const capture = await capturePane(tmux, "spacing");
        expect(capture.code).toBe(0);
        lines = capture.stdout
          .replace(/\n$/, "")
          .split("\n")
          .map((line) => line.trimEnd());
        if (predicate(lines)) return lines;
        await Bun.sleep(50);
      }
      throw new Error("Expected terminal frame not reached:\n" + lines.join("\n"));
    }

    async function pasteDraft(draft: string) {
      const paste = join(home, "draft.txt");
      await writeFile(paste, draft);
      expect((await tmux("load-buffer", paste)).code).toBe(0);
      expect((await tmux("paste-buffer", "-p", "-r", "-t", "spacing")).code).toBe(0);
    }
    try {
      await writeFile(join(home, "tmux.conf"), "set -g extended-keys on\nset -g extended-keys-format csi-u\n");
      const launch = [
        "env",
        "HOME=" + home,
        "BRUV_CODING_AGENT_DIR=" + join(home, ".bruv", "agent"),
        "HERDR_ENV=0",
        "OPENAI_API_KEY=offline-test-placeholder",
        resolve(import.meta.dir, "../dist/bruv"),
        "--offline",
        "--no-approve",
        "--no-session",
        "--provider",
        "openai",
        "--model",
        "gpt-4o",
        ...(mode === "regular" ? ["--tui-mode", "regular"] : []),
      ]
        .map(quote)
        .join(" ");
      expect((await tmux("new-session", "-d", "-s", "spacing", "-x", "120", "-y", "40", "-c", home, launch)).code).toBe(
        0,
      );
      const idle = await frameWhen((lines) => promptRow(lines) >= 0 && footerRow(lines) >= 0);
      frames.idle = idle.join("\n");
      expect(idle).toHaveLength(40);
      expect(footerRow(idle) - promptRow(idle)).toBe(1);
      if (mode === "fullscreen") expect(footerRow(idle)).toBe(39);
      // Initial rendering precedes final shortcut binding.
      await Bun.sleep(500);
      for (const [name, draft, rows] of [
        ["short", "spacing-draft", 1],
        ["wrapped-two", "x".repeat(150), 2],
        ["wrapped-three", "x".repeat(270), 3],
        ["multiline", "first\nsecond\nthird", 3],
      ] as const) {
        if (name === "wrapped-two") {
          // Hold the rest of this paste until the old prefix-only wait matches.
          // That frame has one row, but does not yet contain the whole draft.
          await pasteDraft(draft.slice(0, 30));
          const partial = await frameWhen((lines) => lines[promptRow(lines)]?.includes(draft.slice(0, 30)) === true);
          frames[name + "-partial"] = partial.join("\n");
          expect(footerRow(partial) - promptRow(partial)).toBe(1);
          expect(hasCompleteDraft(partial, draft)).toBe(false);
          await pasteDraft(draft.slice(30));
        } else {
          await pasteDraft(draft);
        }
        const frame = await frameWhen((lines) => hasCompleteDraft(lines, draft));
        frames[name] = frame.join("\n");
        const prompt = promptRow(frame),
          footer = footerRow(frame);
        expect(footer - prompt).toBe(rows);
        expect(frame.slice(prompt, footer).every((line) => line.length > 0)).toBe(true);
        if (mode === "fullscreen") expect(footer).toBe(39);
        if (name === "multiline")
          expect(frame.slice(prompt, footer)).toEqual([IDLE_PROMPT_ICON + " first", "  second", "  third"]);
        // Pi interprets two clear shortcuts within 500ms as exit, even with a draft.
        await Bun.sleep(550);
        expect((await tmux("send-keys", "-t", "spacing", "C-c")).code).toBe(0);
        await frameWhen((lines) => lines[promptRow(lines)] === IDLE_PROMPT_ICON);
      }
      expect((await tmux("send-keys", "-t", "spacing", "-l", "/settings")).code).toBe(0);
      expect((await tmux("send-keys", "-t", "spacing", "Enter")).code).toBe(0);
      const dialog = await frameWhen((lines) => lines.some((line) => line.includes("Auto-compact")));
      frames["native-settings"] = dialog.join("\n");
      expect(promptRow(dialog)).toBe(-1);
      expect((await tmux("send-keys", "-t", "spacing", "Escape")).code).toBe(0);
      const restored = await frameWhen((lines) => lines[promptRow(lines)] === IDLE_PROMPT_ICON);
      frames.restored = restored.join("\n");
      expect(footerRow(restored) - promptRow(restored)).toBe(1);
    } finally {
      await mkdir(artifactDir, { recursive: true });
      for (const [name, frame] of Object.entries(frames))
        await writeFile(join(artifactDir, name + ".txt"), frame + "\n");
      await tmux("kill-server");
      await rm(home, { recursive: true, force: true });
    }
  }, 20_000);
}
