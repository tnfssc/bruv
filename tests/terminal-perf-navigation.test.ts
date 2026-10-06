import { describe, expect, test } from "bun:test";
import { createToolWorkload } from "../scripts/terminal-perf/tool-workloads";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { disposeDiskBackedSessionManager } from "../src/history/session-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  createNavigationHistory,
  createNavigationWorkloads,
  navigationModes,
  type NavigationSample,
} from "../scripts/terminal-perf/navigation-workloads";

// Functional assertions only. Runtime budgets belong to opt-in evidence runs, not CI.
function check(sample: NavigationSample) {
  expect(sample.frames.length).toBeGreaterThan(0);
  expect(sample.frames.every((frame) => !frame.failed)).toBe(true);
  expect(sample.changedRows).toBeGreaterThan(0);
  expect(sample.outputBytes).toBeGreaterThan(0);
  expect(sample.outputWrites).toBeGreaterThan(0);
  expect(sample.work.documentRenders).toBeGreaterThan(0);
  expect(sample.work.componentRenders).toBeGreaterThan(0);
  expect(sample.state.diskBacked).toBe(true);
  for (const digest of [sample.contentHash, sample.screenHash, sample.outputHash, sample.state.editorTextHash])
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  for (const segment of sample.segments) expect(segment.durationMs).toBeGreaterThanOrEqual(0);
  expect(sample.synchronousMs).toBeGreaterThanOrEqual(0);
  expect(sample.schedulerDelayMs).not.toBeNull();
}

describe("scheduled provider-free navigation workloads", () => {
  test("catalog is short-session first, filterable, and validates history sizes", () => {
    expect(createNavigationWorkloads().map((f) => f.mode)).toEqual([...navigationModes]);
    expect(createNavigationWorkloads({ sizes: [4], modes: ["search"] }).map((f) => f.name)).toEqual([
      "navigation/search/4",
    ]);
    expect(createNavigationWorkloads({ sizes: [] })).toEqual([]);
    expect(() => createNavigationWorkloads({ sizes: [0] })).toThrow("positive integers");
  });

  for (const mode of navigationModes)
    test(mode + " changes visible rows through actual scheduled frames", async () => {
      const fixture = createNavigationWorkloads({ sizes: [4], modes: [mode] })[0]!;
      try {
        const cold = await fixture.setup();
        check(cold);
        const a = await fixture.step();
        check(a);
        const b = await fixture.step();
        check(b);
        const c = await fixture.step();
        check(c);
        expect(a.contentHash).toBe(cold.contentHash);
        expect(a.screenHash).not.toBe(cold.screenHash);
        if (["scroll-page", "scroll-wheel"].includes(mode)) {
          expect(a.state.scrollTop).toBeLessThan(cold.state.scrollTop);
          expect(b.state.scrollTop).toBe(cold.state.scrollTop);
          expect(a.work.inputDispatches).toBe(1);
        }
        if (mode === "search") {
          expect(a.state.searchMatches).toBeGreaterThan(0);
          expect(b.state.searchMatches).toBe(a.state.searchMatches);
          expect(c.state.searchMatches).toBe(0);
          expect(a.state.editorCharacters).toBe(0); // query reached search overlay, NOT editor
          expect(a.frames[0]!.phasesMs["refreshSearch"]).toBeGreaterThanOrEqual(0);
        }
        if (mode === "tool-detail") {
          expect(a.state.toolExpanded).toBe(true);
          expect(b.state.toolExpanded).toBe(false);
          expect(a.state.scrollTop).toBeGreaterThan(b.state.scrollTop);
          expect(a.segments[0]!.name).toBe("ToolExecutionComponent.setExpanded");
        }
        if (mode === "editor-expand") {
          expect(a.work.inputDispatches).toBe(2);
          expect(a.state.editorLines).toBe(2);
          expect(b.state.editorLines).toBe(3);
        }
        if (mode === "editor-paste") {
          expect(a.work.inputDispatches).toBe(1);
          expect(a.state.editorCharacters).toBeGreaterThan(1000);
          expect(b.state.editorCharacters).toBeGreaterThan(a.state.editorCharacters);
        }
        if (mode === "mouse-selection") {
          expect(a.work.inputDispatches).toBe(3);
          expect(a.state.hasSelection).toBe(true);
        }
        if (mode === "session-reopen" || mode === "branch-switch") {
          expect(a.state.leafId).toBe("alternate");
          expect(b.state.leafId).toBe("a3");
          expect(a.work.branchEntries).toBe(2);
          expect(b.work.branchEntries).toBe(8);
          expect(a.work.materializedMessages).toBe(2);
          expect(b.work.materializedMessages).toBe(8);
        }
      } finally {
        fixture.dispose();
      }
      await expect(fixture.step()).rejects.toThrow("setup()");
    });

  test("tool then navigation disposal restores the concrete shared theme", async () => {
    const tool = createToolWorkload({ shape: "short", historySize: 0 });
    try {
      tool.setup();
    } finally {
      tool.dispose();
    }
    const navigation = createNavigationWorkloads({ modes: ["theme"], sizes: [2] })[0]!;
    try {
      await navigation.setup();
      await navigation.step();
    } finally {
      navigation.dispose();
    }
    const theme = (globalThis as typeof globalThis & Record<symbol, { fg: (name: string, text: string) => string }>)[
      Symbol.for("@earendil-works/pi-coding-agent:theme")
    ];
    expect(theme).toBeDefined();
    expect(() => theme!.fg("dim", "ok")).not.toThrow();
  });

  test("sequential disposal restores theme and deterministic content/output fingerprints", async () => {
    const [a, b] = createNavigationWorkloads({ modes: ["theme", "editor-paste"] });
    let before: NavigationSample;
    try {
      before = await a!.setup();
      await expect(b!.setup()).rejects.toThrow("sequentially");
      await a!.step();
    } finally {
      a!.dispose();
    }
    try {
      const after = await a!.setup();
      expect(after.contentHash).toBe(before!.contentHash);
      expect(after.screenHash).toBe(before!.screenHash);
      expect(after.outputHash).toBe(before!.outputHash);
    } finally {
      a!.dispose();
      b!.dispose();
    }
  });

  test("disk history has a real persistent tree and deterministic bodies", () => {
    const a = createNavigationHistory(4),
      b = createNavigationHistory(4);
    try {
      expect(existsSync(a.file)).toBe(true);
      expect(a.contentHash).toBe(b.contentHash);
      const manager = SessionManager.open(a.file);
      expect(manager.getEntry(a.primaryLeaf)?.type).toBe("message");
      expect(manager.getEntry(a.alternateLeaf)?.parentId).toBe("u0");
      // Navigation setup installs the irreversible production disk adapter for this process.
      disposeDiskBackedSessionManager(manager);
    } finally {
      a.dispose();
      b.dispose();
    }
    expect(existsSync(a.file)).toBe(false);
  });

  test("offline SDK owns real navigate/resume/fork lifecycles without provider access", async () => {
    const open = SessionManager.open;
    // Real SDK prototype installers belong to a fresh process, as in the runner.
    // Other suites install product hooks in a different order than CLI startup.
    const script = `
      import { SessionManager } from "@earendil-works/pi-coding-agent";
      import { installDiskBackedSessionManager } from "./src/history/session-manager.ts";
      import { runOfflineNavigationSdkProbe } from "./scripts/terminal-perf/navigation-workloads.ts";
      installDiskBackedSessionManager();
      const open = SessionManager.open;
      const result = await runOfflineNavigationSdkProbe(4);
      if (SessionManager.open !== open) throw new Error("Scoped open instrumentation leaked");
      console.log(JSON.stringify(result));
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
    const result = JSON.parse(stdout) as Awaited<
      ReturnType<typeof import("../scripts/terminal-perf/navigation-workloads").runOfflineNavigationSdkProbe>
    >;
    expect(result.providerCalls).toBe(0);
    expect(result.fetchCalls).toBe(0);
    expect(result.diskBacked).toBe(true);
    expect(result.messages).toBe(8);
    expect(result.contextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.elapsed.map((e) => e.name)).toEqual([
      "AgentSession.navigateTree(primary,no-summary)",
      "AgentSession.navigateTree(alternate,no-summary)",
      "AgentSessionRuntime.switchSession(disk-file)",
      "AgentSessionRuntime.fork(primary,at)",
    ]);
    expect(result.segments.some((s) => s.name === "SessionManager.open")).toBe(true);
    expect(result.segments.some((s) => s.name === "SessionManager.buildSessionContext")).toBe(true);
    expect(SessionManager.open).toBe(open);
    expect(result.scope).toContain("no InteractiveMode");
  });
  test("initialized InteractiveMode terminal seam runs provider-free in an isolated process", async () => {
    const root = mkdtempSync(join(tmpdir(), "navigation-interactive-test-"));
    const report = join(root, "report.json");
    try {
      const child = Bun.spawn(
        [process.execPath, "scripts/terminal-perf/navigation-workloads.ts", "--interactive-sdk", "--out", report],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect({ exitCode, stderr: exitCode ? stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
      const result = await Bun.file(report).json();
      expect(result.providerCalls).toBe(0);
      expect(result.scope).toContain("real initialized InteractiveMode");
      expect(result.messages).toBe(8);
      expect(result.appInput.map((s: { name: string }) => s.name)).toEqual([
        "InteractiveMode.ctrl-o",
        "InteractiveMode.showSessionSelector",
        "InteractiveMode.session-selector.cancel",
        "InteractiveMode.showTreeSelector",
        "InteractiveMode.tree-selector.cancel",
      ]);
      for (const input of result.appInput) {
        expect(input.frames.length).toBeGreaterThan(0);
        expect(input.screenHash).toMatch(/^[a-f0-9]{64}$/);
        expect(input.outputBytes).toBeGreaterThan(0);
      }
      for (const name of [
        "InteractiveMode.init",
        "InteractiveMode.handleResumeSession(disk-file)",
        "AgentSessionRuntime.fork(primary,at)",
      ]) {
        expect(result.appStages.find((s: { name: string }) => s.name === name).frames.length).toBeGreaterThan(0);
      }
      expect(
        result.segments.some(
          (s: { name: string; operation: string }) =>
            s.name === "InteractiveMode.renderInitialMessages" &&
            s.operation === "InteractiveMode.handleResumeSession(disk-file)",
        ),
      ).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
