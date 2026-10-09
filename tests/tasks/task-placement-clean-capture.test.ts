import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PresentationTerminal } from "../../scripts/tui/task-placement-clean-capture";

function recording() {
  const artifacts = mkdtempSync(join(tmpdir(), "bruv-clean-terminal-test-"));
  const calls: string[][] = [];
  const viewport = "\x1b[32m/questions /close\x1b[0m\nVisible output";
  const scrollback = "Original scrollback\n" + viewport;
  let completion = ["1:0:"];
  let failCapture = false;
  let failStart = false;
  const terminal = new PresentationTerminal(
    (...args) => {
      calls.push(args);
      if (args[0] === "new-session" && failStart) throw Error("start failed");
      if (args[0] === "capture-pane") {
        if (failCapture) throw Error("pane gone");
        return args.includes("-S") ? scrollback : viewport;
      }
      if (args.at(-1) === "#{pane_dead}:#{pane_dead_status}:#{pane_dead_signal}")
        return completion.length > 1 ? completion.shift()! : completion[0];
      return "";
    },
    () => calls.push(["kill-server"]),
    artifacts,
  );
  return {
    artifacts,
    calls,
    terminal,
    viewport,
    scrollback,
    completion(...states: string[]) {
      completion = states;
    },
    failCapture() {
      failCapture = true;
    },
    failStart() {
      failStart = true;
    },
    clean() {
      rmSync(artifacts, { recursive: true, force: true });
    },
  };
}

const json = (dir: string, name: string) => JSON.parse(readFileSync(join(dir, name), "utf8"));

test("fixed PTY, literal input, and unfiltered evidence with a separate assertion view", async () => {
  const r = recording();
  try {
    r.terminal.start("reviewed command", "/disposable/repo");
    expect(r.calls[0]).toEqual([
      "new-session",
      "-d",
      "-s",
      "root-placement",
      "-x",
      "120",
      "-y",
      "40",
      "-c",
      "/disposable/repo",
      "reviewed command",
      ";",
      "set-option",
      "-w",
      "-t",
      "root-placement",
      "remain-on-exit",
      "on",
      ";",
      "set-option",
      "-w",
      "-t",
      "root-placement",
      "remain-on-exit-format",
      "",
    ]);
    await r.terminal.ready();
    r.terminal.type("a 'literal' prompt; not shell input");
    expect(r.calls.slice(-2)).toEqual([
      ["send-keys", "-t", "root-placement", "-l", "a 'literal' prompt; not shell input"],
      ["send-keys", "-t", "root-placement", "Enter"],
    ]);
    expect(r.terminal.view()).toBe("/questions /close\nVisible output");
    r.terminal.capture("02-work", "helper review", 8);
    expect(readFileSync(join(r.artifacts, "02-work.viewport.txt"), "utf8")).toBe(r.viewport);
    expect(readFileSync(join(r.artifacts, "diagnostics", "02-work.scrollback.txt"), "utf8")).toBe(r.scrollback);
    expect(r.calls.slice(-2)).toEqual([
      ["capture-pane", "-e", "-p", "-S", "-", "-t", "root-placement"],
      ["capture-pane", "-e", "-p", "-t", "root-placement"],
    ]);
    const timeline = json(r.artifacts, "timeline.json");
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toEqual({
      step: "02-work",
      caption: "helper review",
      t: 8,
      path: "02-work.viewport.txt",
      capturedAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(timeline[0].capturedAt))).toBe(false);
    r.terminal.captureFinalAndStop(true);
    expect(readFileSync(join(r.artifacts, "final-pane.viewport.txt"), "utf8")).toBe(r.viewport);
    expect(json(r.artifacts, "timeline.json")).toEqual(timeline);
    expect(r.calls.at(-1)).toEqual(["kill-server"]);
  } finally {
    r.clean();
  }
});

test("detach proves zero exit and captures the last view before removal; reopen keeps the timeline", async () => {
  const r = recording();
  try {
    r.terminal.start("reviewed command", "/disposable/repo");
    await r.terminal.detach("05-detached", "Detach locally", 34);
    expect(r.calls.slice(-5)).toEqual([
      ["send-keys", "-t", "root-placement", "C-d"],
      ["display-message", "-p", "-t", "root-placement", "#{pane_dead}:#{pane_dead_status}:#{pane_dead_signal}"],
      ["capture-pane", "-e", "-p", "-S", "-", "-t", "root-placement"],
      ["capture-pane", "-e", "-p", "-t", "root-placement"],
      ["kill-session", "-t", "root-placement"],
    ]);
    const detachedCalls = r.calls.length;
    r.terminal.captureFinalAndStop(false);
    expect(r.calls).toHaveLength(detachedCalls);
    r.terminal.start("reviewed command", "/disposable/repo");
    r.terminal.capture("06-reopened", "Same question", 40);
    expect(json(r.artifacts, "timeline.json").map((s: { step: string; t: number }) => [s.step, s.t])).toEqual([
      ["05-detached", 34],
      ["06-reopened", 40],
    ]);
    r.terminal.captureFinalAndStop(true);
    expect(r.calls.filter((c) => c[0] === "kill-server")).toHaveLength(1);
  } finally {
    r.clean();
  }
});

test("detach waits for the reaped child after PTY EOF", async () => {
  const r = recording();
  try {
    r.terminal.start("reviewed command", "/disposable/repo");
    r.completion("0::", "1::", "1:0:");
    await r.terminal.detach("05-detached", "Detach locally", 34);
    const reads = r.calls.filter((c) => c[0] === "display-message");
    expect(reads).toHaveLength(3);
    expect(r.calls.indexOf(reads.at(-1)!)).toBeLessThan(r.calls.findIndex((c) => c[0] === "capture-pane"));
    expect(json(r.artifacts, "timeline.json")).toHaveLength(1);
    expect(r.calls.at(-1)).toEqual(["kill-session", "-t", "root-placement"]);
  } finally {
    r.clean();
  }
});

test.each(["1:1:", "1::15"])("failed detach %s retains failure evidence and cleanup", async (completion) => {
  const r = recording();
  try {
    r.terminal.start("reviewed command", "/disposable/repo");
    r.completion("1::", completion);
    await expect(r.terminal.detach("05-detached", "Detach locally", 34)).rejects.toThrow();
    expect(readdirSync(r.artifacts)).toEqual([]);
    expect(r.calls.some((c) => c[0] === "kill-session")).toBe(false);
    r.terminal.captureFinalAndStop(false);
    expect(readFileSync(join(r.artifacts, "failure-pane.viewport.txt"), "utf8")).toBe(r.viewport);
    expect(r.calls.at(-1)).toEqual(["kill-server"]);
    expect(readdirSync(r.artifacts)).not.toContain("timeline.json");
  } finally {
    r.clean();
  }
});

test("a missing final pane still releases the tmux server", () => {
  const r = recording();
  try {
    r.terminal.start("reviewed command", "/disposable/repo");
    r.failCapture();
    expect(() => r.terminal.captureFinalAndStop(false)).not.toThrow();
    expect(r.calls.at(-1)).toEqual(["kill-server"]);
  } finally {
    r.clean();
  }
});

test("start failure does not claim ownership of a started PTY", () => {
  const r = recording();
  try {
    r.failStart();
    expect(() => r.terminal.start("reviewed command", "/disposable/repo")).toThrow("start failed");
    r.terminal.captureFinalAndStop(false);
    expect(r.calls).toHaveLength(1);
    expect(readdirSync(r.artifacts)).toEqual([]);
  } finally {
    r.clean();
  }
});

// tmux is already required by the capture producer. No CLI, container, or provider is started here.
test.each([
  ["normal exit", ""],
  ["EOF before child exit", "; trap '' HUP; exec 0<&- 1>&- 2>&-; sleep 0.2; exit 0"],
])("native isolated PTY preserves dimensions, detach/reopen and evidence files (%s)", async (_label, finish) => {
  const root = mkdtempSync(join(tmpdir(), "bruv-clean-native-pty-test-"));
  const home = join(root, "home");
  const agent = join(root, "agent");
  const artifacts = join(root, "artifacts");
  for (const dir of [home, agent, artifacts]) mkdirSync(dir);
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    BRUV_CODING_AGENT_DIR: agent,
    TMPDIR: root,
    TERM: "xterm-256color",
    LANG: "C.UTF-8",
    SHELL: "/bin/sh",
  };
  const socket = join(root, "tmux.sock");
  const raw = (...args: string[]) =>
    spawnSync("tmux", ["-f", "/dev/null", "-S", socket, ...args], { env, encoding: "utf8" });
  const run = (...args: string[]) => {
    const result = raw(...args);
    expect(result.status).toBe(0);
    return result.stdout.trim();
  };
  const terminal = new PresentationTerminal(run, () => raw("kill-server"), artifacts);
  const command = "printf '\\033[32m/questions /close\\033[0m\\n'; cat" + finish;
  try {
    terminal.start(command, root);
    await terminal.ready();
    expect(run("display-message", "-p", "-t", "root-placement", "#{pane_width}x#{pane_height}")).toBe("120x40");
    terminal.capture("01-start", "Native PTY smoke", 0);
    await terminal.detach("05-detached", "Detach", 34);
    terminal.start(command, root);
    await terminal.ready();
    terminal.capture("06-reopened", "Reopen", 40);
    terminal.captureFinalAndStop(true);
    expect(json(artifacts, "timeline.json").map((s: { step: string; t: number }) => [s.step, s.t])).toEqual([
      ["01-start", 0],
      ["05-detached", 34],
      ["06-reopened", 40],
    ]);
    for (const step of ["01-start", "05-detached", "06-reopened", "final-pane"]) {
      expect(readFileSync(join(artifacts, step + ".viewport.txt"), "utf8")).toContain("/questions /close");
      expect(readFileSync(join(artifacts, "diagnostics", step + ".scrollback.txt"), "utf8")).toContain(
        "/questions /close",
      );
    }
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(agent)).toEqual([]);
  } finally {
    raw("kill-server");
    rmSync(root, { recursive: true, force: true });
  }
});
