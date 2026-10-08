import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { capturePane, frameContaining } from "../helpers/tui-helpers";
import { createTerminalProcessFixture } from "../helpers/terminal-process-fixture";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function createSavedThread(home: string) {
  const session = SessionManager.create(home, join(home, "sessions"));
  for (let turn = 0; turn < 100; turn++) {
    session.appendMessage({ role: "user", content: "Saved turn " + turn, timestamp: Date.now() });
    for (let tool = 0; tool < 10; tool++) {
      const id = "saved-" + turn + "-" + tool;
      session.appendMessage({
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id,
            name: "execute",
            arguments: { label: "Read saved file " + id, code: 'console.log("DETAIL_' + id + '")' },
          },
        ],
        api: "openai-completions",
        provider: "openai",
        model: "gpt-4o",
        usage,
        stopReason: "toolUse",
        timestamp: Date.now(),
      });
      session.appendMessage({
        role: "toolResult",
        toolCallId: id,
        toolName: "execute",
        content: [{ type: "text", text: "DETAIL_" + id }],
        details: { exitCode: 0, stdout: "DETAIL_" + id, stderr: "", images: [] },
        isError: false,
        timestamp: Date.now(),
      });
    }
  }
  session.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "LONG_THREAD_READY" }],
    api: "openai-completions",
    provider: "openai",
    model: "gpt-4o",
    usage,
    stopReason: "stop",
    timestamp: Date.now(),
  });
  return session;
}

test("long saved thread keeps history, editor input, and native tool details usable", async () => {
  const { home, socket, tmux, paneCommand } = await createTerminalProcessFixture("bruv-long-thread-");
  const artifacts = resolve(import.meta.dir, "../../artifacts/tui", socket);
  const paneFrames = (target: string) => async (name: string, expected: string | string[]) => {
    const capture = async () => (await capturePane(tmux, target)).stdout;
    const text = await frameContaining(capture, expected, 200);
    await writeFile(join(artifacts, name + ".txt"), text);
    return text;
  };
  const frame = paneFrames("long-thread");
  try {
    await mkdir(artifacts, { recursive: true });
    await writeFile(join(artifacts, "fixture.json"), JSON.stringify({ home, socket }, null, 2));
    const session = createSavedThread(home);
    const launch = paneCommand(
      [
        resolve(import.meta.dir, "../../dist/bruv"),
        "--offline",
        "--no-approve",
        "--session",
        session.getSessionFile()!,
        "--provider",
        "openai",
        "--model",
        "gpt-4o",
      ],
      { OPENAI_API_KEY: "offline-test-placeholder" },
    );
    expect(
      (await tmux("new-session", "-d", "-s", "long-thread", "-x", "100", "-y", "30", "-c", home, ...launch)).code,
    ).toBe(0);
    await frame("loaded", "LONG_THREAD_READY");
    // The initial frame can precede shortcut setup.
    await Bun.sleep(500);
    await tmux("send-keys", "-t", "long-thread", "-l", "long-thread-draft");
    await frame("typed", "long-thread-draft");
    await tmux("send-keys", "-t", "long-thread", "C-Home");
    await frame("oldest", "Saved turn 0");
    await tmux("send-keys", "-t", "long-thread", "C-End");
    await frame("bottom", "LONG_THREAD_READY");
    await tmux("send-keys", "-t", "long-thread", "C-o");
    // Ctrl+O preserves the reading anchor; it does not jump to the last tool.
    await frame("expanded-anchor", ["10 tools called", "DETAIL_saved-"]);
    await tmux("send-keys", "-t", "long-thread", "C-End");
    const expanded = await frame("expanded", ["DETAIL_saved-99-9", "long-thread-draft"]);
    expect(expanded).toMatch(/^\s*DETAIL_saved-99-9\s*[│┃]?\s*$/m);
    await tmux("send-keys", "-t", "long-thread", "C-o");
    const collapsed = await frame("collapsed", ["10 tools called", "LONG_THREAD_READY"]);
    expect(collapsed).toContain(" 10 tools called");
    expect(collapsed).not.toMatch(/10 tools called [▸▾]/);
    expect(collapsed).not.toContain("DETAIL_saved-99-9");
    await tmux("resize-window", "-t", "long-thread", "-x", "48", "-y", "30");
    const narrow = await frame("narrow", ["long-thread-draft", "gpt-4o"]);
    for (const line of narrow.trimEnd().split("\n")) expect([...line].length).toBeLessThanOrEqual(48);
    // A process reopen reconstructs the groups from the same saved branch,
    // and both ends of the original tool history remain reachable.
    await tmux("resize-window", "-t", "long-thread", "-x", "100", "-y", "30");
    // Respawn the CLI, not the tmux server: killing its last session races
    // tmux exit-empty teardown against creation of the next session.
    expect((await tmux("respawn-pane", "-k", "-t", "long-thread", "-c", home, ...launch)).code).toBe(0);
    const reopened = await frame("reopened", ["LONG_THREAD_READY", "10 tools called"]);
    expect(reopened).not.toContain("DETAIL_saved-99-9");
    await tmux("send-keys", "-t", "long-thread", "-l", "reopened-draft");
    await frame("reopened-typed", "reopened-draft");
    await tmux("send-keys", "-t", "long-thread", "C-o");
    await frame("reopened-expanded-anchor", ["10 tools called", "DETAIL_saved-"]);
    await tmux("send-keys", "-t", "long-thread", "C-Home");
    const oldestDetail = await frame("reopened-oldest-detail", ["Saved turn 0", "DETAIL_saved-0-0"]);
    expect(oldestDetail).toMatch(/^\s*DETAIL_saved-0-0\s*[│┃]?\s*$/m);
    await tmux("send-keys", "-t", "long-thread", "C-End");
    const latestDetail = await frame("reopened-latest-detail", ["DETAIL_saved-99-9", "reopened-draft"]);
    expect(latestDetail).toMatch(/^\s*DETAIL_saved-99-9\s*[│┃]?\s*$/m);
    await tmux("send-keys", "-t", "long-thread", "C-o");
    expect(await frame("reopened-collapsed", "10 tools called")).not.toContain("DETAIL_saved-99-9");

    // Individual collapsed labels belong to ordinary scrollback mode, not
    // collapsed activity groups. Keep the original native label/detail proof
    // on the very same saved session in that mode as well.
    const regularLaunch = [...launch, "--tui-mode", "regular"];
    expect(
      (await tmux("new-session", "-d", "-s", "regular", "-x", "100", "-y", "30", "-c", home, ...regularLaunch)).code,
    ).toBe(0);
    const regularFrame = paneFrames("regular");
    const regularCollapsed = await regularFrame("regular-collapsed", [
      "LONG_THREAD_READY",
      "Read saved file saved-99-9",
    ]);
    expect(regularCollapsed).toContain("Read saved file saved-99-9");
    expect(regularCollapsed).not.toContain("DETAIL_saved-99-9");
    expect(regularCollapsed).not.toContain("10 tools called");
    await tmux("send-keys", "-t", "regular", "-l", "regular-draft");
    await regularFrame("regular-typed", "regular-draft");
    await tmux("send-keys", "-t", "regular", "C-o");
    const regularExpanded = await regularFrame("regular-expanded", ["DETAIL_saved-99-9", "regular-draft"]);
    expect(regularExpanded).toMatch(/^\s*DETAIL_saved-99-9\s*$/m);
    await tmux("send-keys", "-t", "regular", "C-o");
    const regularRecollapsed = await regularFrame("regular-recollapsed", "Read saved file saved-99-9");
    expect(regularRecollapsed).not.toContain("DETAIL_saved-99-9");

    // Frames test real interaction and preservation, not machine-specific timing.
    expect(session.getBranch().filter((entry) => entry.type === "message").length).toBe(2101);
    const savedBranch = SessionManager.open(session.getSessionFile()!).getBranch();
    expect(savedBranch.filter((entry) => entry.type === "message")).toHaveLength(2101);
    const savedResults = savedBranch.filter((entry) => entry.type === "message" && entry.message.role === "toolResult");
    expect(savedResults).toHaveLength(1000);
    for (const entry of savedResults)
      if (entry.type === "message" && entry.message.role === "toolResult")
        expect(entry.message.content).toEqual([{ type: "text", text: "DETAIL_" + entry.message.toolCallId }]);
  } finally {
    await tmux("kill-server");
  }
}, 60000);
